"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { getAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";

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
