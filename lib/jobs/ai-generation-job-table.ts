import { createHash } from "node:crypto";

import type { AiTaskType, Prisma, WebsiteAnalysisErrorType } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Job-row helpers for AiGenerationJob — the Phase 18 background-job
 * counterpart to job-table.ts's WebsiteAnalysisJob helpers, function-for-
 * function. No claim/SELECT-FOR-UPDATE helper here: unlike that file's
 * unused claimNextPendingWebsiteAnalysisJob, every AiGenerationJob is always
 * started by the same fire-and-forget call that created it — there's no
 * separate poller that would ever need to claim a row.
 */

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Deterministic fingerprint of a job's input, sorting object keys so key
 * order in the caller's object literal never affects the hash. Not
 * cryptographically sensitive — used only for exact-match duplicate
 * detection (see findActiveAiGenerationJob), the same discipline
 * website-analysis.service.ts's hashCrawlResult already applies to a
 * different problem.
 */
export function computeInputHash(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

export function createAiGenerationJob(input: {
  companyId: string;
  taskType: AiTaskType;
  inputJson: Prisma.InputJsonValue;
  inputHash: string;
  seoProjectId?: string;
  contentId?: string;
  createdById?: string;
}) {
  return prisma.aiGenerationJob.create({
    data: {
      companyId: input.companyId,
      taskType: input.taskType,
      inputJson: input.inputJson,
      inputHash: input.inputHash,
      seoProjectId: input.seoProjectId,
      contentId: input.contentId,
      createdById: input.createdById,
      status: "PENDING",
    },
  });
}

/**
 * Phase 30 Stage 10 live-verification finding — `id` is now reachable from a
 * user-editable `?jobId=` URL query param (the refresh-recovery feature),
 * not just a server-minted value, so it must be validated before ever
 * reaching a `@db.Uuid` column: Prisma throws a raw, unhandled type error
 * for a non-UUID string rather than returning null, the same class of bug
 * seo-project.service.ts's and knowledge-source.service.ts's own isUuid
 * guards already exist to prevent. A malformed id is exactly "not found,"
 * same as one that's simply never existed.
 */
export function getAiGenerationJob(id: string) {
  if (!isUuid(id)) return Promise.resolve(null);
  return prisma.aiGenerationJob.findUnique({ where: { id } });
}

/**
 * Duplicate-prevention lookup: if an identical request (same company, task
 * type, exact input fingerprint) already has a job that hasn't finished,
 * the caller should reuse it instead of starting a second, separately-
 * billed AI call. Deliberately not bounded to "recent" jobs — a
 * PENDING/RUNNING row is by definition still in flight; a job stuck in
 * either state because its process crashed without a restart to trigger
 * the reaper is a failure-recovery concern (see reapStaleAiGenerationJobs
 * in lib/startup.ts), not something this lookup should second-guess.
 */
export function findActiveAiGenerationJob(companyId: string, taskType: AiTaskType, inputHash: string) {
  return prisma.aiGenerationJob.findFirst({
    where: { companyId, taskType, inputHash, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
}

export function markAiGenerationJobRunning(id: string) {
  return prisma.aiGenerationJob.update({
    where: { id },
    data: { status: "RUNNING", progress: 10 },
  });
}

export function updateAiGenerationJobProgress(id: string, progress: number) {
  return prisma.aiGenerationJob.update({
    where: { id },
    data: { progress },
  });
}

/**
 * Phase 30 Stage 10 — a soft cancel: marks a still-active job CANCELLED so
 * the UI stops polling it and findActiveAiGenerationJob no longer treats it
 * as in-flight for duplicate-detection. Scoped to the owning company and to
 * PENDING/RUNNING only — cancelling a job that already finished (or was
 * already cancelled) is a no-op, reported via the returned count rather than
 * throwing. Does NOT abort whatever provider call is actually in flight;
 * see markAiGenerationJobSucceeded/Failed below for how a late-arriving
 * result from that call is prevented from overwriting the cancellation.
 */
export function cancelAiGenerationJob(id: string, companyId: string) {
  if (!isUuid(id)) return Promise.resolve({ count: 0 });
  return prisma.aiGenerationJob.updateMany({
    where: { id, companyId, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "CANCELLED" },
  });
}

/**
 * Phase 22 — throttle-written by the runner while a streaming generation is
 * RUNNING. `partialResultText: null` is a real, meaningful write (not a
 * no-op): it's how the runner signals a same-provider retry or cross-
 * provider fallback is about to start a fresh attempt, so a connected SSE
 * client (see the stream route handler, which polls this same row) knows to
 * discard whatever partial output it was showing rather than splice it with
 * the next attempt's. Presentation-only — never read by anything that
 * treats it as a validated or final result.
 */
/**
 * Phase 30 Stage 10 — guarded to RUNNING only, same reasoning as
 * markAiGenerationJobSucceeded/Failed below: a job the user has already
 * cancelled must not have its partial-text preview resurrected by a
 * still-in-flight streaming write that hasn't noticed yet.
 */
export function updateAiGenerationJobPartialText(id: string, partialResultText: string | null, progress?: number) {
  return prisma.aiGenerationJob.updateMany({
    where: { id, status: "RUNNING" },
    data: progress === undefined ? { partialResultText } : { partialResultText, progress },
  });
}

/**
 * Phase 30 Stage 10 — updateMany with a `status: "RUNNING"` guard, not
 * update(): the runner has no way to abort an in-flight provider call once
 * cancelAiGenerationJob has marked a job CANCELLED, so that call's eventual
 * result can still arrive here. Without this guard it would silently flip
 * the job back to SUCCEEDED, contradicting the cancellation and (via Stage
 * 10's refresh-recovery) potentially surfacing that stale result to a user
 * who already navigated away. A cancelled/already-terminal job simply
 * matches zero rows and this becomes a no-op.
 */
export function markAiGenerationJobSucceeded(id: string, resultJson: Prisma.InputJsonValue) {
  return prisma.aiGenerationJob.updateMany({
    where: { id, status: "RUNNING" },
    data: { status: "SUCCEEDED", progress: 100, resultJson },
  });
}

/** Phase 30 Stage 10 — same RUNNING guard as markAiGenerationJobSucceeded above, for the same reason. */
export function markAiGenerationJobFailed(id: string, errorMessage: string, errorType?: WebsiteAnalysisErrorType) {
  return prisma.aiGenerationJob.updateMany({
    where: { id, status: "RUNNING" },
    data: { status: "FAILED", errorMessage, errorType },
  });
}
