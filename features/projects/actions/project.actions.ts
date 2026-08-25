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
  projectSchema,
  type ProjectInput,
} from "@/features/projects/schemas/project.schema";

/** Prevents assigning a client or users from a different tenant. */
async function validateCompanyScopedRefs(
  companyId: string,
  input: ProjectInput
): Promise<string | null> {
  if (input.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: input.clientId },
    });
    if (!client || client.companyId !== companyId) {
      return "Selected client is invalid.";
    }
  }

  const userIds = [input.ownerId, ...input.assignedUserIds].filter(
    (id): id is string => Boolean(id)
  );
  if (userIds.length > 0) {
    const uniqueIds = Array.from(new Set(userIds));
    const count = await prisma.user.count({
      where: { id: { in: uniqueIds }, companyId },
    });
    if (count !== uniqueIds.length) {
      return "One or more selected users are invalid.";
    }
  }

  return null;
}

export async function createProject(
  input: ProjectInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to create projects.");
  }

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const refError = await validateCompanyScopedRefs(
    actor.companyId,
    parsed.data
  );
  if (refError) {
    return actionError(refError);
  }

  const project = await prisma.project.create({
    data: {
      companyId: actor.companyId,
      name: parsed.data.name,
      description: parsed.data.description,
      status: parsed.data.status,
      priority: parsed.data.priority,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      clientId: parsed.data.clientId || null,
      ownerId: parsed.data.ownerId || null,
      assignedUsers: {
        connect: parsed.data.assignedUserIds.map((id) => ({ id })),
      },
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "project.created",
    companyId: actor.companyId,
    projectId: project.id,
    metadata: { name: project.name },
  });

  revalidatePath("/projects");
  return actionSuccess({ id: project.id });
}

export async function updateProject(
  id: string,
  input: ProjectInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to edit projects.");
  }

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Project not found.");
  }

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const refError = await validateCompanyScopedRefs(
    actor.companyId,
    parsed.data
  );
  if (refError) {
    return actionError(refError);
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      status: parsed.data.status,
      priority: parsed.data.priority,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      clientId: parsed.data.clientId || null,
      ownerId: parsed.data.ownerId || null,
      assignedUsers: {
        set: parsed.data.assignedUserIds.map((userId) => ({ id: userId })),
      },
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "project.updated",
    companyId: actor.companyId,
    projectId: project.id,
    metadata: { name: project.name },
  });

  const interestedUserIds = new Set(
    [project.ownerId, ...parsed.data.assignedUserIds].filter(
      (userId): userId is string => Boolean(userId) && userId !== actor.id
    )
  );
  for (const userId of interestedUserIds) {
    await createNotification({
      userId,
      type: "PROJECT_UPDATE",
      message: `${actor.firstName} updated the project "${project.name}"`,
      link: `/projects/${id}`,
    });
  }

  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  return actionSuccess({ id: project.id });
}

export async function archiveProject(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to archive projects.");
  }

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Project not found.");
  }

  await prisma.project.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await logActivity({
    actorId: actor.id,
    action: "project.archived",
    companyId: actor.companyId,
    projectId: id,
  });

  revalidatePath("/projects");
  return actionSuccess();
}

export async function restoreProject(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to restore projects.");
  }

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Project not found.");
  }

  await prisma.project.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "project.restored",
    companyId: actor.companyId,
    projectId: id,
  });

  revalidatePath("/projects");
  return actionSuccess();
}

export async function addProjectNote(
  projectId: string,
  body: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Project not found.");
  }

  if (body.trim().length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.create({
    data: { authorId: actor.id, projectId, body: body.trim() },
  });

  await logActivity({
    actorId: actor.id,
    action: "project.note_added",
    companyId: actor.companyId,
    projectId,
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
      link: `/projects/${projectId}`,
    });
  }

  revalidatePath(`/projects/${projectId}`);
  return actionSuccess();
}

/** Fetch-then-compare, matching addProjectNote's own tenant-check idiom, extended to the Note's parent relation rather than the Project directly. */
async function getOwnedProjectNote(noteId: string, companyId: string) {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { project: { select: { id: true, companyId: true } } },
  });
  if (!note || !note.project || note.project.companyId !== companyId) return null;
  return { ...note, project: note.project };
}

/**
 * Phase 26 Stage 3 — manager-or-author edit. Tenant ownership is re-derived
 * from the Note's own project relation, never from a client-supplied id.
 * Rejects editing an already-deleted note. Never substitutes the Project's
 * own ownership/assignment fields for note.authorId.
 */
export async function updateProjectNote(input: { noteId: string; body: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedProjectNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.deletedAt) {
    return actionError("This note has already been deleted.");
  }

  if (note.authorId !== actor.id && !Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to edit this note.");
  }

  const trimmed = input.body.trim();
  if (trimmed.length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { body: trimmed } });

  await logActivity({
    actorId: actor.id,
    action: "project.note_updated",
    companyId: actor.companyId,
    projectId: note.project.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(`/projects/${note.project.id}`);
  return actionSuccess();
}

/**
 * Phase 26 Stage 3 — manager-or-author soft delete. Same ownership
 * re-derivation as updateProjectNote. Never hard-deletes.
 */
export async function deleteProjectNote(input: { noteId: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedProjectNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.authorId !== actor.id && !Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to delete this note.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "project.note_deleted",
    companyId: actor.companyId,
    projectId: note.project.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(`/projects/${note.project.id}`);
  return actionSuccess();
}
