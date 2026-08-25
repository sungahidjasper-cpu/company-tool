"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import {
  actionError,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { extractMentionedUserIds } from "@/features/notifications/services/mention.service";
import { createNotification } from "@/features/notifications/services/notification.service";
import {
  leadSchema,
  leadStatusSchema,
  quickLeadTaskSchema,
  type LeadInput,
} from "@/features/leads/schemas/lead.schema";

function leadDetailPath(leadId: string) {
  return `/leads/${leadId}`;
}

async function validateCompanyUser(companyId: string, userId?: string) {
  if (!userId) return true;
  const count = await prisma.user.count({ where: { id: userId, companyId } });
  return count > 0;
}

export async function createLead(
  input: LeadInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageLeads(actor.role)) {
    return actionError("You do not have permission to create leads.");
  }

  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (!(await validateCompanyUser(actor.companyId, parsed.data.assignedUserId))) {
    return actionError("Selected assignee is invalid.");
  }

  const lead = await prisma.lead.create({
    data: {
      companyId: actor.companyId,
      createdById: actor.id,
      name: parsed.data.name,
      companyName: parsed.data.companyName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      source: parsed.data.source,
      status: parsed.data.status,
      value: parsed.data.value ? parsed.data.value : null,
      assignedUserId: parsed.data.assignedUserId || null,
      clientId: parsed.data.clientId || null,
      projectId: parsed.data.projectId || null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "lead.created",
    companyId: actor.companyId,
    leadId: lead.id,
    metadata: { name: lead.name },
  });

  if (lead.assignedUserId && lead.assignedUserId !== actor.id) {
    await createNotification({
      userId: lead.assignedUserId,
      type: "LEAD_ASSIGNED",
      message: `${actor.firstName} assigned you the lead "${lead.name}"`,
      link: leadDetailPath(lead.id),
    });
  }

  revalidatePath("/leads");
  revalidatePath("/pipeline");
  return actionSuccess({ id: lead.id });
}

export async function updateLead(
  id: string,
  input: LeadInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageLeads(actor.role)) {
    return actionError("You do not have permission to edit leads.");
  }

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Lead not found.");
  }

  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (!(await validateCompanyUser(actor.companyId, parsed.data.assignedUserId))) {
    return actionError("Selected assignee is invalid.");
  }

  const nextAssignedUserId = parsed.data.assignedUserId || null;

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      name: parsed.data.name,
      companyName: parsed.data.companyName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      source: parsed.data.source,
      status: parsed.data.status,
      value: parsed.data.value ? parsed.data.value : null,
      assignedUserId: nextAssignedUserId,
      clientId: parsed.data.clientId || null,
      projectId: parsed.data.projectId || null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "lead.updated",
    companyId: actor.companyId,
    leadId: lead.id,
    metadata: { name: lead.name },
  });

  const assigneeChanged = nextAssignedUserId !== existing.assignedUserId;
  if (assigneeChanged && nextAssignedUserId && nextAssignedUserId !== actor.id) {
    await createNotification({
      userId: nextAssignedUserId,
      type: "LEAD_ASSIGNED",
      message: `${actor.firstName} assigned you the lead "${lead.name}"`,
      link: leadDetailPath(lead.id),
    });
  }

  revalidatePath("/leads");
  revalidatePath(leadDetailPath(id));
  revalidatePath("/pipeline");
  return actionSuccess({ id: lead.id });
}

/**
 * Lighter than updateLead: allowed for a Manager+, or the lead's own
 * assignee dragging their own card through the pipeline — same shape as
 * Task's updateTaskStatus. Notifies on stage change, and specifically on
 * Won/Lost since those are terminal, dashboard-visible outcomes.
 */
export async function moveLeadStatus(
  id: string,
  status: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Lead not found.");
  }

  const canAct =
    Permissions.manageLeads(actor.role) || existing.assignedUserId === actor.id;
  if (!canAct) {
    return actionError("You do not have permission to move this lead.");
  }

  const parsed = leadStatusSchema.safeParse({ status });
  if (!parsed.success) {
    return actionError("Invalid status.");
  }

  if (parsed.data.status === existing.status) {
    return actionSuccess();
  }

  await prisma.lead.update({
    where: { id },
    data: { status: parsed.data.status },
  });

  await logActivity({
    actorId: actor.id,
    action: "lead.status_changed",
    companyId: actor.companyId,
    leadId: id,
    metadata: { from: existing.status, to: parsed.data.status },
  });

  if (existing.assignedUserId && existing.assignedUserId !== actor.id) {
    if (parsed.data.status === "WON") {
      await createNotification({
        userId: existing.assignedUserId,
        type: "LEAD_WON",
        message: `${actor.firstName} marked "${existing.name}" as won`,
        link: leadDetailPath(id),
      });
    } else if (parsed.data.status === "LOST") {
      await createNotification({
        userId: existing.assignedUserId,
        type: "LEAD_LOST",
        message: `${actor.firstName} marked "${existing.name}" as lost`,
        link: leadDetailPath(id),
      });
    } else {
      await createNotification({
        userId: existing.assignedUserId,
        type: "LEAD_MOVED",
        message: `${actor.firstName} moved "${existing.name}" to ${parsed.data.status.replace(/_/g, " ").toLowerCase()}`,
        link: leadDetailPath(id),
      });
    }
  }

  revalidatePath("/leads");
  revalidatePath(leadDetailPath(id));
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  return actionSuccess();
}

export async function archiveLead(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageLeads(actor.role)) {
    return actionError("You do not have permission to archive leads.");
  }

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Lead not found.");
  }

  await prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "lead.archived",
    companyId: actor.companyId,
    leadId: id,
  });

  revalidatePath("/leads");
  revalidatePath("/pipeline");
  return actionSuccess();
}

export async function restoreLead(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageLeads(actor.role)) {
    return actionError("You do not have permission to restore leads.");
  }

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Lead not found.");
  }

  await prisma.lead.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "lead.restored",
    companyId: actor.companyId,
    leadId: id,
  });

  revalidatePath("/leads");
  revalidatePath("/pipeline");
  return actionSuccess();
}

export async function addLeadNote(
  leadId: string,
  body: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Lead not found.");
  }

  if (body.trim().length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.create({
    data: { authorId: actor.id, leadId, body: body.trim() },
  });

  await logActivity({
    actorId: actor.id,
    action: "lead.note_added",
    companyId: actor.companyId,
    leadId,
  });

  const mentionedUserIds = await extractMentionedUserIds(
    body,
    actor.companyId,
    actor.id
  );
  for (const userId of mentionedUserIds) {
    await createNotification({
      userId,
      type: "COMMENT_MENTION",
      message: `${actor.firstName} mentioned you in a note on ${existing.name}`,
      link: leadDetailPath(leadId),
    });
  }

  revalidatePath(leadDetailPath(leadId));
  return actionSuccess();
}

/** Fetch-then-compare, matching addLeadNote's own tenant-check idiom, extended to the Note's parent relation rather than the Lead directly. */
async function getOwnedLeadNote(noteId: string, companyId: string) {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { lead: { select: { id: true, companyId: true } } },
  });
  if (!note || !note.lead || note.lead.companyId !== companyId) return null;
  return { ...note, lead: note.lead };
}

/**
 * Phase 26 Stage 3 — manager-or-author edit. Tenant ownership is re-derived
 * from the Note's own lead relation, never from a client-supplied id.
 * Rejects editing an already-deleted note.
 */
export async function updateLeadNote(input: { noteId: string; body: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedLeadNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.deletedAt) {
    return actionError("This note has already been deleted.");
  }

  if (note.authorId !== actor.id && !Permissions.manageLeads(actor.role)) {
    return actionError("You do not have permission to edit this note.");
  }

  const trimmed = input.body.trim();
  if (trimmed.length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { body: trimmed } });

  await logActivity({
    actorId: actor.id,
    action: "lead.note_updated",
    companyId: actor.companyId,
    leadId: note.lead.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(leadDetailPath(note.lead.id));
  return actionSuccess();
}

/**
 * Phase 26 Stage 3 — manager-or-author soft delete. Same ownership
 * re-derivation as updateLeadNote. Never hard-deletes.
 */
export async function deleteLeadNote(input: { noteId: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedLeadNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.authorId !== actor.id && !Permissions.manageLeads(actor.role)) {
    return actionError("You do not have permission to delete this note.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "lead.note_deleted",
    companyId: actor.companyId,
    leadId: note.lead.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(leadDetailPath(note.lead.id));
  return actionSuccess();
}

/**
 * Phase 27 Stage 3 — manager-or-author restore. Same ownership
 * re-derivation as updateLeadNote/deleteLeadNote. Touches only deletedAt.
 */
export async function restoreLeadNote(input: { noteId: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedLeadNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (!note.deletedAt) {
    return actionError("This note is not deleted.");
  }

  if (note.authorId !== actor.id && !Permissions.manageLeads(actor.role)) {
    return actionError("You do not have permission to restore this note.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "lead.note_restored",
    companyId: actor.companyId,
    leadId: note.lead.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(leadDetailPath(note.lead.id));
  return actionSuccess();
}

export async function createLeadTask(
  leadId: string,
  title: string
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  const existing = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Lead not found.");
  }

  const canAct =
    Permissions.manageLeads(actor.role) || existing.assignedUserId === actor.id;
  if (!canAct) {
    return actionError("You do not have permission to add tasks to this lead.");
  }

  const parsed = quickLeadTaskSchema.safeParse({ title });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const task = await prisma.leadTask.create({
    data: {
      leadId,
      createdById: actor.id,
      assigneeId: existing.assignedUserId,
      title: parsed.data.title,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "lead.task_created",
    companyId: actor.companyId,
    leadId,
    metadata: { taskId: task.id, title: task.title },
  });

  revalidatePath(leadDetailPath(leadId));
  return actionSuccess({ id: task.id });
}

export async function updateLeadTaskStatus(
  id: string,
  status: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await prisma.leadTask.findUnique({
    where: { id },
    include: { lead: { select: { id: true, companyId: true, assignedUserId: true } } },
  });
  if (!existing || existing.lead.companyId !== actor.companyId) {
    return actionError("Task not found.");
  }

  const canAct =
    Permissions.manageLeads(actor.role) ||
    existing.assigneeId === actor.id ||
    existing.lead.assignedUserId === actor.id;
  if (!canAct) {
    return actionError("You do not have permission to update this task.");
  }

  if (!["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"].includes(status)) {
    return actionError("Invalid status.");
  }

  await prisma.leadTask.update({
    where: { id },
    data: { status: status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED" },
  });

  await logActivity({
    actorId: actor.id,
    action: "lead.task_status_changed",
    companyId: actor.companyId,
    leadId: existing.lead.id,
    metadata: { taskId: id, status },
  });

  revalidatePath(leadDetailPath(existing.lead.id));
  return actionSuccess();
}
