import { z as zv4 } from "zod/v4";

import { PRIORITIES, SEO_CATEGORIES } from "@/features/seo/services/seo-scoring.service";
import type { WebsiteAnalysisJob } from "@/lib/generated/prisma/client";

/**
 * The SEO-audit LLM call's output shape (zod/v4 — the Anthropic SDK's
 * structured-output helper requires it, same reason as
 * website-analysis.schema.ts). Every score is paired with reasoning —
 * never a bare number — per the architecture's "explain every score"
 * principle.
 */
const scoreWithReasoning = zv4.object({
  score: zv4.number().min(0).max(100),
  reasoning: zv4.string(),
});

/**
 * EEAT/GEO/AEO factors are named sub-scores (4, 7, and 7 respectively).
 * Modeling each as its own named object field — as an earlier version of
 * this schema did — produced ~18 distinct nested object definitions in one
 * strict structured-output schema, which Claude's API rejected outright:
 * "The compiled grammar is too large... simplify your tool schemas."
 * Collapsing them into one repeated `{name, score, reasoning}` array schema
 * (reused three times) keeps every factor, just addressed by name instead
 * of by field — confirmed fixing the 400 in live verification.
 */
const namedFactorSchema = zv4.object({
  name: zv4.string(),
  score: zv4.number().min(0).max(100),
  reasoning: zv4.string(),
});

const eeatSchema = zv4.object({
  score: zv4.number().min(0).max(100),
  reasoning: zv4.string(),
  /** Exactly 4 entries, named: Experience, Expertise, Authoritativeness, Trustworthiness. */
  factors: zv4.array(namedFactorSchema),
});

const geoReadinessSchema = zv4.object({
  score: zv4.number().min(0).max(100),
  reasoning: zv4.string(),
  /** Exactly 7 entries, named: Entity Clarity, Structured Data Coverage, Topic Clustering, Semantic Consistency, Authoritativeness, Source Transparency, Internal Entity Relationships. */
  factors: zv4.array(namedFactorSchema),
});

const aeoReadinessSchema = zv4.object({
  score: zv4.number().min(0).max(100),
  reasoning: zv4.string(),
  /** Exactly 7 entries, named: FAQ Content, Question & Answer Formatting, Featured Snippet Opportunities, Definitions, Tables, Lists, Direct Answers. */
  factors: zv4.array(namedFactorSchema),
});

const localSeoSchema = zv4.object({
  applicable: zv4.boolean(),
  score: zv4.number().min(0).max(100).nullable(),
  reasoning: zv4.string(),
});

const recommendationSchema = zv4.object({
  title: zv4.string(),
  description: zv4.string(),
  whyItMatters: zv4.string(),
  estimatedImpact: zv4.enum(["HIGH", "MEDIUM", "LOW"]),
  difficulty: zv4.enum(["EASY", "MEDIUM", "HARD"]),
  priority: zv4.enum(PRIORITIES),
  category: zv4.enum(SEO_CATEGORIES),
});

const contentGapSchema = zv4.object({
  title: zv4.string(),
  description: zv4.string(),
  reasoning: zv4.string(),
});

const structuredDataRecommendationSchema = zv4.object({
  schemaType: zv4.string(),
  reasoning: zv4.string(),
  exampleJsonLd: zv4.string(),
});

const internalLinkingSuggestionSchema = zv4.object({
  title: zv4.string(),
  description: zv4.string(),
  type: zv4.enum(["HUB_PAGE", "ORPHAN_PAGE", "ANCHOR_TEXT", "RELATED_PAGES", "TOPIC_CLUSTER"]),
});

const contentClusterSchema = zv4.object({
  clusterName: zv4.string(),
  keywords: zv4.array(zv4.string()),
});

/**
 * Even after collapsing EEAT/GEO/AEO into factor arrays (above), one
 * schema covering scores + recommendations + keyword intelligence +
 * content gaps + structured data + internal linking + executive summary
 * still triggered the same "compiled grammar is too large" 400 — confirmed
 * by live verification. Split into four smaller structured-output calls
 * instead (three run in parallel, the fourth — executive summary —
 * depends on the other three's results and runs after); each schema below
 * corresponds to one call, combined into one `SeoAuditOutput` object by
 * generateSeoAudit() in seo-audit.service.ts, which is the only place that
 * needs to know about the split — everything downstream still consumes a
 * single `SeoAuditOutput`.
 */
export const seoScoresSchema = zv4.object({
  contentQuality: scoreWithReasoning,
  eeat: eeatSchema,
  localSeo: localSeoSchema,
  geoReadiness: geoReadinessSchema,
  aeoReadiness: aeoReadinessSchema,
});

export const seoRecommendationsSchema = zv4.object({
  recommendations: zv4.array(recommendationSchema),
});

export const seoContentIntelligenceSchema = zv4.object({
  keywordIntelligence: zv4.object({
    primaryKeywords: zv4.array(zv4.string()),
    secondaryKeywords: zv4.array(zv4.string()),
    longTailKeywords: zv4.array(zv4.string()),
    semanticKeywords: zv4.array(zv4.string()),
    searchIntentSummary: zv4.string(),
    contentClusters: zv4.array(contentClusterSchema),
  }),
  contentGaps: zv4.array(contentGapSchema),
  structuredDataRecommendations: zv4.array(structuredDataRecommendationSchema),
  internalLinkingSuggestions: zv4.array(internalLinkingSuggestionSchema),
});

export const executiveSummarySchema = zv4.object({
  overallHealthNarrative: zv4.string(),
  strengths: zv4.array(zv4.string()),
  weaknesses: zv4.array(zv4.string()),
  topActions: zv4.array(zv4.string()),
});

export type SeoScoresOutput = zv4.infer<typeof seoScoresSchema>;
export type SeoRecommendationsOutput = zv4.infer<typeof seoRecommendationsSchema>;
export type SeoContentIntelligenceOutput = zv4.infer<typeof seoContentIntelligenceSchema>;
export type ExecutiveSummaryOutput = zv4.infer<typeof executiveSummarySchema>;

export type Recommendation = SeoRecommendationsOutput["recommendations"][number];
export type ScoreWithReasoning = { score: number; reasoning: string };

/**
 * Phase 11C — each of the 4 AI calls generateSeoAudit() makes fails
 * independently (Promise.allSettled, not Promise.all): a rejected
 * contentIntelligence call no longer discards scores/recommendations that
 * did succeed. A null section here means that specific AI task failed for
 * this run — never a fabricated zero/empty result standing in for "unknown"
 * (that would misrepresent "AI unavailable" as a real bad score). Sections
 * are still null-checked and merged with deterministic data in
 * website-analysis.service.ts before persisting SeoAuditResultData below.
 */
export type SeoAuditOutput = {
  scores: SeoScoresOutput | null;
  recommendations: Recommendation[] | null;
  contentIntelligence: SeoContentIntelligenceOutput | null;
  /** Null whenever scores or recommendations is null — summarizing missing data would be worse than not summarizing at all. */
  executiveSummary: ExecutiveSummaryOutput | null;
};

/**
 * The full combined result stored on WebsiteAnalysisJob.resultJson: the
 * unchanged 10.5a extraction fields, plus everything from the 10.5b audit
 * under `audit` — `audit` is null for jobs created before Phase 10.5b
 * (legacy rows have no scores/recommendations to show, but their basic
 * business info and crawled-pages list still render).
 */
export type WebsiteAnalysisResult = {
  businessCategory: string;
  services: string[];
  locations: string[];
  topics: string[];
  crawledPages: { url: string; title: string | null }[];
  sitemapUrlCount: number;
  warnings: string[];
  audit: SeoAuditResultData | null;
};

/**
 * Phase 11C — the 5 fields below are null exactly when the corresponding AI
 * task (scores or contentIntelligence) failed for this run; every other
 * field is deterministic or (for `recommendations`) always has at least the
 * deterministic-findings-derived entries even if the AI recommendations
 * task failed. UI tabs (SeoScoresTab, SeoOverviewTab, SeoKeywordsTab,
 * SeoContentGapsTab, SeoStructuredDataTab) render an "unavailable for this
 * run" state for a null section rather than crashing on it.
 */
export type SeoAuditResultData = {
  overallScore: number;
  categoryScores: {
    technicalSeo: ScoreWithReasoning;
    onPageSeo: ScoreWithReasoning;
    contentQuality: ScoreWithReasoning | null;
    structuredData: ScoreWithReasoning;
    internalLinking: ScoreWithReasoning;
    eeat: SeoScoresOutput["eeat"] | null;
    localSeo: SeoScoresOutput["localSeo"] | null;
    geoReadiness: SeoScoresOutput["geoReadiness"] | null;
    aeoReadiness: SeoScoresOutput["aeoReadiness"] | null;
  };
  recommendations: Recommendation[];
  keywordIntelligence: SeoContentIntelligenceOutput["keywordIntelligence"] | null;
  contentGaps: SeoContentIntelligenceOutput["contentGaps"] | null;
  structuredDataRecommendations: SeoContentIntelligenceOutput["structuredDataRecommendations"] | null;
  detectedSchemaTypes: string[];
  internalLinkingSuggestions: SeoContentIntelligenceOutput["internalLinkingSuggestions"] | null;
  orphanPages: string[];
  executiveSummary: ExecutiveSummaryOutput | null;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Defensive read-time parse of the stored JSON — mirrors the shape written in website-analysis.service.ts. */
export function parseWebsiteAnalysisResult(job: WebsiteAnalysisJob | null): WebsiteAnalysisResult | null {
  if (!job || job.status !== "SUCCEEDED" || !job.resultJson || typeof job.resultJson !== "object") {
    return null;
  }
  const raw = job.resultJson as Record<string, unknown>;

  const base = {
    businessCategory: typeof raw.businessCategory === "string" ? raw.businessCategory : "Unknown",
    services: asStringArray(raw.services),
    locations: asStringArray(raw.locations),
    topics: asStringArray(raw.topics),
    crawledPages: Array.isArray(raw.crawledPages)
      ? (raw.crawledPages as { url: string; title: string | null }[])
      : [],
    sitemapUrlCount: typeof raw.sitemapUrlCount === "number" ? raw.sitemapUrlCount : 0,
    warnings: asStringArray(raw.warnings),
  };

  if (typeof raw.overallScore !== "number" || !raw.audit || typeof raw.audit !== "object") {
    return { ...base, audit: null };
  }

  return { ...base, audit: raw.audit as SeoAuditResultData };
}
