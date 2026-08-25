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
  seoProjectSchema,
  type SeoProjectInput,
} from "@/features/seo/schemas/seo-project.schema";

export async function createSeoProject(
  input: SeoProjectInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to create SEO projects.");
  }

  const parsed = seoProjectSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await prisma.sEOProject.create({
    data: {
      companyId: actor.companyId,
      name: parsed.data.name,
      domain: parsed.data.domain,
      clientId: parsed.data.clientId || null,
      ownerId: parsed.data.ownerId || null,
      status: parsed.data.status,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.created",
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    metadata: { name: seoProject.name },
  });

  revalidatePath("/seo");
  return actionSuccess({ id: seoProject.id });
}

export async function updateSeoProject(
  id: string,
  input: SeoProjectInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit SEO projects.");
  }

  const existing = await prisma.sEOProject.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const parsed = seoProjectSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await prisma.sEOProject.update({
    where: { id },
    data: {
      name: parsed.data.name,
      domain: parsed.data.domain,
      clientId: parsed.data.clientId || null,
      ownerId: parsed.data.ownerId || null,
      status: parsed.data.status,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.updated",
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    metadata: { name: seoProject.name },
  });

  revalidatePath("/seo");
  revalidatePath(`/seo/${id}`);
  return actionSuccess({ id: seoProject.id });
}

export async function archiveSeoProject(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to archive SEO projects.");
  }

  const existing = await prisma.sEOProject.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  await prisma.sEOProject.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.archived",
    companyId: actor.companyId,
    seoProjectId: id,
  });

  revalidatePath("/seo");
  return actionSuccess();
}

export async function restoreSeoProject(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore SEO projects.");
  }

  const existing = await prisma.sEOProject.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  await prisma.sEOProject.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.restored",
    companyId: actor.companyId,
    seoProjectId: id,
  });

  revalidatePath("/seo");
  return actionSuccess();
}

export async function addSeoProjectNote(
  seoProjectId: string,
  body: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  if (body.trim().length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.create({
    data: { authorId: actor.id, seoProjectId, body: body.trim() },
  });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.note_added",
    companyId: actor.companyId,
    seoProjectId,
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
      link: `/seo/${seoProjectId}`,
    });
  }

  revalidatePath(`/seo/${seoProjectId}`);
  return actionSuccess();
}

/** Fetch-then-compare, matching addSeoProjectNote's own tenant-check idiom, extended to the Note's parent relation rather than the SEOProject directly. */
async function getOwnedSeoProjectNote(noteId: string, companyId: string) {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { seoProject: { select: { id: true, companyId: true } } },
  });
  if (!note || !note.seoProject || note.seoProject.companyId !== companyId) return null;
  return { ...note, seoProject: note.seoProject };
}

/**
 * Phase 26 Stage 3 — manager-or-author edit. Tenant ownership is re-derived
 * from the Note's own seoProject relation, never from a client-supplied id.
 * Rejects editing an already-deleted note.
 */
export async function updateSeoProjectNote(input: { noteId: string; body: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedSeoProjectNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.deletedAt) {
    return actionError("This note has already been deleted.");
  }

  if (note.authorId !== actor.id && !Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit this note.");
  }

  const trimmed = input.body.trim();
  if (trimmed.length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { body: trimmed } });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.note_updated",
    companyId: actor.companyId,
    seoProjectId: note.seoProject.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(`/seo/${note.seoProject.id}`);
  return actionSuccess();
}

/**
 * Phase 26 Stage 3 — manager-or-author soft delete. Same ownership
 * re-derivation as updateSeoProjectNote. Never hard-deletes.
 */
export async function deleteSeoProjectNote(input: { noteId: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedSeoProjectNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.authorId !== actor.id && !Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to delete this note.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.note_deleted",
    companyId: actor.companyId,
    seoProjectId: note.seoProject.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(`/seo/${note.seoProject.id}`);
  return actionSuccess();
}
