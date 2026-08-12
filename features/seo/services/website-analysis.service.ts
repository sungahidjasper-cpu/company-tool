import { createHash } from "node:crypto";

import type { Prisma, WebsiteAnalysisJob } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { describeLlmError, LlmProviderError } from "@/lib/ai/providers/errors";
import { logger } from "@/lib/logger";
import {
  createWebsiteAnalysisJob,
  findCachedAiResult,
  getWebsiteAnalysisJob,
  markWebsiteAnalysisJobCrawled,
  markWebsiteAnalysisJobFailed,
  markWebsiteAnalysisJobRetryingAiPhase,
  markWebsiteAnalysisJobRunning,
  markWebsiteAnalysisJobSucceeded,
  updateWebsiteAnalysisJobProgress,
} from "@/lib/jobs/job-table";
import { parseWebsiteAnalysisResult, type Recommendation } from "@/features/seo/schemas/seo-audit.schema";
import { websiteAnalysisExtractionSchema, type WebsiteAnalysisExtraction } from "@/features/seo/schemas/website-analysis.schema";
import type { ReportData } from "@/features/reports/services/report.service";
import { formatEnumLabel } from "@/lib/utils";
import { generateSeoAudit, PROMPT_VERSION } from "@/features/seo/services/seo-audit.service";
import {
  computeInternalLinkingScore,
  computeOnPageSeoScore,
  computeOverallScore,
  computeStructuredDataScore,
  computeTechnicalSeoScore,
  PRIORITIES,
  type DeterministicFinding,
  type Priority,
  type SeoCategory,
} from "@/features/seo/services/seo-scoring.service";
import { crawlWebsite, type CrawledPage, type CrawlResult } from "@/features/seo/services/website-crawler.service";
import { detectWebsiteAnalysisIssues } from "@/features/seo/services/seo-issue-detection.service";

function buildExtractionPrompt(pages: CrawledPage[]): string {
  const pageSummaries = pages
    .map(
      (page) =>
        `URL: ${page.url}\nTitle: ${page.title ?? "(none)"}\nMeta description: ${page.metaDescription ?? "(none)"}\nHeadings: ${page.headings.join(" | ") || "(none)"}\nBody excerpt: ${page.bodyText.slice(0, 800)}`
    )
    .join("\n\n---\n\n");

  return `Below is content sampled from a business's website (homepage plus a sample of other pages). Based only on this content, infer the business's category, the services/products it offers, the locations it serves, and its primary content topics.\n\n${pageSummaries}`;
}

/** Deterministic findings (e.g. "robots.txt blocking important pages") become Recommendation-shaped rows so one merged, sorted list serves both the "Recommendations" and "Opportunity Scoring" views. */
function findingToRecommendation(finding: DeterministicFinding): Recommendation {
  return {
    title: finding.title,
    description: finding.description,
    whyItMatters: finding.description,
    estimatedImpact: finding.priority === "LOW" ? "LOW" : finding.priority === "MEDIUM" ? "MEDIUM" : "HIGH",
    difficulty: "MEDIUM",
    priority: finding.priority,
    category: finding.category,
  };
}

const PRIORITY_RANK: Record<Priority, number> = Object.fromEntries(
  PRIORITIES.map((priority, index) => [priority, index])
) as Record<Priority, number>;

type ScoredCrawl = {
  crawl: CrawlResult;
  technical: ReturnType<typeof computeTechnicalSeoScore>;
  onPage: ReturnType<typeof computeOnPageSeoScore>;
  structuredData: ReturnType<typeof computeStructuredDataScore>;
  internalLinking: ReturnType<typeof computeInternalLinkingScore>;
};

/**
 * Phase 11C — a stable content fingerprint for the Objective 10 AI-result
 * cache: if a later analysis of the same domain produces a crawl that
 * hashes identically, its AI output can be reused instead of regenerated.
 * Not cryptographically sensitive — SHA-256 is used only for its low
 * collision rate on structured data, not for any security property.
 */
function hashCrawlResult(crawl: CrawlResult): string {
  return createHash("sha256").update(JSON.stringify(crawl)).digest("hex");
}

function scoreCrawl(crawl: CrawlResult): ScoredCrawl {
  return {
    crawl,
    technical: computeTechnicalSeoScore(crawl),
    onPage: computeOnPageSeoScore(crawl),
    structuredData: computeStructuredDataScore(crawl),
    internalLinking: computeInternalLinkingScore(crawl),
  };
}

/**
 * Crawls the domain and computes deterministic scores, persisting the raw
 * crawl result as soon as it succeeds — independent of whether the AI phase
 * that follows it succeeds. Returns null (job already marked FAILED) when
 * there's nothing to hand off to the AI phase.
 */
async function runCrawlPhase(job: { id: string; domain: string }): Promise<{ scored: ScoredCrawl; crawlHash: string } | null> {
  logger.info("Website analysis: crawl phase started", { jobId: job.id, domain: job.domain });
  await updateWebsiteAnalysisJobProgress(job.id, 10);
  const crawl = await crawlWebsite(job.domain);
  await updateWebsiteAnalysisJobProgress(job.id, 50);

  if (crawl.pages.length === 0) {
    logger.warn("Website analysis: crawl found no pages", { jobId: job.id, domain: job.domain, warnings: crawl.warnings });
    await markWebsiteAnalysisJobFailed(job.id, `Could not crawl any pages for this domain. ${crawl.warnings.join(" ")}`);
    return null;
  }

  const scored = scoreCrawl(crawl);
  // Computed once here and threaded through to runAiPhase (rather than
  // recomputed later from a DB read-back) so it can never drift from what's
  // actually stored on the row — a jsonb round-trip isn't guaranteed to
  // preserve key order byte-for-byte, which a fresh recompute would be
  // sensitive to.
  const crawlHash = hashCrawlResult(crawl);
  await markWebsiteAnalysisJobCrawled(job.id, crawl as unknown as Prisma.InputJsonValue, crawlHash);

  const issues = await detectWebsiteAnalysisIssues(crawl, {
    detectedSchemaTypes: scored.structuredData.detectedSchemaTypes,
    orphanPages: scored.internalLinking.orphanPages,
  });
  if (issues.length > 0) {
    await prisma.websiteAnalysisIssue.createMany({
      data: issues.map((issue) => ({ ...issue, websiteAnalysisJobId: job.id })),
    });
  }
  logger.info("Website analysis: issue detection complete", { jobId: job.id, issueCount: issues.length });

  await updateWebsiteAnalysisJobProgress(job.id, 55);
  logger.info("Website analysis: crawl phase succeeded", { jobId: job.id, domain: job.domain, pageCount: crawl.pages.length });

  return { scored, crawlHash };
}

type AiFailure = { errorType: NonNullable<WebsiteAnalysisJob["errorType"]>; errorMessage: string };

function classifyAiFailure(error: unknown): AiFailure {
  const errorType = error instanceof LlmProviderError ? error.type : "UNKNOWN";
  return { errorType, errorMessage: describeLlmError(errorType).message };
}

/**
 * AI (extraction + audit) is an OPTIONAL enrichment layer on top of the
 * crawl + deterministic issue detection that already succeeded in
 * runCrawlPhase — it is never required to produce a viewable result. If
 * either AI call fails entirely (quota, auth, rate limit, timeout, provider
 * outage — anything LlmProviderError-shaped), that failure is recorded as a
 * non-blocking advisory (reusing errorType/errorMessage) and the job still
 * finishes SUCCEEDED with whatever deterministic data exists (crawl,
 * issues, and business info if extraction did complete). A PARTIAL audit
 * failure (Phase 11C — some but not all of the 3 independent audit tasks
 * failed, see seo-audit.service.ts) does NOT set this job-level advisory —
 * the job succeeds with a full, non-null audit object whose specific
 * missing sections are null; the UI shows an "unavailable for this run"
 * state on just those sections, not a global banner, since the sections
 * that did succeed are genuinely complete and shouldn't be shadowed by one.
 * The job is only ever marked FAILED here for a genuine application/
 * database error while finalizing — never solely because AI enrichment
 * didn't complete. Used both for a fresh run (right after runCrawlPhase)
 * and for retryWebsiteAnalysis (starting from a previously persisted
 * crawl, skipping crawlWebsite entirely).
 */
async function runAiPhase(
  job: { id: string; domain: string; companyId: string },
  crawlHash: string,
  { crawl, technical, onPage, structuredData, internalLinking }: ScoredCrawl
) {
  logger.info("Website analysis: AI phase started", { jobId: job.id });

  const deterministicFindings: DeterministicFinding[] = [
    ...technical.findings,
    ...onPage.findings,
    ...structuredData.findings,
    ...internalLinking.findings,
  ];

  // Phase 11C, Objective 10: an identical prior crawl + the current prompt
  // version means the last AI output is still valid — reuse it and skip
  // every AI provider call for this run entirely (the ">90% fewer AI
  // calls" cost-optimization goal, realized directly for repeat analyses
  // of an unchanged site).
  const cached = await findCachedAiResult(job.companyId, job.domain, crawlHash, PROMPT_VERSION);
  if (cached && cached.resultJson) {
    logger.info("Website analysis: reusing a prior job's AI output — crawl content and prompt version match exactly", {
      jobId: job.id,
      reusedFromJobId: cached.id,
    });
    await updateWebsiteAnalysisJobProgress(job.id, 99);
    await markWebsiteAnalysisJobSucceeded(job.id, cached.resultJson, cached.overallScore ?? undefined);
    return;
  }

  let extraction: WebsiteAnalysisExtraction | null = null;
  let aiFailure: AiFailure | null = null;

  try {
    extraction = await generateStructuredOutput(websiteAnalysisExtractionSchema, {
      system:
        "You analyze small-to-medium business websites and extract structured business information from sampled page content. Be concise and only state what the content supports.",
      prompt: buildExtractionPrompt(crawl.pages),
      taskType: "EXTRACTION",
      promptVersion: PROMPT_VERSION,
      websiteAnalysisJobId: job.id,
    });
    await updateWebsiteAnalysisJobProgress(job.id, 70);
  } catch (error) {
    aiFailure = classifyAiFailure(error);
    logger.warn("Website analysis: AI extraction unavailable — deterministic crawl/issue results are preserved", {
      jobId: job.id,
      errorType: aiFailure.errorType,
      rawError: error instanceof Error ? error.message : String(error),
    });
  }

  let audit: Awaited<ReturnType<typeof generateSeoAudit>> | null = null;
  if (extraction) {
    try {
      audit = await generateSeoAudit({
        websiteAnalysisJobId: job.id,
        crawl,
        extraction,
        deterministicFindings,
        detectedSchemaTypes: structuredData.detectedSchemaTypes,
        missingSchemaTypes: structuredData.missingSchemaTypes,
        orphanPages: internalLinking.orphanPages,
        thinPageUrls: onPage.thinPageUrls,
      });
      await updateWebsiteAnalysisJobProgress(job.id, 95);
    } catch (error) {
      aiFailure = classifyAiFailure(error);
      logger.warn("Website analysis: AI audit unavailable — deterministic crawl/issue results are preserved", {
        jobId: job.id,
        errorType: aiFailure.errorType,
        rawError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    let overallScore: number | null = null;
    let auditJson: Prisma.InputJsonValue | null = null;

    if (audit) {
      const aiRecommendations = audit.recommendations ?? [];
      const recommendations = [...deterministicFindings.map(findingToRecommendation), ...aiRecommendations].sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      );

      const categoryScoresForOverall: Partial<Record<SeoCategory, number | null>> = {
        TECHNICAL_SEO: technical.score.score,
        ON_PAGE_SEO: onPage.score.score,
        CONTENT_QUALITY: audit.scores?.contentQuality.score ?? null,
        STRUCTURED_DATA: structuredData.score.score,
        INTERNAL_LINKING: internalLinking.score.score,
        EEAT: audit.scores?.eeat.score ?? null,
        LOCAL_SEO: audit.scores?.localSeo.applicable ? audit.scores.localSeo.score : null,
        GEO_READINESS: audit.scores?.geoReadiness.score ?? null,
        AEO_READINESS: audit.scores?.aeoReadiness.score ?? null,
      };
      overallScore = computeOverallScore(categoryScoresForOverall);

      auditJson = {
        overallScore,
        categoryScores: {
          technicalSeo: technical.score,
          onPageSeo: onPage.score,
          contentQuality: audit.scores?.contentQuality ?? null,
          structuredData: structuredData.score,
          internalLinking: internalLinking.score,
          eeat: audit.scores?.eeat ?? null,
          localSeo: audit.scores?.localSeo ?? null,
          geoReadiness: audit.scores?.geoReadiness ?? null,
          aeoReadiness: audit.scores?.aeoReadiness ?? null,
        },
        recommendations,
        keywordIntelligence: audit.contentIntelligence?.keywordIntelligence ?? null,
        contentGaps: audit.contentIntelligence?.contentGaps ?? null,
        structuredDataRecommendations: audit.contentIntelligence?.structuredDataRecommendations ?? null,
        detectedSchemaTypes: structuredData.detectedSchemaTypes,
        internalLinkingSuggestions: audit.contentIntelligence?.internalLinkingSuggestions ?? null,
        orphanPages: internalLinking.orphanPages,
        executiveSummary: audit.executiveSummary ?? null,
      } satisfies Prisma.InputJsonValue;
    }

    const resultJson = {
      businessCategory: extraction?.businessCategory ?? "Unknown",
      services: extraction?.services ?? [],
      locations: extraction?.locations ?? [],
      topics: extraction?.topics ?? [],
      crawledPages: crawl.pages.map((page) => ({ url: page.url, title: page.title })),
      sitemapUrlCount: crawl.sitemapUrls.length,
      warnings: crawl.warnings,
      overallScore,
      audit: auditJson,
    } satisfies Prisma.InputJsonValue;

    await updateWebsiteAnalysisJobProgress(job.id, 99);
    await markWebsiteAnalysisJobSucceeded(job.id, resultJson, overallScore ?? undefined, aiFailure ?? undefined);

    if (aiFailure) {
      logger.warn("Website analysis: succeeded with deterministic-only results — AI enrichment unavailable", {
        jobId: job.id,
        errorType: aiFailure.errorType,
      });
    } else {
      logger.info("Website analysis: AI phase succeeded", { jobId: job.id, overallScore });
    }
  } catch (error) {
    // Reaching here means something OTHER than the AI calls themselves broke
    // (a bug in the merge logic, a database write failure, etc.) — a
    // genuine application failure, not an AI-availability issue, so this
    // (and only this) is what still produces a real FAILED job.
    logger.error("Website analysis: unexpected error finalizing results", {
      jobId: job.id,
      rawError: error instanceof Error ? error.message : String(error),
    });
    await markWebsiteAnalysisJobFailed(job.id, "An unexpected error occurred while finalizing the analysis.", "UNKNOWN");
  }
}

async function runClaimedJob(job: { id: string; domain: string; companyId: string }) {
  const result = await runCrawlPhase(job);
  if (!result) return;
  await runAiPhase(job, result.crawlHash, result.scored);
}

async function runWebsiteAnalysisJob(jobId: string) {
  const job = await markWebsiteAnalysisJobRunning(jobId);
  await runClaimedJob(job);
}

/**
 * Creates the job row and kicks off processing without waiting for it to
 * finish (a crawl takes 30-120s+) — the caller gets the PENDING job back
 * immediately and polls its status. This runs in the same Next.js process
 * rather than a separate worker, which is the pragmatic fit while this app
 * has exactly one job type and no standalone worker deployment yet.
 */
export async function startWebsiteAnalysis(input: {
  companyId: string;
  domain: string;
  seoProjectId?: string;
  clientId?: string;
}) {
  const job = await createWebsiteAnalysisJob(input);
  void runWebsiteAnalysisJob(job.id);
  return job;
}

export function getWebsiteAnalysisJobById(id: string) {
  return getWebsiteAnalysisJob(id);
}

/** Feeds the "Recent analyses" history list — lightweight rows, no resultJson. */
export function listRecentWebsiteAnalysisJobs(companyId: string, limit = 10) {
  return prisma.websiteAnalysisJob.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      domain: true,
      status: true,
      overallScore: true,
      createdAt: true,
    },
  });
}

/**
 * Retries just the AI phase of a job whose crawl already succeeded (i.e. it
 * has crawlResultJson) — skips crawlWebsite entirely and re-derives the
 * deterministic scores from the stored crawl (cheap, pure functions — no
 * need to persist them redundantly). Callers must have already validated
 * the job belongs to the caller's company and has crawlResultJson set.
 */
export async function retryWebsiteAnalysis(job: WebsiteAnalysisJob) {
  logger.info("Website analysis: retrying AI phase without re-crawling", { jobId: job.id });
  const crawl = job.crawlResultJson as unknown as CrawlResult;
  const scored = scoreCrawl(crawl);
  // job.crawlHash is only null for rows crawled before the Phase 11C
  // migration — recomputing here is the safe fallback for those, not the
  // normal path (the normal path reuses the value already stored on the
  // row rather than a DB-read-back recompute, which a jsonb round-trip
  // isn't guaranteed to reproduce byte-for-byte).
  const crawlHash = job.crawlHash ?? hashCrawlResult(crawl);

  const running = await markWebsiteAnalysisJobRetryingAiPhase(job.id);
  void runAiPhase(running, crawlHash, scored);
}

/**
 * Re-runs a full fresh analysis (new crawl, not a retry-in-place) for the
 * same domain/seoProject/client as an existing job — e.g. to check progress
 * since the last run without hunting down the original domain. Callers must
 * have already validated the source job belongs to the caller's company.
 */
export async function duplicateWebsiteAnalysis(sourceJob: WebsiteAnalysisJob) {
  logger.info("Website analysis: duplicating analysis", { sourceJobId: sourceJob.id, domain: sourceJob.domain });
  return startWebsiteAnalysis({
    companyId: sourceJob.companyId,
    domain: sourceJob.domain,
    seoProjectId: sourceJob.seoProjectId ?? undefined,
    clientId: sourceJob.clientId ?? undefined,
  });
}

/**
 * Every analysis persists permanently, so "history" is just this query —
 * scoped to a SEOProject or a Client (whichever the caller is browsing
 * from), newest first. Lightweight rows only, matching
 * listRecentWebsiteAnalysisJobs — full resultJson is fetched per-item on
 * demand via getWebsiteAnalysisJobById.
 */
export function listWebsiteAnalysisHistory(
  companyId: string,
  scope: { seoProjectId: string } | { clientId: string }
) {
  return prisma.websiteAnalysisJob.findMany({
    where: { companyId, ...scope },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      domain: true,
      status: true,
      overallScore: true,
      createdAt: true,
    },
  });
}

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/**
 * Phase 13 — Reports' SEO_AUDIT compute function. Sources entirely from the
 * SEO project's most recent SUCCEEDED WebsiteAnalysisJob (crawl + issues +
 * whatever AI enrichment that run had) — no new AI calls, no new crawling.
 * A deterministic-only run (AI never succeeded) still produces a complete,
 * honest report: scores render as "Unavailable" and executiveSummary is
 * simply omitted, but issues/severity breakdown/recommendations (which
 * always include the deterministic-findings-derived entries — see
 * seo-audit.schema.ts) are unaffected.
 */
export async function getSeoAuditReportData(companyId: string, seoProjectId?: string): Promise<ReportData> {
  if (!seoProjectId) {
    throw new Error("Select an SEO project to generate an SEO Audit Report.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) {
    throw new Error("SEO project not found.");
  }

  const job = await prisma.websiteAnalysisJob.findFirst({
    where: { seoProjectId, companyId, status: "SUCCEEDED" },
    orderBy: { createdAt: "desc" },
    include: { issues: true },
  });
  if (!job) {
    throw new Error(`No completed Website Analysis found for "${seoProject.name}" yet — run an analysis for this project first.`);
  }

  const result = parseWebsiteAnalysisResult(job);
  const audit = result?.audit ?? null;

  const severityCounts = new Map<string, number>();
  for (const issue of job.issues) {
    severityCounts.set(issue.severity, (severityCounts.get(issue.severity) ?? 0) + 1);
  }

  const scoreOrUnavailable = (score: number | undefined) => (score !== undefined ? `${score}/100` : "Unavailable");

  const summaryCards = [
    { label: "Domain", value: job.domain },
    { label: "Overall Score", value: scoreOrUnavailable(audit?.overallScore) },
    { label: "Technical SEO", value: scoreOrUnavailable(audit?.categoryScores.technicalSeo.score) },
    { label: "On-Page SEO", value: scoreOrUnavailable(audit?.categoryScores.onPageSeo.score) },
    { label: "Total Issues", value: String(job.issues.length) },
    { label: "Critical Issues", value: String(severityCounts.get("CRITICAL") ?? 0) },
  ];

  const chart = SEVERITY_ORDER.map((severity) => ({
    status: formatEnumLabel(severity),
    count: severityCounts.get(severity) ?? 0,
  }));

  const columns = ["Issue Type", "Severity", "URL", "Status"];
  const rows = job.issues.map((issue) => [
    formatEnumLabel(issue.issueType),
    formatEnumLabel(issue.severity),
    issue.url ?? "(site-wide)",
    formatEnumLabel(issue.status),
  ]);

  return {
    summaryCards,
    chart,
    columns,
    rows,
    executiveSummary: audit?.executiveSummary?.overallHealthNarrative ?? null,
    recommendations: audit?.recommendations ?? [],
  };
}
