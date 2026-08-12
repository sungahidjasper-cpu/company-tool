"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { listIssuesForJob, updateIssueStatus } from "@/features/seo/services/seo-issue.service";
import { getWebsiteAnalysisJobById } from "@/features/seo/services/website-analysis.service";
import type { WebsiteAnalysisIssueStatus } from "@/lib/generated/prisma/client";

export async function listIssuesForJobAction(
  jobId: string
): Promise<ActionResult<Awaited<ReturnType<typeof listIssuesForJob>>>> {
  const actor = await requireUser();

  const job = await getWebsiteAnalysisJobById(jobId);
  if (!job || job.companyId !== actor.companyId) {
    return actionError("Website analysis job not found.");
  }

  const issues = await listIssuesForJob(jobId);
  return actionSuccess(issues);
}

export async function updateIssueStatusAction(
  issueId: string,
  jobId: string,
  status: WebsiteAnalysisIssueStatus
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to update this issue.");
  }

  const job = await getWebsiteAnalysisJobById(jobId);
  if (!job || job.companyId !== actor.companyId) {
    return actionError("Website analysis job not found.");
  }

  const updated = await updateIssueStatus(issueId, jobId, status);
  if (!updated) {
    return actionError("Issue not found.");
  }

  return actionSuccess({ id: issueId });
}
