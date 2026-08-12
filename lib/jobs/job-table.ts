import type { Prisma, WebsiteAnalysisErrorType } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Lightweight Postgres-backed job queue for WebsiteAnalysisJob — no Redis,
 * no queue product. Claiming uses SELECT ... FOR UPDATE SKIP LOCKED inside a
 * transaction so multiple callers (a fire-and-forget kickoff plus a manual
 * "process next" trigger) can't double-claim the same row.
 */

export function createWebsiteAnalysisJob(input: {
  companyId: string;
  domain: string;
  seoProjectId?: string;
  clientId?: string;
}) {
  return prisma.websiteAnalysisJob.create({
    data: {
      companyId: input.companyId,
      domain: input.domain,
      seoProjectId: input.seoProjectId,
      clientId: input.clientId,
      status: "PENDING",
    },
  });
}

export function getWebsiteAnalysisJob(id: string) {
  return prisma.websiteAnalysisJob.findUnique({ where: { id } });
}

export async function claimNextPendingWebsiteAnalysisJob() {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "WebsiteAnalysisJob"
      WHERE status = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    const row = rows[0];
    if (!row) return null;

    return tx.websiteAnalysisJob.update({
      where: { id: row.id },
      data: { status: "RUNNING", progress: 0 },
    });
  });
}

export function markWebsiteAnalysisJobRunning(id: string) {
  return prisma.websiteAnalysisJob.update({
    where: { id },
    data: { status: "RUNNING", progress: 0 },
  });
}

/** Resumes a FAILED job at the AI phase (progress 55, matching where a fresh run hands off from crawl to AI), clearing the previous failure. */
export function markWebsiteAnalysisJobRetryingAiPhase(id: string) {
  return prisma.websiteAnalysisJob.update({
    where: { id },
    data: { status: "RUNNING", progress: 55, errorMessage: null, errorType: null },
  });
}

export function updateWebsiteAnalysisJobProgress(id: string, progress: number) {
  return prisma.websiteAnalysisJob.update({
    where: { id },
    data: { progress },
  });
}

export function markWebsiteAnalysisJobSucceeded(
  id: string,
  resultJson: Prisma.InputJsonValue,
  overallScore?: number
) {
  return prisma.websiteAnalysisJob.update({
    where: { id },
    data: { status: "SUCCEEDED", progress: 100, resultJson, overallScore },
  });
}

/** Persisted as soon as crawling succeeds — independent of whether the AI stage that follows succeeds, so a failed AI stage can be retried without re-crawling. */
export function markWebsiteAnalysisJobCrawled(id: string, crawlResultJson: Prisma.InputJsonValue) {
  return prisma.websiteAnalysisJob.update({
    where: { id },
    data: { crawlResultJson },
  });
}

export function markWebsiteAnalysisJobFailed(
  id: string,
  errorMessage: string,
  errorType?: WebsiteAnalysisErrorType
) {
  return prisma.websiteAnalysisJob.update({
    where: { id },
    data: { status: "FAILED", errorMessage, errorType },
  });
}
