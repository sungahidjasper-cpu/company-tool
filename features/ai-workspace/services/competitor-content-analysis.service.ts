import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";

import { computeExistingCoverage } from "@/features/ai-workspace/services/content-gap-analysis.service";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { containsFabricatedMetric, matchProjectKeywords } from "@/features/ai-workspace/services/topic-cluster-planner.service";
import {
  COMPETITOR_CONTENT_FORMATS,
  COMPETITOR_SEARCH_INTENTS,
  competitorAnalysisProviderOutputSchema,
  type CompetitorAnalysisResult,
  type CompetitorContentFormat,
  type CompetitorOpportunity,
  type CompetitorPage,
  type CompetitorSearchIntent,
  type CompetitorSite,
  type CompetitorUrlSource,
} from "@/features/ai-workspace/schemas/competitor-content-analysis.schema";

export const PROMPT_VERSION = 1;

const MAX_OUTPUT_TOKENS = 3500;
const MAX_OPPORTUNITIES = 8;
const MAX_KEY_COVERAGE = 5;
const BODY_EXCERPT_CHARS = 700;
const MAX_HEADINGS_IN_PROMPT = 12;

/**
 * The eleventh AI Workspace tool's system prompt.
 *
 * The governing rule is the separation of observation from inference. The only
 * competitor facts that exist are the pages the crawler actually fetched; this
 * app has no ranking, traffic, backlink, or any other competitive-intelligence
 * data, so any such figure in the output would necessarily be invented.
 */
export const COMPETITOR_CONTENT_ANALYSIS_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are an SEO content strategist reviewing pages that were actually fetched from a competitor's website, and comparing them against the customer's own project context.

The supplied competitor pages are the ONLY competitor information that exists. Analyse them and nothing else. Never mention, describe, or reason about a competitor page that is not in the supplied list. Never invent a competitor URL, page title, product, service, price, customer, partnership, or business fact that is not present in the supplied page text. If the supplied evidence does not answer something, say it is not visible from the pages analysed rather than filling the gap.

No ranking, traffic, search volume, keyword difficulty, impression, click, click-through-rate, backlink, domain authority, or conversion data has been supplied to you for anyone — not for the competitor and not for the customer. Never state or estimate any such figure, and never claim that a page "ranks", "is ranking", "gets traffic", "drives conversions", or performs in any measurable way. Never promise a ranking, a featured snippet, AI-assistant visibility, or any performance outcome.

Keep observation separate from recommendation. When classifying a page, describe what that page actually covers. When proposing an opportunity, make clear it is a suggestion for the customer to consider, grounded in the difference between what the competitor pages cover and what the customer's own listed content covers. Do not propose an opportunity the supplied evidence does not support, and do not pad the list — fewer, well-founded opportunities are better than many speculative ones.`;

export type CompetitorCrawlEvidence = {
  origin: string;
  source: CompetitorUrlSource;
  robotsTxtFound: boolean;
  warnings: string[];
  pages: { url: string; title: string | null; metaDescription: string | null; headings: string[]; bodyText: string }[];
};

export type CompetitorContentAnalysisContext = {
  /** Provenance for the AiUsageLog row. */
  seoProjectId: string;
  /** Required for enforceCompanyAiLimits. */
  companyId: string;
  seoProjectName: string;
  domain: string;
  /** USER INPUT. */
  targetTopic?: string;
  notes?: string;
  /** OBSERVED — what the crawler actually fetched. */
  evidence: CompetitorCrawlEvidence[];
  /** PLATFORM DATA — this project's own records. */
  existingTitles: string[];
  keywordTerms: string[];
  brandName?: string | null;
  targetAudience?: string | null;
};

/** Enum-validates a model-supplied classification; null when it isn't one of ours. Never guesses a fallback. */
export function normalizeCompetitorFormat(value: unknown): CompetitorContentFormat | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (COMPETITOR_CONTENT_FORMATS as readonly string[]).includes(upper) ? (upper as CompetitorContentFormat) : null;
}

export function normalizeCompetitorIntent(value: unknown): CompetitorSearchIntent | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (COMPETITOR_SEARCH_INTENTS as readonly string[]).includes(upper) ? (upper as CompetitorSearchIntent) : null;
}

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Cleans a free-text list: trims, drops empties, metric claims and duplicates, and caps length. */
function cleanTextList(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (out.length >= limit) break;
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value === "" || containsFabricatedMetric(value)) continue;
    const key = normalizeKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * The strict, deterministic filter.
 *
 * Everything factual is rebuilt from the crawl rather than accepted from the
 * model: every page in the result comes from the evidence, keyed by the url the
 * crawler recorded. A classification whose url is not in that set is dropped
 * outright — that is how a fabricated competitor page becomes impossible rather
 * than merely discouraged.
 *
 * Opportunities are model-generated, but their existing-coverage status and
 * related keywords are computed here against this project's own records.
 */
export function buildCompetitorAnalysisResult(
  raw: unknown,
  ctx: { targetTopic?: string; evidence: CompetitorCrawlEvidence[]; existingTitles: string[]; keywordTerms: string[] }
): CompetitorAnalysisResult {
  const base: CompetitorAnalysisResult = {
    targetTopic: ctx.targetTopic?.trim() || null,
    competitors: ctx.evidence.map((site) => ({
      origin: site.origin,
      source: site.source,
      pagesAnalyzed: site.pages.length,
      robotsTxtFound: site.robotsTxtFound,
      warnings: site.warnings,
      pages: site.pages.map((page) => ({
        url: page.url,
        title: page.title,
        metaDescription: page.metaDescription,
        headings: page.headings.slice(0, MAX_HEADINGS_IN_PROMPT),
        observedTopic: null,
        format: null,
        searchIntent: null,
        keyCoverage: [],
      })),
    })),
    opportunities: [],
  };

  const parsed = competitorAnalysisProviderOutputSchema.safeParse(raw);
  if (!parsed.success) return base;

  // Index the model's classifications by url, keeping only urls the crawler
  // genuinely returned. A classification for any other url is discarded.
  const crawledUrls = new Set(ctx.evidence.flatMap((site) => site.pages.map((page) => page.url)));
  const analysisByUrl = new Map<string, (typeof parsed.data.pageAnalyses)[number]>();
  for (const analysis of parsed.data.pageAnalyses) {
    const url = analysis.url.trim();
    if (!crawledUrls.has(url)) continue;
    // A metric claim in the topic itself discards the whole classification —
    // that sentence is the page's summary and cannot be partially trusted.
    // A metric claim in one coverage bullet only costs that bullet, because
    // cleanTextList removes it individually and the remaining bullets are
    // still genuine observations. Either way no fabricated figure survives.
    if (containsFabricatedMetric(analysis.observedTopic)) continue;
    if (!analysisByUrl.has(url)) analysisByUrl.set(url, analysis);
  }

  const competitors: CompetitorSite[] = base.competitors.map((site) => ({
    ...site,
    pages: site.pages.map((page): CompetitorPage => {
      const analysis = analysisByUrl.get(page.url);
      if (!analysis) return page;
      return {
        ...page,
        observedTopic: analysis.observedTopic.trim() || null,
        format: normalizeCompetitorFormat(analysis.format),
        searchIntent: normalizeCompetitorIntent(analysis.searchIntent),
        keyCoverage: cleanTextList(analysis.keyCoverage, MAX_KEY_COVERAGE),
      };
    }),
  }));

  const seenTopics = new Set<string>();
  const opportunities: CompetitorOpportunity[] = [];
  for (const item of parsed.data.opportunities) {
    if (opportunities.length >= MAX_OPPORTUNITIES) break;

    const topic = item.topic.trim();
    if (topic === "") continue;

    const whyItMatters = item.whyItMatters.trim();
    const recommendedAction = item.recommendedAction.trim();
    if (containsFabricatedMetric(topic) || containsFabricatedMetric(whyItMatters) || containsFabricatedMetric(recommendedAction)) continue;

    const key = normalizeKey(topic);
    if (seenTopics.has(key)) continue;
    seenTopics.add(key);

    const coverage = computeExistingCoverage(topic, ctx.existingTitles);
    opportunities.push({
      topic,
      whyItMatters,
      recommendedAction,
      suggestedContentType: normalizeCompetitorFormat(item.suggestedContentType),
      existingCoverage:
        coverage.status === "POSSIBLE_MATCH"
          ? { status: "POSSIBLE_MATCH", matchedTitle: coverage.matchedTitle }
          : { status: "NOT_FOUND", matchedTitle: null },
      relatedKeywords: matchProjectKeywords(topic, ctx.keywordTerms),
    });
  }

  return { ...base, competitors, opportunities };
}

export function buildPrompt(ctx: CompetitorContentAnalysisContext): string {
  const lines: string[] = [`Customer's website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];
  if (ctx.brandName) lines.push(`Customer's brand: ${ctx.brandName}`);
  if (ctx.targetAudience) lines.push(`Customer's target audience: ${ctx.targetAudience}`);

  if (ctx.targetTopic) lines.push("", `USER-PROVIDED FOCUS for this analysis: "${ctx.targetTopic}"`);
  if (ctx.notes) lines.push(`User-provided notes: ${ctx.notes}`);

  lines.push("", "COMPETITOR PAGES ACTUALLY FETCHED (the only competitor information that exists):");
  for (const site of ctx.evidence) {
    lines.push("", `Competitor site: ${site.origin} (${site.pages.length} page(s) fetched)`);
    if (site.pages.length === 0) {
      lines.push("- No pages could be fetched from this site.");
      continue;
    }
    for (const page of site.pages) {
      lines.push(`- URL: ${page.url}`);
      lines.push(`  Title: ${page.title ?? "(none)"}`);
      if (page.metaDescription) lines.push(`  Meta description: ${page.metaDescription}`);
      if (page.headings.length > 0) lines.push(`  Headings: ${page.headings.slice(0, MAX_HEADINGS_IN_PROMPT).join(" | ")}`);
      if (page.bodyText) {
        const excerpt = page.bodyText.length > BODY_EXCERPT_CHARS ? `${page.bodyText.slice(0, BODY_EXCERPT_CHARS)}...` : page.bodyText;
        lines.push(`  Body excerpt: ${excerpt}`);
      }
    }
  }

  lines.push("", "THE CUSTOMER'S OWN PROJECT DATA (real records from their account):");
  lines.push(
    ctx.existingTitles.length > 0
      ? `- Existing content titles: ${ctx.existingTitles.slice(0, 40).map((t) => `"${t}"`).join(", ")}`
      : "- Existing content titles: none recorded for this project."
  );
  lines.push(
    ctx.keywordTerms.length > 0
      ? `- Tracked keywords: ${ctx.keywordTerms.map((t) => `"${t}"`).join(", ")}`
      : "- Tracked keywords: none recorded for this project."
  );

  lines.push(
    "",
    "No ranking, traffic, search volume, keyword difficulty, backlink, or authority data is available for the competitor or the customer. Do not state or estimate any such figure."
  );

  lines.push(
    "",
    "Produce two things:",
    "1. pageAnalyses: one entry per competitor page listed above, using that page's EXACT url copied verbatim. For each, give observedTopic (what that page actually covers), format, searchIntent, and keyCoverage (up to " +
      MAX_KEY_COVERAGE +
      " specific things the page actually covers). Only classify pages listed above — never add a url of your own.",
    `2. opportunities: up to ${MAX_OPPORTUNITIES} content opportunities for the CUSTOMER, grounded in the difference between what the competitor pages cover and the customer's own listed content. Each needs topic, whyItMatters, suggestedContentType, and recommendedAction.`,
    `   format and suggestedContentType must be one of: ${COMPETITOR_CONTENT_FORMATS.join(", ")}.`,
    `   searchIntent must be one of: ${COMPETITOR_SEARCH_INTENTS.join(", ")}.`,
    "",
    "Do not include any ids, metrics, or urls other than the exact competitor page urls listed above — the application computes existing-coverage and keyword information itself."
  );

  return lines.join("\n");
}

/**
 * Generation entry point. A thin prompt-builder around the shared
 * generateStructuredOutput orchestrator — no changes to lib/ai/providers/*.
 *
 * Crawling happens before this, in the dispatcher: this function only ever
 * receives evidence that was already fetched and validated.
 */
export async function generateCompetitorContentAnalysis(
  ctx: CompetitorContentAnalysisContext,
  onChunk?: (event: StreamEvent) => void
): Promise<CompetitorAnalysisResult> {
  const options = {
    system: COMPETITOR_CONTENT_ANALYSIS_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "COMPETITOR_CONTENT_ANALYSIS" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };

  const raw = onChunk
    ? await generateStructuredOutputStreaming(competitorAnalysisProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(competitorAnalysisProviderOutputSchema, options);

  return buildCompetitorAnalysisResult(raw, {
    targetTopic: ctx.targetTopic,
    evidence: ctx.evidence,
    existingTitles: ctx.existingTitles,
    keywordTerms: ctx.keywordTerms,
  });
}
