"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { metaTagOptimizerInputSchema, type MetaTagOptimizerInput } from "@/features/ai-workspace/schemas/meta-tag-optimizer.schema";

/**
 * Verifies the SEO project belongs to the actor's company — the same
 * fetch-and-compare pattern every AI Workspace actions file duplicates its
 * own copy of (a "use server" file may only export async functions, so a
 * plain helper can't be shared directly).
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
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
    if (row.seoProject.companyId !== companyId || row.seoProjectId !== seoProjectId) return null;
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
 * accepted suggestion is a separate, later-stage action.
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
