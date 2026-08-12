"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import {
  startWebsiteAnalysisSchema,
  type StartWebsiteAnalysisInput,
} from "@/features/seo/schemas/website-analysis.schema";
import {
  duplicateWebsiteAnalysis,
  getWebsiteAnalysisJobById,
  retryWebsiteAnalysis,
  startWebsiteAnalysis,
} from "@/features/seo/services/website-analysis.service";

export async function startWebsiteAnalysisAction(
  input: StartWebsiteAnalysisInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to run a website analysis.");
  }

  const parsed = startWebsiteAnalysisSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const job = await startWebsiteAnalysis({
    companyId: actor.companyId,
    domain: parsed.data.domain,
    seoProjectId: parsed.data.seoProjectId,
    clientId: parsed.data.clientId,
  });

  return actionSuccess({ id: job.id });
}

export async function getWebsiteAnalysisJobAction(id: string): Promise<
  ActionResult<Awaited<ReturnType<typeof getWebsiteAnalysisJobById>>>
> {
  const actor = await requireUser();

  const job = await getWebsiteAnalysisJobById(id);
  if (!job || job.companyId !== actor.companyId) {
    return actionError("Website analysis job not found.");
  }

  return actionSuccess(job);
}

/** Retries just the AI phase of a FAILED job whose crawl already succeeded — skips re-crawling. */
export async function retryWebsiteAnalysisAction(id: string): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to run a website analysis.");
  }

  const job = await getWebsiteAnalysisJobById(id);
  if (!job || job.companyId !== actor.companyId) {
    return actionError("Website analysis job not found.");
  }
  if (!job.crawlResultJson) {
    return actionError("Nothing to retry for this analysis — start a new one instead.");
  }

  await retryWebsiteAnalysis(job);
  return actionSuccess({ id: job.id });
}

/** Starts a brand-new analysis (fresh crawl) for the same domain/project/client as an existing one. */
export async function duplicateWebsiteAnalysisAction(id: string): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to run a website analysis.");
  }

  const sourceJob = await getWebsiteAnalysisJobById(id);
  if (!sourceJob || sourceJob.companyId !== actor.companyId) {
    return actionError("Website analysis job not found.");
  }

  const job = await duplicateWebsiteAnalysis(sourceJob);
  return actionSuccess({ id: job.id });
}
