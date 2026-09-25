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
  applyContentRewriteInputSchema,
  contentRewriterInputSchema,
  type ApplyContentRewriteInput,
  type ContentRewriterInput,
} from "@/features/ai-workspace/schemas/content-rewriter.schema";

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
   * the rule getOwnedContent below already applies to the Content row and
   * that schema-markup-generator.actions.ts now applies to both. The picker
   * lists only live projects and the C4 contextual action hides itself for a
   * trashed one, but neither is the boundary: this is. Both
   * startContentRewriteAction and applyContentRewriteAction call this, so the
   * generate and apply paths are covered by this single guard.
   *
   * Truthy rather than `!== null`: a fixture or caller may omit the field
   * entirely, and `undefined !== null` would wrongly reject a live project.
   */
  if (seoProject.deletedAt) return null;
  return seoProject;
}

/**
 * Verifies the selected Content row belongs to BOTH the actor's company and
 * the exact SEO project selected — mirrors meta-tag-optimizer.actions.ts's
 * own getOwnedContentRows, narrowed to a single row since this tool
 * operates on one page at a time (the approved v1 workflow), not a bulk
 * selection.
 */
async function getOwnedContent(contentId: string, companyId: string, seoProjectId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { seoProject: { select: { companyId: true } } },
  });
  if (!content || content.companyId !== companyId || content.seoProjectId !== seoProjectId) return null;
  // Phase B M2 — a trashed page is not an editable page. The picker already
  // filters these out when listing, so reaching here means either a stale
  // screen or a direct action call; both are rejected the same way.
  if (content.deletedAt) return null;
  return content;
}

/**
 * Background-job counterpart to the other tools' startXGenerationAction —
 * no synchronous variant, matching every other tool's shape. Generation
 * only: this action never writes to Content and never creates a
 * ContentRevision — see content-rewriter.service.ts's own filter and
 * lib/jobs/ai-generation-job-runner.ts's dispatchContentRewriter, neither of
 * which touches the database beyond read-only lookups. Applying an accepted
 * rewrite is applyContentRewriteAction, below.
 *
 * Never trusts any client-supplied title/metaTitle/metaDescription/body:
 * this action's input schema (contentRewriterInputSchema) only accepts
 * seoProjectId/contentId — there is no field for the client to even attempt
 * to supply current content text through. The real current values are read
 * fresh from the database, both here (for the eligibility check) and again,
 * independently, by the dispatcher when the job actually runs.
 */
export async function startContentRewriteAction(input: ContentRewriterInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = contentRewriterInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const content = await getOwnedContent(parsed.data.contentId, actor.companyId, seoProject.id);
  if (!content) {
    return actionError("Content not found for this SEO project.");
  }

  if (!content.body || !content.body.trim()) {
    return actionError("This page has no body text to rewrite.");
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "CONTENT_REWRITE", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    contentId: content.id,
    taskType: "CONTENT_REWRITE",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}

export type ApplyContentRewriteResult = {
  contentId: string;
  /** True when the requested title/metaTitle/metaDescription/body already exactly matched the current row — no revision was created and no write occurred. */
  noOp: boolean;
};

/**
 * The approval gate for a rewrite — the first Content Rewriter action that
 * ever writes to Content. Never automatic: this is only ever called from an
 * explicit "Apply this rewrite" click (see ContentRewriterPicker.tsx's
 * computeCanApplyRewrite + confirm dialog). Mirrors
 * meta-tag-optimizer.actions.ts's applyMetaTagSuggestionAction exactly,
 * scaled to four fields instead of two.
 *
 * Ownership is re-verified fresh against BOTH the actor's company and the
 * exact seoProjectId the rewrite was generated under — reusing
 * getOwnedSeoProject/getOwnedContent unchanged from startContentRewriteAction
 * above, never trusting that the page still belongs to that project/company
 * just because a rewrite for it exists in the caller's in-memory state.
 *
 * Same snapshot-before-overwrite discipline as applyMetaTagSuggestionAction/
 * restoreContentRevisionAction: the CURRENT title/metaTitle/metaDescription/
 * body are captured into a ContentRevision (changeSource: AI_REGENERATION)
 * inside the same transaction as the write, under a row lock, before
 * anything is overwritten — so applying a rewrite is always reversible via
 * the existing Version History/restore flow, no new undo mechanism needed.
 * The update's data object lists ONLY title/metaTitle/metaDescription/body —
 * status, url, keywords, authorId, seoProjectId are never touched, and no
 * new Content row is ever created.
 */
export async function applyContentRewriteAction(input: ApplyContentRewriteInput): Promise<ActionResult<ApplyContentRewriteResult>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit content.");
  }

  const parsed = applyContentRewriteInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const content = await getOwnedContent(parsed.data.contentId, actor.companyId, seoProject.id);
  if (!content) {
    return actionError("This page could not be found in the selected SEO project.");
  }

  const newTitle = parsed.data.title;
  const newMetaTitle = parsed.data.metaTitle;
  const newMetaDescription = parsed.data.metaDescription;
  const newBody = parsed.data.body;

  const preflight = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${content.id} FOR UPDATE`;
    const current = await tx.content.findUnique({ where: { id: content.id } });
    // Phase B M2 — re-checked INSIDE the lock, not just at the ownership
    // step above: the page can be trashed between the two, which is exactly
    // the stale-review-screen case.
    if (!current || current.deletedAt) {
      return { kind: "not_found" as const };
    }

    if (current.title === newTitle && current.metaTitle === newMetaTitle && current.metaDescription === newMetaDescription && current.body === newBody) {
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
        title: newTitle,
        metaTitle: newMetaTitle,
        metaDescription: newMetaDescription,
        body: newBody,
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

  // Best-effort only, same reliability pattern applyMetaTagSuggestionAction
  // already established: a failure here must never turn an
  // already-durably-persisted apply into a reported failure.
  try {
    await logActivity({
      actorId: actor.id,
      action: "content.ai_rewrite_applied",
      companyId: actor.companyId,
      seoProjectId: seoProject.id,
      contentId: content.id,
      metadata: { title: newTitle },
    });
  } catch (err) {
    console.error("Content Rewriter apply: failed to record the activity log", {
      contentId: content.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath(`/seo/${seoProject.id}/content`);
  revalidatePath(`/seo/${seoProject.id}/content/${content.id}`);
  return actionSuccess({ contentId: content.id, noOp: false });
}
