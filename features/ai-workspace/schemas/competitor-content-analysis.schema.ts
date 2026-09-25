import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { optionalString } from "@/lib/zod-helpers";

/** Kept small on purpose: each competitor is a full crawl, and the crawler samples up to 12 pages per site. */
export const MAX_COMPETITOR_URLS = 3;

/**
 * The eleventh AI Workspace tool. Same v3-input / v4-output split every other
 * tool uses.
 *
 * competitorUrls are USER INPUT and are the one thing this tool cannot derive.
 * They are shape-validated here, normalized to an origin, and then — crucially
 * — proven safe by the existing DNS-resolving SSRF guard before anything is
 * fetched. This schema is never the security boundary on its own.
 */
export const competitorContentAnalysisInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
  competitorUrls: z.array(z.string().trim().min(1)).min(1, "Enter at least one competitor URL").max(MAX_COMPETITOR_URLS),
  /** Optional focus so the analysis can be pointed at one subject rather than the whole site. */
  targetTopic: optionalString(),
  notes: optionalString(),
});
export type CompetitorContentAnalysisInput = z.infer<typeof competitorContentAnalysisInputSchema>;

/**
 * The stored job input. Richer than the form input: the action resolves and
 * records which origins it actually validated, and where each came from, so
 * the dispatcher never re-derives that from raw user text.
 */
export const COMPETITOR_URL_SOURCES = ["USER", "BRAND_PROFILE"] as const;
export type CompetitorUrlSource = (typeof COMPETITOR_URL_SOURCES)[number];

export const competitorContentAnalysisJobInputSchema = z.object({
  seoProjectId: z.string().min(1).uuid(),
  competitors: z
    .array(z.object({ origin: z.string().min(1), source: z.enum(COMPETITOR_URL_SOURCES) }))
    .min(1)
    .max(MAX_COMPETITOR_URLS),
  targetTopic: optionalString(),
  notes: optionalString(),
});
export type CompetitorContentAnalysisJobInput = z.infer<typeof competitorContentAnalysisJobInputSchema>;

/**
 * The PROVIDER-FACING shape — deliberately loose (every classification a plain
 * string), the "loose contract in, strict filter out" principle the other tools
 * established: one cosmetically-off enum value must not fail the whole response
 * and burn a retry/fallback.
 *
 * Note what the model is asked for and what it is NOT. For each page it may
 * classify — but the page's `url` is echoed back purely so its classification
 * can be matched to a page the CRAWLER actually found; a url that isn't in the
 * crawled set is dropped, so the model cannot introduce a page. There are no
 * fields for metrics, rankings, traffic, or competitor business facts at all,
 * so fabricating one is structurally impossible rather than merely discouraged.
 */
export const competitorAnalysisProviderOutputSchema = zv4.object({
  pageAnalyses: zv4
    .array(
      zv4.object({
        url: zv4.string(),
        observedTopic: zv4.string(),
        format: zv4.string(),
        searchIntent: zv4.string(),
        keyCoverage: zv4.array(zv4.string()).default([]),
      })
    )
    .default([]),
  opportunities: zv4
    .array(
      zv4.object({
        topic: zv4.string(),
        whyItMatters: zv4.string(),
        suggestedContentType: zv4.string(),
        recommendedAction: zv4.string(),
      })
    )
    .default([]),
});
export type CompetitorAnalysisProviderOutput = zv4.infer<typeof competitorAnalysisProviderOutputSchema>;

export const COMPETITOR_CONTENT_FORMATS = ["ARTICLE", "GUIDE", "LANDING_PAGE", "FAQ_PAGE", "CASE_STUDY", "COMPARISON", "PRODUCT_PAGE", "OTHER"] as const;
export type CompetitorContentFormat = (typeof COMPETITOR_CONTENT_FORMATS)[number];

export const COMPETITOR_SEARCH_INTENTS = ["INFORMATIONAL", "COMMERCIAL", "TRANSACTIONAL", "NAVIGATIONAL"] as const;
export type CompetitorSearchIntent = (typeof COMPETITOR_SEARCH_INTENTS)[number];

/** Deterministic, code-computed coverage against this project's REAL Content titles. Hedged: a title match is not a coverage claim. */
export const competitorExistingCoverageSchema = zv4.object({
  status: zv4.enum(["NOT_FOUND", "POSSIBLE_MATCH"]),
  matchedTitle: zv4.string().nullable(),
});
export type CompetitorExistingCoverage = zv4.infer<typeof competitorExistingCoverageSchema>;

/**
 * One competitor page.
 *
 * `url` and `title` are OBSERVED — they come from the crawler, never the model.
 * The classification fields are AI ANALYSIS and are nullable, because a weak
 * fallback model returning nothing usable must not discard a page the crawler
 * genuinely found. Null means "not classified", never a guessed value.
 */
export const competitorPageSchema = zv4.object({
  url: zv4.string(),
  title: zv4.string().nullable(),
  metaDescription: zv4.string().nullable(),
  headings: zv4.array(zv4.string()).default([]),
  observedTopic: zv4.string().nullable(),
  format: zv4.enum(COMPETITOR_CONTENT_FORMATS).nullable(),
  searchIntent: zv4.enum(COMPETITOR_SEARCH_INTENTS).nullable(),
  keyCoverage: zv4.array(zv4.string()).default([]),
});
export type CompetitorPage = zv4.infer<typeof competitorPageSchema>;

/** One crawled competitor site. Everything here is observation or crawler fact. */
export const competitorSiteSchema = zv4.object({
  origin: zv4.string(),
  source: zv4.enum(COMPETITOR_URL_SOURCES),
  pagesAnalyzed: zv4.number(),
  robotsTxtFound: zv4.boolean(),
  /** The crawler's own warnings, surfaced verbatim so limits are visible rather than implied away. */
  warnings: zv4.array(zv4.string()).default([]),
  pages: zv4.array(competitorPageSchema).default([]),
});
export type CompetitorSite = zv4.infer<typeof competitorSiteSchema>;

/** A recommendation. Distinct from observation, and its coverage is computed in code. */
export const competitorOpportunitySchema = zv4.object({
  topic: zv4.string(),
  whyItMatters: zv4.string(),
  suggestedContentType: zv4.enum(COMPETITOR_CONTENT_FORMATS).nullable(),
  recommendedAction: zv4.string(),
  existingCoverage: competitorExistingCoverageSchema,
  /** Real keyword terms from this project, matched deterministically. Never model-supplied. */
  relatedKeywords: zv4.array(zv4.string()).default([]),
});
export type CompetitorOpportunity = zv4.infer<typeof competitorOpportunitySchema>;

export const competitorAnalysisResultSchema = zv4.object({
  /** Echoed back so the review screen can label it as the user's own input. */
  targetTopic: zv4.string().nullable(),
  competitors: zv4.array(competitorSiteSchema).default([]),
  opportunities: zv4.array(competitorOpportunitySchema).default([]),
});
export type CompetitorAnalysisResult = zv4.infer<typeof competitorAnalysisResultSchema>;

export const competitorAnalysisJobResultSchema = zv4.object({ result: competitorAnalysisResultSchema.nullable() });
export type CompetitorAnalysisJobResult = zv4.infer<typeof competitorAnalysisJobResultSchema>;
