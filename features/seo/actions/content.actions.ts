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
import { parseCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import { extractMentionedUserIds } from "@/features/notifications/services/mention.service";
import { createNotification } from "@/features/notifications/services/notification.service";
import { createContentRevisionSnapshot } from "@/features/seo/services/content-revision.service";
import {
  CONTENT_STATUS_ORDER,
  contentImportRowSchema,
  contentSchema,
  type ContentInput,
} from "@/features/seo/schemas/content.schema";

function getContentWithProject(id: string) {
  return prisma.content.findUnique({
    where: { id },
    include: { seoProject: { select: { id: true, companyId: true } } },
  });
}

export async function createContent(
  seoProjectId: string,
  input: ContentInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to create content.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const parsed = contentSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const content = await prisma.content.create({
    data: {
      seoProjectId,
      authorId: parsed.data.authorId || null,
      title: parsed.data.title,
      url: parsed.data.url || null,
      status: parsed.data.status,
      publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
      body: parsed.data.body || null,
      keywords: parsed.data.keywordIds
        ? { connect: parsed.data.keywordIds.map((id) => ({ id })) }
        : undefined,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.created",
    companyId: actor.companyId,
    seoProjectId,
    contentId: content.id,
    metadata: { title: content.title },
  });

  revalidatePath(`/seo/${seoProjectId}/content`);
  revalidatePath(`/seo/${seoProjectId}`);
  return actionSuccess({ id: content.id });
}

export async function updateContent(
  id: string,
  input: ContentInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit content.");
  }

  const existing = await getContentWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Content not found.");
  }

  const parsed = contentSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const newTitle = parsed.data.title;
  const newBody = parsed.data.body || null;

  // Phase 25 Stage 2 — snapshot the pre-change state before overwriting it,
  // in the same transaction as the write, so a rollback of one rolls back
  // the other. The row lock is taken explicitly here (not left to
  // createContentRevisionSnapshot's own internal lock alone) because this
  // function needs to READ the current title/body under that lock to decide
  // whether anything tracked actually changed, before it can even call
  // createContentRevisionSnapshot — reading `existing` from before this
  // transaction opened would risk snapshotting a value a concurrent edit
  // has already superseded. createContentRevisionSnapshot's own lock
  // acquisition immediately after is therefore a harmless re-lock of a row
  // this same transaction already holds, not a second real lock.
  const preflight = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${id} FOR UPDATE`;
    const current = await tx.content.findUnique({ where: { id } });
    if (!current) {
      return { kind: "not_found" as const };
    }

    if (current.title !== newTitle || current.body !== newBody) {
      await createContentRevisionSnapshot(tx, {
        contentId: id,
        companyId: actor.companyId,
        title: current.title,
        metaTitle: current.metaTitle,
        metaDescription: current.metaDescription,
        body: current.body,
        changeSource: "MANUAL_EDIT",
        createdByUserId: actor.id,
      });
    }

    const updated = await tx.content.update({
      where: { id },
      data: {
        authorId: parsed.data.authorId || null,
        title: newTitle,
        url: parsed.data.url || null,
        status: parsed.data.status,
        publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
        body: newBody,
        keywords: { set: (parsed.data.keywordIds ?? []).map((keywordId) => ({ id: keywordId })) },
      },
    });
    return { kind: "updated" as const, content: updated };
  });

  if (preflight.kind === "not_found") {
    return actionError("Content not found.");
  }
  const content = preflight.content;

  await logActivity({
    actorId: actor.id,
    action: "content.updated",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    contentId: content.id,
    metadata: { title: content.title },
  });

  revalidatePath(`/seo/${existing.seoProject.id}/content`);
  revalidatePath(`/seo/${existing.seoProject.id}/content/${id}`);
  return actionSuccess({ id: content.id });
}

/** One-click linear progression, alongside the free status dropdown in the edit form. */
export async function advanceContentStatus(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to change content status.");
  }

  const existing = await getContentWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Content not found.");
  }

  const currentIndex = CONTENT_STATUS_ORDER.indexOf(existing.status);
  const nextStatus = CONTENT_STATUS_ORDER[currentIndex + 1];
  if (!nextStatus) {
    return actionError("This content is already at its final stage.");
  }

  await prisma.content.update({
    where: { id },
    data: {
      status: nextStatus,
      publishedAt: nextStatus === "PUBLISHED" ? new Date() : existing.publishedAt,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.status_advanced",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    contentId: id,
    metadata: { from: existing.status, to: nextStatus },
  });

  revalidatePath(`/seo/${existing.seoProject.id}/content`);
  revalidatePath(`/seo/${existing.seoProject.id}/content/${id}`);
  return actionSuccess();
}

export async function archiveContent(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to archive content.");
  }

  const existing = await getContentWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Content not found.");
  }

  await prisma.content.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "content.archived",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    contentId: id,
  });

  revalidatePath(`/seo/${existing.seoProject.id}/content`);
  return actionSuccess();
}

export async function restoreContent(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore content.");
  }

  const existing = await getContentWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Content not found.");
  }

  await prisma.content.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "content.restored",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    contentId: id,
  });

  revalidatePath(`/seo/${existing.seoProject.id}/content`);
  return actionSuccess();
}

export async function addContentNote(
  contentId: string,
  body: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await getContentWithProject(contentId);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Content not found.");
  }

  if (body.trim().length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.create({
    data: { authorId: actor.id, contentId, body: body.trim() },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.note_added",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    contentId,
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
      message: `${actor.firstName} mentioned you in a note on "${existing.title}"`,
      link: `/seo/${existing.seoProject.id}/content/${contentId}`,
    });
  }

  revalidatePath(`/seo/${existing.seoProject.id}/content/${contentId}`);
  return actionSuccess();
}

/**
 * Fetch-then-compare, matching addContentNote's own tenant-check idiom,
 * extended to the Note's parent relation rather than Content directly.
 * Only ever reads/writes the Note model — never touches Content or
 * ContentRevision, so note edit/delete cannot interact with Phase 25's
 * revision history or Content's own tracked fields in any way.
 */
async function getOwnedContentNote(noteId: string, companyId: string) {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { content: { select: { id: true, seoProject: { select: { id: true, companyId: true } } } } },
  });
  if (!note || !note.content || note.content.seoProject.companyId !== companyId) return null;
  return { ...note, content: note.content };
}

/**
 * Phase 26 Stage 3 — manager-or-author edit. Tenant ownership is re-derived
 * from the Note's own content -> seoProject relation, never from a
 * client-supplied id. Rejects editing an already-deleted note. Never calls
 * createContentRevisionSnapshot or touches the Content row itself — this
 * function only ever updates the Note model.
 */
export async function updateContentNote(input: { noteId: string; body: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedContentNote(input.noteId, actor.companyId);
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
    action: "content.note_updated",
    companyId: actor.companyId,
    seoProjectId: note.content.seoProject.id,
    contentId: note.content.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(`/seo/${note.content.seoProject.id}/content/${note.content.id}`);
  return actionSuccess();
}

/**
 * Phase 26 Stage 3 — manager-or-author soft delete. Same ownership
 * re-derivation as updateContentNote. Never hard-deletes, never touches
 * Content or ContentRevision.
 */
export async function deleteContentNote(input: { noteId: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedContentNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.authorId !== actor.id && !Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to delete this note.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "content.note_deleted",
    companyId: actor.companyId,
    seoProjectId: note.content.seoProject.id,
    contentId: note.content.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(`/seo/${note.content.seoProject.id}/content/${note.content.id}`);
  return actionSuccess();
}

async function getOwnedContentIds(seoProjectId: string, companyId: string, ids: string[]) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return [];

  const rows = await prisma.content.findMany({
    where: { id: { in: ids }, seoProjectId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function bulkArchiveContent(
  seoProjectId: string,
  ids: string[]
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to archive content.");
  }

  const ownedIds = await getOwnedContentIds(seoProjectId, actor.companyId, ids);
  if (ownedIds.length === 0) return actionError("No matching content found.");

  const result = await prisma.content.updateMany({
    where: { id: { in: ownedIds } },
    data: { deletedAt: new Date() },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.bulk_archived",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { count: result.count },
  });

  revalidatePath(`/seo/${seoProjectId}/content`);
  return actionSuccess({ count: result.count });
}

export async function bulkRestoreContent(
  seoProjectId: string,
  ids: string[]
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore content.");
  }

  const ownedIds = await getOwnedContentIds(seoProjectId, actor.companyId, ids);
  if (ownedIds.length === 0) return actionError("No matching content found.");

  const result = await prisma.content.updateMany({
    where: { id: { in: ownedIds } },
    data: { deletedAt: null },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.bulk_restored",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { count: result.count },
  });

  revalidatePath(`/seo/${seoProjectId}/content`);
  return actionSuccess({ count: result.count });
}

export async function bulkPublishContent(
  seoProjectId: string,
  ids: string[]
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to publish content.");
  }

  const ownedIds = await getOwnedContentIds(seoProjectId, actor.companyId, ids);
  if (ownedIds.length === 0) return actionError("No matching content found.");

  const result = await prisma.content.updateMany({
    where: { id: { in: ownedIds } },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.bulk_published",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { count: result.count },
  });

  revalidatePath(`/seo/${seoProjectId}/content`);
  return actionSuccess({ count: result.count });
}

/**
 * Same trash-then-purge scoping as bulkDeleteKeywords — see that function's
 * comment. Content additionally has ContentRevision rows referencing it
 * with onDelete: Restrict (Phase 25) — any id with revision history would
 * make a plain deleteMany throw a foreign-key violation for the ENTIRE
 * batch, since a single multi-row DELETE is atomic. Rather than let one
 * revision-protected item abort deletion of everything else selected, this
 * excludes those ids up front and reports how many were skipped — the same
 * "process what's valid, report what's not" shape importContentCsv already
 * uses in this file. The Restrict constraint itself remains the actual
 * safety guarantee; this is purely about not crashing on it.
 */
export async function bulkDeleteContent(
  seoProjectId: string,
  ids: string[]
): Promise<ActionResult<{ count: number; skippedCount: number }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to delete content.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const blocked = await prisma.contentRevision.findMany({
    where: { contentId: { in: ids } },
    select: { contentId: true },
    distinct: ["contentId"],
  });
  const blockedIds = new Set(blocked.map((revision) => revision.contentId));
  const eligibleIds = ids.filter((id) => !blockedIds.has(id));

  const result = await prisma.content.deleteMany({
    where: { id: { in: eligibleIds }, seoProjectId, deletedAt: { not: null } },
  });
  const skippedCount = ids.length - result.count;

  await logActivity({
    actorId: actor.id,
    action: "content.bulk_deleted",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { count: result.count, skippedCount },
  });

  revalidatePath(`/seo/${seoProjectId}/content`);
  return actionSuccess({ count: result.count, skippedCount });
}

type ImportSummary = {
  created: number;
  errors: { row: number; message: string }[];
};

export async function importContentCsv(
  seoProjectId: string,
  formData: FormData
): Promise<ActionResult<ImportSummary>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to import content.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return actionError("Choose a CSV file first.");
  }

  const text = await file.text();
  const rawRows = parseCsv(text);
  if (rawRows.length === 0) {
    return actionError("The CSV file has no data rows.");
  }

  const errors: ImportSummary["errors"] = [];
  let created = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 2;
    const parsedRow = contentImportRowSchema.safeParse(rawRows[i]);
    if (!parsedRow.success) {
      errors.push({ row: rowNumber, message: parsedRow.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }

    try {
      await prisma.content.create({
        data: {
          seoProjectId,
          title: parsedRow.data.title,
          url: parsedRow.data.url || null,
          status: parsedRow.data.status,
        },
      });
      created++;
    } catch {
      errors.push({ row: rowNumber, message: "Failed to import this row" });
    }
  }

  await logActivity({
    actorId: actor.id,
    action: "content.csv_imported",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { created, errorCount: errors.length },
  });

  revalidatePath(`/seo/${seoProjectId}/content`);
  return actionSuccess({ created, errors });
}
