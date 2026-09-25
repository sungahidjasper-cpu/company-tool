"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { createContentRevisionSnapshot } from "@/features/seo/services/content-revision.service";
import {
  applyMetaTagSuggestionInputSchema,
  metaTagOptimizerInputSchema,
  type ApplyMetaTagSuggestionInput,
  type MetaTagOptimizerInput,
} from "@/features/ai-workspace/schemas/meta-tag-optimizer.schema";

/**
 * Verifies the SEO project belongs to the actor's company — the same
 * fetch-and-compare pattern every AI Workspace actions file duplicates its
 * own copy of (a "use server" file may only export async functions, so a
 * plain helper can't be shared directly).
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  /*
   * C4 security-consistency pass — a TRASHED project is rejected, matching
   * the rule getOwnedContentRows below already applies to each Content row
   * and that schema-markup-generator.actions.ts now applies to both. The
   * picker lists only live projects and the C4 contextual action hides itself
   * for a trashed one, but neither is the boundary: this is. Both
   * startMetaTagOptimizerAction and applyMetaTagSuggestionAction call this,
   * so the generate and apply paths are covered by this single guard.
   *
   * Truthy rather than `!== null`: a fixture or caller may omit the field
   * entirely, and `undefined !== null` would wrongly reject a live project.
   */
  if (seoProject.deletedAt) return null;
  return seoProject;
}

/**
 * The multi-content counterpart to every other tool's own getOwnedContent —
 * one query for the whole selection (never one query per id), verified
 * against BOTH the actor's company and the selected SEO project. Dedupes
 * the requested ids first: a legitimate duplicate in the client's own
 * selection (the same page picked twice) must never be mistaken for a
 * missing/foreign row just because Prisma's `findMany` only ever returns
 * one row per unique id. Returns null — the same "not found" shape as
 * every other tool's own ownership check — if ANY requested id doesn't
 * resolve to a real, owned, correctly-scoped row; never partially accepts
 * a selection.
 */
async function getOwnedContentRows(contentIds: string[], companyId: string, seoProjectId: string) {
  const uniqueIds = Array.from(new Set(contentIds));
  const rows = await prisma.content.findMany({
    where: { id: { in: uniqueIds } },
    include: { seoProject: { select: { companyId: true } } },
  });
  if (rows.length !== uniqueIds.length) return null;
  for (const row of rows) {
    if (row.companyId !== companyId || row.seoProjectId !== seoProjectId) return null;
    // Phase B M2 — a trashed page is not an editable page. All-or-nothing,
    // matching this helper's existing discipline: one trashed row rejects
    // the whole request rather than silently dropping it.
    if (row.deletedAt) return null;
  }
  return rows;
}

/**
 * Background-job counterpart to the other tools' startXGenerationAction —
 * no synchronous variant, matching every other tool's shape. Stage C is
 * generation only: this action never writes to Content and never creates a
 * ContentRevision — see meta-tag-optimizer.service.ts's own filter and
 * lib/jobs/ai-generation-job-runner.ts's dispatchMetaTagOptimizer, neither
 * of which touches the database beyond read-only lookups. Applying an
 * accepted suggestion is applyMetaTagSuggestionAction, below.
 */
export async function startMetaTagOptimizerAction(input: MetaTagOptimizerInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = metaTagOptimizerInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const contentRows = await getOwnedContentRows(parsed.data.contentIds, actor.companyId, seoProject.id);
  if (!contentRows) {
    return actionError("Content not found for this SEO project.");
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "META_TAG_OPTIMIZATION", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    taskType: "META_TAG_OPTIMIZATION",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}

export type ApplyMetaTagSuggestionResult = {
  contentId: string;
  /** True when the requested metaTitle/metaDescription already exactly matched the current row — no revision was created and no write occurred. */
  noOp: boolean;
};

/**
 * The approval gate for a single suggestion — the first Meta Tag Optimizer
 * action that ever writes to Content. Never automatic: this is only ever
 * called from an explicit "Apply this suggestion" click (see
 * MetaTagOptimizerPicker.tsx's computeIsApplyEligible + confirm dialog).
 *
 * Ownership is re-verified fresh against BOTH the actor's company and the
 * exact seoProjectId the suggestion was generated under — reusing
 * getOwnedSeoProject/getOwnedContentRows unchanged from
 * startMetaTagOptimizerAction above, never trusting that the page still
 * belongs to that project/company just because a suggestion for it exists in
 * the caller's in-memory state.
 *
 * Same snapshot-before-overwrite discipline as updateLongFormContentAction/
 * restoreContentRevisionAction: the CURRENT title/metaTitle/metaDescription/
 * body are captured into a ContentRevision (changeSource: AI_REGENERATION,
 * the same choice updateLongFormContentAction already made for an
 * AI-proposed, human-approved write-back) inside the same transaction as the
 * write, under a row lock, before anything is overwritten — so applying a
 * suggestion is always reversible via the existing Version History/restore
 * flow, no new undo mechanism needed. The update's data object lists ONLY
 * metaTitle/metaDescription — title, body, status, url, keywords, authorId,
 * seoProjectId are never touched, regardless of what the suggestion says.
 */
export async function applyMetaTagSuggestionAction(input: ApplyMetaTagSuggestionInput): Promise<ActionResult<ApplyMetaTagSuggestionResult>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit content.");
  }

  const parsed = applyMetaTagSuggestionInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const rows = await getOwnedContentRows([parsed.data.contentId], actor.companyId, seoProject.id);
  if (!rows) {
    return actionError("This page could not be found in the selected SEO project.");
  }
  const content = rows[0];

  const newMetaTitle = parsed.data.metaTitle;
  const newMetaDescription = parsed.data.metaDescription;

  const preflight = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${content.id} FOR UPDATE`;
    const current = await tx.content.findUnique({ where: { id: content.id } });
    // Phase B M2 — re-checked inside the lock: the page can be trashed
    // between the ownership check and this write (stale review screen).
    if (!current || current.deletedAt) {
      return { kind: "not_found" as const };
    }

    if (current.metaTitle === newMetaTitle && current.metaDescription === newMetaDescription) {
      return { kind: "no_op" as const };
    }

    await createContentRevisionSnapshot(tx, {
      contentId: content.id,
      companyId: actor.companyId,
      title: current.title,
      metaTitle: current.metaTitle,
      metaDescription: current.metaDescription,
      body: current.body,
      changeSource: "AI_REGENERATION",
      createdByUserId: actor.id,
    });

    const updated = await tx.content.update({
      where: { id: content.id },
      data: {
        metaTitle: newMetaTitle,
        metaDescription: newMetaDescription,
      },
    });
    return { kind: "applied" as const, content: updated };
  });

  if (preflight.kind === "not_found") {
    return actionError("This page could not be found in the selected SEO project.");
  }
  if (preflight.kind === "no_op") {
    return actionSuccess({ contentId: content.id, noOp: true });
  }

  // Best-effort only, same reliability pattern restoreContentRevisionAction
  // already established: a failure here must never turn an
  // already-durably-persisted apply into a reported failure.
  try {
    await logActivity({
      actorId: actor.id,
      action: "content.ai_meta_tags_applied",
      companyId: actor.companyId,
      seoProjectId: seoProject.id,
      contentId: content.id,
      metadata: { metaTitle: newMetaTitle, metaDescription: newMetaDescription },
    });
  } catch (err) {
    console.error("Meta Tag Optimizer apply: failed to record the activity log", {
      contentId: content.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath(`/seo/${seoProject.id}/content`);
  revalidatePath(`/seo/${seoProject.id}/content/${content.id}`);
  return actionSuccess({ contentId: content.id, noOp: false });
}
