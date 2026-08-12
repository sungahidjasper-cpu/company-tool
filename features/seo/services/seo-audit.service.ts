import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { logger } from "@/lib/logger";
import {
  executiveSummarySchema,
  seoContentIntelligenceSchema,
  seoRecommendationsSchema,
  seoScoresSchema,
  type Recommendation,
  type SeoAuditOutput,
  type SeoContentIntelligenceOutput,
  type SeoScoresOutput,
} from "@/features/seo/schemas/seo-audit.schema";
import type { WebsiteAnalysisExtraction } from "@/features/seo/schemas/website-analysis.schema";
import type { DeterministicFinding } from "@/features/seo/services/seo-scoring.service";
import type { CrawlResult } from "@/features/seo/services/website-crawler.service";

/**
 * Bumped whenever any prompt template below changes — also the exact-match
 * key website-analysis.service.ts uses to decide whether a prior job's AI
 * output can be reused instead of regenerated (see its crawlHash cache
 * lookup). A stale prior result is never reused across a version bump.
 */
export const PROMPT_VERSION = 1;

export type AuditContext = {
  /** Provenance for AiUsageLog rows — the job this audit call is for. */
  websiteAnalysisJobId: string;
  crawl: CrawlResult;
  extraction: WebsiteAnalysisExtraction;
  deterministicFindings: DeterministicFinding[];
  detectedSchemaTypes: string[];
  missingSchemaTypes: string[];
  orphanPages: string[];
  thinPageUrls: string[];
};

const AUDIT_SYSTEM_PROMPT =
  "You are a senior SEO auditor. Be concise, concrete, and grounded strictly in the provided crawl data and business context. Never invent products, services, locations, or facts not evidenced in the input. Every score must be accompanied by reasoning that references specific evidence.";

function buildSharedContext(ctx: AuditContext): string {
  const pageSummaries = ctx.crawl.pages
    .map(
      (page) =>
        `URL: ${page.url}\nTitle: ${page.title ?? "(none)"}\nH1 count: ${page.h1Count}\nCanonical: ${page.canonicalUrl ?? "(none)"}\nSchema types: ${page.jsonLdTypes.join(", ") || "(none)"}\nBody excerpt: ${page.bodyText.slice(0, 600)}`
    )
    .join("\n\n---\n\n");

  const findingsSummary =
    ctx.deterministicFindings.map((f) => `- [${f.priority}] ${f.title}: ${f.description}`).join("\n") ||
    "(none)";

  return `Business context (already extracted from this same site — treat as ground truth, do not contradict or invent beyond it):
- Category: ${ctx.extraction.businessCategory}
- Services/products: ${ctx.extraction.services.join(", ") || "(none detected)"}
- Locations served: ${ctx.extraction.locations.join(", ") || "(none detected)"}
- Topics: ${ctx.extraction.topics.join(", ") || "(none detected)"}

Deterministic technical findings already detected from crawling this site (do not re-derive or contradict these — use them as grounding facts):
${findingsSummary}

Structured data already detected: ${ctx.detectedSchemaTypes.join(", ") || "none"}.
Structured data types missing (recommend JSON-LD only for types in this list, at most 5): ${ctx.missingSchemaTypes.slice(0, 5).join(", ") || "none missing"}.
Pages with no internal links pointing to them (orphaned within this crawl sample): ${ctx.orphanPages.join(", ") || "none"}.
Pages with very little text content: ${ctx.thinPageUrls.join(", ") || "none"}.

Crawled page content (homepage plus a sample of other pages):

${pageSummaries}`;
}

async function generateScores(sharedContext: string, jobId: string): Promise<SeoScoresOutput> {
  const prompt = `${sharedContext}

Using ONLY the information above:
1. Score Content Quality (0-100, with reasoning).
2. Evaluate EEAT — an overall score plus reasoning, plus a "factors" array with exactly these 4 entries (by name): Experience, Expertise, Authoritativeness, Trustworthiness — each with its own score and reasoning explaining what evidence (or lack of it — e.g. no author bios, no credentials, no reviews, no trust indicators) drove the score.
3. Judge whether Local SEO applies to this business (serves specific local areas vs. purely online/national/global) and score it only if applicable.
4. Score GEO Readiness — an overall score plus reasoning, plus a "factors" array with exactly these 7 entries (by name): Entity Clarity, Structured Data Coverage, Topic Clustering, Semantic Consistency, Authoritativeness, Source Transparency, Internal Entity Relationships.
5. Score AEO Readiness — an overall score plus reasoning, plus a "factors" array with exactly these 7 entries (by name): FAQ Content, Question & Answer Formatting, Featured Snippet Opportunities, Definitions, Tables, Lists, Direct Answers.`;

  return generateStructuredOutput(seoScoresSchema, {
    system: AUDIT_SYSTEM_PROMPT,
    prompt,
    maxTokens: 6000,
    taskType: "SCORES",
    promptVersion: PROMPT_VERSION,
    websiteAnalysisJobId: jobId,
  });
}

async function generateRecommendations(sharedContext: string, jobId: string): Promise<Recommendation[]> {
  const prompt = `${sharedContext}

Using ONLY the information above, produce a prioritized list of recommendations covering technical, on-page, content, structured data, internal linking, EEAT, GEO, and AEO — each with a title, description, why it matters, estimated impact, difficulty, priority, and category. Do not just restate the deterministic findings above verbatim; add judgment-based recommendations they don't cover.`;

  const result = await generateStructuredOutput(seoRecommendationsSchema, {
    system: AUDIT_SYSTEM_PROMPT,
    prompt,
    maxTokens: 6000,
    taskType: "RECOMMENDATIONS",
    promptVersion: PROMPT_VERSION,
    websiteAnalysisJobId: jobId,
  });
  return result.recommendations;
}

async function generateContentIntelligence(sharedContext: string, jobId: string): Promise<SeoContentIntelligenceOutput> {
  const prompt = `${sharedContext}

Using ONLY the information above:
1. Recommend keyword intelligence (primary/secondary/long-tail/semantic keywords, a search-intent summary, and content clusters) based only on the business context and crawled content above — never invent products or services not evidenced there.
2. Identify content gaps: missing page types this specific business would plausibly benefit from, given its actual services and locations.
3. For each missing structured-data type listed above, write a real, valid JSON-LD example grounded in the actual business info (not a generic placeholder).
4. Suggest internal-linking improvements, referencing the actual orphan pages listed above where relevant.`;

  return generateStructuredOutput(seoContentIntelligenceSchema, {
    system: AUDIT_SYSTEM_PROMPT,
    prompt,
    maxTokens: 8000,
    taskType: "CONTENT_INTELLIGENCE",
    promptVersion: PROMPT_VERSION,
    websiteAnalysisJobId: jobId,
  });
}

async function generateExecutiveSummary(
  extraction: WebsiteAnalysisExtraction,
  scores: SeoScoresOutput,
  recommendations: Recommendation[],
  jobId: string
) {
  const topRecommendations = recommendations.slice(0, 8).map((r) => `- [${r.priority}] ${r.title}`).join("\n");

  const prompt = `Business: ${extraction.businessCategory}.

Category scores already computed for this site:
- Content Quality: ${scores.contentQuality.score}/100
- EEAT: ${scores.eeat.score}/100
- GEO Readiness: ${scores.geoReadiness.score}/100
- AEO Readiness: ${scores.aeoReadiness.score}/100
${scores.localSeo.applicable ? `- Local SEO: ${scores.localSeo.score}/100` : "- Local SEO: not applicable"}

Top recommendations already identified:
${topRecommendations || "(none)"}

Write an executive summary: a short narrative on overall health, 3-5 strengths, 3-5 weaknesses, and the top 5 recommended actions (drawing from the recommendations above).`;

  return generateStructuredOutput(executiveSummarySchema, {
    system: AUDIT_SYSTEM_PROMPT,
    prompt,
    maxTokens: 2000,
    taskType: "EXECUTIVE_SUMMARY",
    promptVersion: PROMPT_VERSION,
    websiteAnalysisJobId: jobId,
  });
}

/**
 * Phase 11C — the 3 tasks below fail independently (Promise.allSettled):
 * a rejected contentIntelligence call, say, no longer discards scores and
 * recommendations that already succeeded. Each rejection is logged with its
 * task name so a partial-AI run is diagnosable from logs alone. The
 * executive summary is generated only when BOTH scores and recommendations
 * succeeded — it summarizes them, so summarizing missing data would be
 * actively misleading rather than merely incomplete.
 */
export async function generateSeoAudit(ctx: AuditContext): Promise<SeoAuditOutput> {
  const sharedContext = buildSharedContext(ctx);

  const [scoresResult, recommendationsResult, contentIntelligenceResult] = await Promise.allSettled([
    generateScores(sharedContext, ctx.websiteAnalysisJobId),
    generateRecommendations(sharedContext, ctx.websiteAnalysisJobId),
    generateContentIntelligence(sharedContext, ctx.websiteAnalysisJobId),
  ]);

  const logTaskFailure = (task: string, result: PromiseSettledResult<unknown>) => {
    if (result.status === "rejected") {
      logger.warn("Website analysis: an independent audit task failed — other audit sections are unaffected", {
        jobId: ctx.websiteAnalysisJobId,
        task,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  };
  logTaskFailure("SCORES", scoresResult);
  logTaskFailure("RECOMMENDATIONS", recommendationsResult);
  logTaskFailure("CONTENT_INTELLIGENCE", contentIntelligenceResult);

  // All 3 failing means there's nothing usable at all — functionally the
  // same "AI audit unavailable" case runAiPhase already handles for a
  // failed extraction call, so it's surfaced the same way: rethrow (the
  // scores task's reason, being first/most central) so the caller's
  // existing catch block classifies it into the same job-level advisory
  // banner already verified in Phase 11B, rather than a job "succeeding"
  // with every single audit section empty.
  if (scoresResult.status === "rejected" && recommendationsResult.status === "rejected" && contentIntelligenceResult.status === "rejected") {
    throw scoresResult.reason;
  }

  const scores = scoresResult.status === "fulfilled" ? scoresResult.value : null;
  const recommendations = recommendationsResult.status === "fulfilled" ? recommendationsResult.value : null;
  const contentIntelligence = contentIntelligenceResult.status === "fulfilled" ? contentIntelligenceResult.value : null;

  const executiveSummary =
    scores && recommendations
      ? await generateExecutiveSummary(ctx.extraction, scores, recommendations, ctx.websiteAnalysisJobId).catch((error) => {
          logTaskFailure("EXECUTIVE_SUMMARY", { status: "rejected", reason: error });
          return null;
        })
      : null;

  return { scores, recommendations, contentIntelligence, executiveSummary };
}
