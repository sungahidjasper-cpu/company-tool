"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { createContentRevisionSnapshot } from "@/features/seo/services/content-revision.service";

/**
 * Phase 25 Stage 3 — the restore action. Kept separate from
 * content.actions.ts/long-form-content.actions.ts (the two Stage 2
 * snapshot-on-write paths) the same way Phase 24 split
 * publishing-connection.actions.ts from publishing-content.actions.ts: this
 * is its own distinct capability, not a variant of either existing edit
 * flow.
 */

/** Same fetch-and-compare pattern as content.actions.ts's getContentWithProject — duplicated rather than imported, matching that file's own precedent (see long-form-content.actions.ts's getOwnedSeoProject comment) of not cross-exporting these tiny checks. */
async function getOwnedContent(contentId: string, companyId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { seoProject: { select: { id: true, companyId: true } } },
  });
  if (!content || content.seoProject.companyId !== companyId) return null;
  return content;
}

export type RestoreContentRevisionInput = {
  contentId: string;
  revisionId: string;
};

export type RestoreContentRevisionResult = {
  id: string;
  /** True when the selected revision's four tracked fields already exactly matched the current Content — no revision or update was performed. */
  noOp: boolean;
};

/**
 * Reverts Content's four tracked fields (title/metaTitle/metaDescription/
 * body) to a previously-captured ContentRevision. Never destructive: the
 * CURRENT state is snapshotted (changeSource: RESTORE) inside the same
 * transaction, immediately before the selected revision's values are
 * applied, so restoring is itself always undoable — see
 * content-revision.service.ts's createContentRevisionSnapshot for the
 * locking/sequencing guarantee this relies on.
 *
 * Never touches status, publishedAt, url, keywords, authorId, deletedAt,
 * or any publishing-related model — the update's data object below lists
 * exactly the four restorable fields and nothing else, the same
 * can't-modify-what-isn't-listed guarantee updateLongFormContentAction
 * already relies on.
 */
export async function restoreContentRevisionAction(input: RestoreContentRevisionInput): Promise<ActionResult<RestoreContentRevisionResult>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore content.");
  }

  const existing = await getOwnedContent(input.contentId, actor.companyId);
  if (!existing) {
    return actionError("Content not found.");
  }

  const preflight = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${input.contentId} FOR UPDATE`;

    // Revision ownership is verified INSIDE the lock, against BOTH
    // contentId and companyId independently — a revision belonging to the
    // right content but wrong company (or vice versa) is rejected
    // identically to one that doesn't exist at all, so no cross-tenant
    // existence information ever leaks.
    const revision = await tx.contentRevision.findUnique({ where: { id: input.revisionId } });
    if (!revision || revision.contentId !== input.contentId || revision.companyId !== actor.companyId) {
      return { kind: "revision_not_found" as const };
    }

    const current = await tx.content.findUnique({ where: { id: input.contentId } });
    if (!current) {
      return { kind: "content_not_found" as const };
    }

    const unchanged =
      current.title === revision.title &&
      current.metaTitle === revision.metaTitle &&
      current.metaDescription === revision.metaDescription &&
      current.body === revision.body;
    if (unchanged) {
      return { kind: "no_op" as const };
    }

    const preRestoreRevision = await createContentRevisionSnapshot(tx, {
      contentId: input.contentId,
      companyId: actor.companyId,
      title: current.title,
      metaTitle: current.metaTitle,
      metaDescription: current.metaDescription,
      body: current.body,
      changeSource: "RESTORE",
      createdByUserId: actor.id,
    });

    const updated = await tx.content.update({
      where: { id: input.contentId },
      data: {
        title: revision.title,
        metaTitle: revision.metaTitle,
        metaDescription: revision.metaDescription,
        body: revision.body,
      },
    });

    return { kind: "restored" as const, content: updated, preRestoreRevision, restoredFromRevision: revision };
  });

  if (preflight.kind === "revision_not_found") {
    return actionError("Revision not found.");
  }
  if (preflight.kind === "content_not_found") {
    return actionError("Content not found.");
  }
  if (preflight.kind === "no_op") {
    return actionSuccess({ id: input.contentId, noOp: true });
  }

  // Best-effort only, same reliability pattern Phase 24 established: a
  // failure here must never turn an already-durably-persisted restore into
  // a reported failure.
  try {
    await logActivity({
      actorId: actor.id,
      action: "content.revision_restored",
      companyId: actor.companyId,
      seoProjectId: existing.seoProject.id,
      contentId: input.contentId,
      metadata: {
        restoredFromRevisionId: preflight.restoredFromRevision.id,
        restoredFromRevisionNumber: preflight.restoredFromRevision.revisionNumber,
        preRestoreRevisionId: preflight.preRestoreRevision.id,
        preRestoreRevisionNumber: preflight.preRestoreRevision.revisionNumber,
        title: preflight.content.title,
      },
    });
  } catch (err) {
    console.error("Content revision restore: failed to record the activity log", {
      contentId: input.contentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath(`/seo/${existing.seoProject.id}/content/${input.contentId}`);
  return actionSuccess({ id: input.contentId, noOp: false });
}
