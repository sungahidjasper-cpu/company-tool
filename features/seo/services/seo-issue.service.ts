import type { WebsiteAnalysisIssueStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Ordered CRITICAL-first — Postgres enums sort by declaration order, and WebsiteAnalysisIssueSeverity was declared in that exact priority order. */
export function listIssuesForJob(jobId: string) {
  return prisma.websiteAnalysisIssue.findMany({
    where: { websiteAnalysisJobId: jobId },
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
  });
}

/** Scoped by jobId (not just issueId) so a caller can't update an issue that doesn't belong to the job they've already verified ownership of. */
export async function updateIssueStatus(issueId: string, jobId: string, status: WebsiteAnalysisIssueStatus) {
  const result = await prisma.websiteAnalysisIssue.updateMany({
    where: { id: issueId, websiteAnalysisJobId: jobId },
    data: { status },
  });
  return result.count > 0;
}
