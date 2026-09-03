"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { contentGapAnalysisInputSchema, type ContentGapAnalysisInput } from "@/features/ai-workspace/schemas/content-gap-analysis.schema";
import { extractContentGapsFromAudit } from "@/features/ai-workspace/services/content-gap-analysis.service";

/**
 * Verifies the SEO project belongs to the actor's company — the same
 * fetch-and-compare pattern every other action file duplicates its own
 * copy of (a "use server" file may only export async functions, so a plain
 * helper can't be shared from one action file to another).
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  return seoProject;
}

/**
 * The ninth AI Workspace tool's start action. Unlike every prior tool, the
 * user never picks the underlying data row directly — per Stage A
 * discovery, the SEO project's own latest usable Website Analysis is
 * resolved here, server-side, and re-verified again below (never trusted
 * from the client). "Usable" means SUCCEEDED and carrying at least one
 * real content-gap entry — a job can succeed with a null/empty audit (the
 * crawl succeeded but AI enrichment didn't), so the most recent SUCCEEDED
 * job is not always the right one; the most recent one that actually has
 * gap data is. A handful of recent jobs is enough to find it in every
 * real case observed in this database.
 */
export async function startContentGapAnalysisAction(input: ContentGapAnalysisInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = contentGapAnalysisInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const candidateJobs = await prisma.websiteAnalysisJob.findMany({
    where: { seoProjectId: seoProject.id, companyId: actor.companyId, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, resultJson: true },
  });

  const usable = candidateJobs.map((job) => ({ id: job.id, gapCount: extractContentGapsFromAudit(job.resultJson).length })).find((entry) => entry.gapCount > 0);

  if (!usable) {
    return actionError("No completed SEO audit with content-gap data was found for this project. Run a Website Analysis first, or check that its latest run included AI enrichment.");
  }

  const jobInput = { seoProjectId: seoProject.id, websiteAnalysisJobId: usable.id };
  const inputHash = computeInputHash(jobInput);
  const existing = await findActiveAiGenerationJob(actor.companyId, "CONTENT_GAP_ANALYSIS", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    taskType: "CONTENT_GAP_ANALYSIS",
    inputJson: jobInput,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}
