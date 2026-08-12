import type { Prisma, WebsiteAnalysisJob } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { describeLlmError, LlmProviderError } from "@/lib/ai/providers/errors";
import { logger } from "@/lib/logger";
import {
  createWebsiteAnalysisJob,
  getWebsiteAnalysisJob,
  markWebsiteAnalysisJobCrawled,
  markWebsiteAnalysisJobFailed,
  markWebsiteAnalysisJobRetryingAiPhase,
  markWebsiteAnalysisJobRunning,
  markWebsiteAnalysisJobSucceeded,
  updateWebsiteAnalysisJobProgress,
} from "@/lib/jobs/job-table";
import type { Recommendation } from "@/features/seo/schemas/seo-audit.schema";
import { websiteAnalysisExtractionSchema } from "@/features/seo/schemas/website-analysis.schema";
import { generateSeoAudit } from "@/features/seo/services/seo-audit.service";
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
async function runCrawlPhase(job: { id: string; domain: string }): Promise<ScoredCrawl | null> {
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
  await markWebsiteAnalysisJobCrawled(job.id, crawl as unknown as Prisma.InputJsonValue);
  await updateWebsiteAnalysisJobProgress(job.id, 55);
  logger.info("Website analysis: crawl phase succeeded", { jobId: job.id, domain: job.domain, pageCount: crawl.pages.length });

  return scored;
}

/**
 * Extraction + SEO audit + merge, starting from an already-crawled and
 * already-scored bundle — used both for a fresh run (right after
 * runCrawlPhase) and for retryWebsiteAnalysis (starting from a previously
 * persisted crawl, skipping crawlWebsite entirely). On failure, classifies
 * the error so the UI can show a clear message instead of a raw one; the
 * crawl data already persisted by runCrawlPhase is left untouched.
 */
async function runAiPhase(job: { id: string }, { crawl, technical, onPage, structuredData, internalLinking }: ScoredCrawl) {
  logger.info("Website analysis: AI phase started", { jobId: job.id });
  try {
    const extraction = await generateStructuredOutput(websiteAnalysisExtractionSchema, {
      system:
        "You analyze small-to-medium business websites and extract structured business information from sampled page content. Be concise and only state what the content supports.",
      prompt: buildExtractionPrompt(crawl.pages),
    });
    await updateWebsiteAnalysisJobProgress(job.id, 70);

    const deterministicFindings: DeterministicFinding[] = [
      ...technical.findings,
      ...onPage.findings,
      ...structuredData.findings,
      ...internalLinking.findings,
    ];

    const audit = await generateSeoAudit({
      crawl,
      extraction,
      deterministicFindings,
      detectedSchemaTypes: structuredData.detectedSchemaTypes,
      missingSchemaTypes: structuredData.missingSchemaTypes,
      orphanPages: internalLinking.orphanPages,
      thinPageUrls: onPage.thinPageUrls,
    });
    await updateWebsiteAnalysisJobProgress(job.id, 95);

    const recommendations = [...deterministicFindings.map(findingToRecommendation), ...audit.recommendations].sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    );

    const categoryScoresForOverall: Partial<Record<SeoCategory, number | null>> = {
      TECHNICAL_SEO: technical.score.score,
      ON_PAGE_SEO: onPage.score.score,
      CONTENT_QUALITY: audit.contentQuality.score,
      STRUCTURED_DATA: structuredData.score.score,
      INTERNAL_LINKING: internalLinking.score.score,
      EEAT: audit.eeat.score,
      LOCAL_SEO: audit.localSeo.applicable ? audit.localSeo.score : null,
      GEO_READINESS: audit.geoReadiness.score,
      AEO_READINESS: audit.aeoReadiness.score,
    };
    const overallScore = computeOverallScore(categoryScoresForOverall);

    const resultJson = {
      businessCategory: extraction.businessCategory,
      services: extraction.services,
      locations: extraction.locations,
      topics: extraction.topics,
      crawledPages: crawl.pages.map((page) => ({ url: page.url, title: page.title })),
      sitemapUrlCount: crawl.sitemapUrls.length,
      warnings: crawl.warnings,
      overallScore,
      audit: {
        overallScore,
        categoryScores: {
          technicalSeo: technical.score,
          onPageSeo: onPage.score,
          contentQuality: audit.contentQuality,
          structuredData: structuredData.score,
          internalLinking: internalLinking.score,
          eeat: audit.eeat,
          localSeo: audit.localSeo,
          geoReadiness: audit.geoReadiness,
          aeoReadiness: audit.aeoReadiness,
        },
        recommendations,
        keywordIntelligence: audit.keywordIntelligence,
        contentGaps: audit.contentGaps,
        structuredDataRecommendations: audit.structuredDataRecommendations,
        detectedSchemaTypes: structuredData.detectedSchemaTypes,
        internalLinkingSuggestions: audit.internalLinkingSuggestions,
        orphanPages: internalLinking.orphanPages,
        executiveSummary: audit.executiveSummary,
      },
    } satisfies Prisma.InputJsonValue;

    await updateWebsiteAnalysisJobProgress(job.id, 99);
    await markWebsiteAnalysisJobSucceeded(job.id, resultJson, overallScore);
    logger.info("Website analysis: AI phase succeeded", { jobId: job.id, overallScore });
  } catch (error) {
    const errorType = error instanceof LlmProviderError ? error.type : "UNKNOWN";
    const errorMessage = describeLlmError(errorType).message;
    logger.error("Website analysis: AI phase failed", {
      jobId: job.id,
      errorType,
      rawError: error instanceof Error ? error.message : String(error),
    });
    await markWebsiteAnalysisJobFailed(job.id, errorMessage, errorType);
  }
}

async function runClaimedJob(job: { id: string; domain: string }) {
  const scored = await runCrawlPhase(job);
  if (!scored) return;
  await runAiPhase(job, scored);
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

  const running = await markWebsiteAnalysisJobRetryingAiPhase(job.id);
  void runAiPhase(running, scored);
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
