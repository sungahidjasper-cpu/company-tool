"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { cancelAiGenerationJob, getAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { describeDatabaseErrorForLog, isTransientPollingDatabaseError } from "@/lib/jobs/transient-database-error";

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

  let job: Awaited<ReturnType<typeof getAiGenerationJob>>;
  try {
    job = await getAiGenerationJob(id);
  } catch (error) {
    /*
     * A poll is a pure read of a job this action does not own or drive. If the
     * READ fails at the connection/protocol layer, that says nothing about the
     * generation itself — the job keeps running server-side regardless. Before
     * this guard the exception escaped the server action entirely, which
     * surfaced as a runtime error in the dev overlay and left the client's
     * polling interval to survive only incidentally (its rejected async
     * callback never reached the failure branch that clears the timer).
     *
     * `actionSuccess(null)` is the lifecycle's EXISTING "no verdict yet" signal
     * — pollGenerationJob already treats a null payload as "nothing decided,
     * keep polling" — so this reuses the established contract rather than
     * introducing a new response shape. The caller's MAX_POLL_MS ceiling still
     * bounds how long that can continue, so a permanently broken read can
     * never retry forever.
     */
    if (isTransientPollingDatabaseError(error)) {
      console.warn(
        `[ai-generation-job] transient database error polling job ${id}; reporting no verdict so the client retries. ${describeDatabaseErrorForLog(error)}`
      );
      return actionSuccess(null);
    }

    // Anything else is a genuine, unexpected fault. It is NOT disguised as a
    // retryable poll — it is logged in full server-side so it stays
    // diagnosable, and reported to the caller as a real error.
    console.error(`[ai-generation-job] unexpected database error polling job ${id}`, error);
    return actionError("Could not check the generation status. Please try again.");
  }

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
