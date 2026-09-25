"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { assertSafePublicUrl, UnsafePublishingUrlError } from "@/features/publishing/services/ssrf-guard.service";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";
import {
  competitorContentAnalysisInputSchema,
  MAX_COMPETITOR_URLS,
  type CompetitorContentAnalysisInput,
  type CompetitorUrlSource,
} from "@/features/ai-workspace/schemas/competitor-content-analysis.schema";
import { normalizeCompetitorUrl } from "@/features/ai-workspace/services/competitor-url";

/**
 * Verifies the SEO project belongs to the actor's company AND is not archived —
 * the same fetch-and-compare pattern every other action file duplicates its own
 * copy of (a "use server" file may only export async functions).
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  if (seoProject.deletedAt) return null;
  return seoProject;
}

/**
 * The eleventh AI Workspace tool's start action.
 *
 * This action owns the competitor-URL security boundary, and it is deliberately
 * done HERE rather than left to the dispatcher: an unsafe or unreachable URL
 * should be a clear, immediate message to the person who typed it, not a failed
 * AI job they have to go and read. The crawl itself still happens in the
 * dispatcher (it is slow, and the job/stream machinery exists precisely for
 * that), where the same guard runs again before anything is fetched.
 *
 * Two independent checks, both required:
 *   1. normalizeCompetitorUrl — pure shape validation, reduces to an origin,
 *      refuses non-https, credentials, and single-label hosts.
 *   2. assertSafePublicUrl — the EXISTING guard, which resolves DNS and refuses
 *      loopback, private, link-local and other internal addresses.
 *
 * Neither is sufficient alone: a public-looking hostname can still resolve to a
 * private address, which only the second can catch.
 *
 * Generate-and-display only: no Content, Keyword, KeywordCluster or Brand
 * Profile row is created or modified anywhere in this tool.
 */
export async function startCompetitorContentAnalysisAction(
  input: CompetitorContentAnalysisInput
): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = competitorContentAnalysisInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  // Brand Profile competitor URLs are company data, so a URL the user submitted
  // that also appears there is labelled as such. This only affects how the
  // origin is described — every URL goes through exactly the same validation.
  const brandProfile = await getBrandProfileByCompanyId(actor.companyId);
  const brandOrigins = new Set(
    (brandProfile?.competitorUrls ?? [])
      .map((url) => normalizeCompetitorUrl(url))
      .filter((result): result is { ok: true; origin: string; hostname: string } => result.ok)
      .map((result) => result.origin)
  );

  const competitors: { origin: string; source: CompetitorUrlSource }[] = [];
  const seen = new Set<string>();

  for (const raw of parsed.data.competitorUrls) {
    const normalized = normalizeCompetitorUrl(raw);
    if (!normalized.ok) {
      return actionError(normalized.reason);
    }
    if (seen.has(normalized.origin)) continue;

    // The DNS-resolving guard. Never skipped, never weakened, and never
    // bypassed by a value that merely looks public.
    try {
      await assertSafePublicUrl(normalized.origin);
    } catch (error) {
      if (error instanceof UnsafePublishingUrlError) {
        return actionError(`${normalized.hostname} cannot be analysed: ${error.message}`);
      }
      return actionError(`${normalized.hostname} could not be checked. Confirm the address is a public website and try again.`);
    }

    seen.add(normalized.origin);
    competitors.push({ origin: normalized.origin, source: brandOrigins.has(normalized.origin) ? "BRAND_PROFILE" : "USER" });
    if (competitors.length >= MAX_COMPETITOR_URLS) break;
  }

  if (competitors.length === 0) {
    return actionError("Enter at least one competitor URL.");
  }

  const jobInput = {
    seoProjectId: seoProject.id,
    competitors,
    targetTopic: parsed.data.targetTopic,
    notes: parsed.data.notes,
  };

  const inputHash = computeInputHash(jobInput);
  const existing = await findActiveAiGenerationJob(actor.companyId, "COMPETITOR_CONTENT_ANALYSIS", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    taskType: "COMPETITOR_CONTENT_ANALYSIS",
    inputJson: jobInput,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}
