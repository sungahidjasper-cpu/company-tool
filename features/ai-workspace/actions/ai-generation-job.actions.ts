"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { cancelAiGenerationJob, getAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";

/**
 * One polling action for both CONTENT_BRIEF and CONTENT_DRAFT jobs, since
 * they're rows in the same AiGenerationJob table — company-scoped exactly
 * like getWebsiteAnalysisJobAction: a job id belonging to another company
 * reads back as "not found," never as that company's data.
 */
export async function getAiGenerationJobAction(id: string): Promise<
  ActionResult<Awaited<ReturnType<typeof getAiGenerationJob>>>
> {
  const actor = await requireUser();

  const job = await getAiGenerationJob(id);
  if (!job || job.companyId !== actor.companyId) {
    return actionError("Generation job not found.");
  }

  return actionSuccess(job);
}

/**
 * Phase 30 Stage 10 — a soft cancel: no role gate beyond being an
 * authenticated member of the owning company, matching
 * getAiGenerationJobAction's own permission shape exactly (any actor may
 * poll or cancel their own company's job). See cancelAiGenerationJob's
 * comment for what "soft" means here.
 */
export async function cancelAiGenerationJobAction(id: string): Promise<ActionResult<{ cancelled: boolean }>> {
  const actor = await requireUser();

  const result = await cancelAiGenerationJob(id, actor.companyId);
  if (result.count === 0) {
    return actionError("This generation could not be cancelled — it may have already finished.");
  }

  return actionSuccess({ cancelled: true });
}
