import { z } from "zod";

import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import {
  contentGapAnalysisProviderOutputSchema,
  CONTENT_GAP_CONTENT_TYPES,
  CONTENT_GAP_NEXT_ACTIONS,
  type ContentGapAnalysisResult,
  type ContentGapContentType,
  type ContentGapNextAction,
  type ContentGapOpportunity,
} from "@/features/ai-workspace/schemas/content-gap-analysis.schema";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { looksLikeInstructionEcho, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";

export const PROMPT_VERSION = 1;

/**
 * Real audits in this database carry 2-3 content gaps; each opportunity
 * only needs a short topic echo plus two small classification fields back,
 * so this budget is deliberately smaller than the 3000-4000 used by tools
 * that write full paragraphs (schema-markup-generator.service.ts,
 * press-release-generator.service.ts).
 */
const MAX_OUTPUT_TOKENS = 1500;

export const CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are an SEO content strategist reviewing a list of content-gap opportunities a prior site audit already identified. Your only job for each item is to classify it — never invent a new opportunity, never rewrite the topic/opportunity/reasoning text already supplied for it, and never add information not present in what is supplied for that specific item. Never state or imply anything about a competitor — whether one exists, ranks for a topic, or has published content on it — no competitor data has been supplied, and none should appear in your response. Never state or imply a search volume, keyword ranking, keyword difficulty, or website-traffic figure — none of that data has been supplied either. Base suggestedContentType and recommendedNextAction only on the topic, opportunity, reasoning, and existing-coverage information explicitly given for that item — the existing-coverage determination itself has already been made for you and is not yours to second-guess.`;

export type PreparedContentGap = {
  title: string;
  description: string;
  reasoning: string;
  relatedCluster: string | null;
  coverage: { status: "NOT_FOUND" } | { status: "POSSIBLE_MATCH"; matchedTitle: string };
};

export type ContentGapAnalysisContext = {
  seoProjectId: string;
  companyId: string;
  seoProjectName: string;
  domain: string;
  gaps: { title: string; description: string; reasoning: string }[];
  contentClusters: { clusterName: string; keywords: string[] }[];
  /** Content.title rows for this project plus the audit's own crawledPages titles, combined and deduplicated. */
  existingTitles: string[];
};

// ---------------------------------------------------------------------------
// Raw audit-shape extraction — WebsiteAnalysisJob.resultJson is an untyped
// Json column read back from the database. Deliberately re-defines a
// minimal local shape rather than importing features/seo/schemas/seo-audit.schema.ts's
// (unexported) contentGapSchema — the same "reused as a pattern, not as a
// code dependency" precedent schema-markup-generator.schema.ts already
// documents for structuredDataRecommendationSchema. Every extractor is
// defensive: a malformed/legacy/missing shape degrades to an empty array,
// never throws — callers decide what an empty result means for them.
// ---------------------------------------------------------------------------

const rawContentGapSchema = z.object({
  title: z.string(),
  description: z.string(),
  reasoning: z.string(),
});

const rawContentClusterSchema = z.object({
  clusterName: z.string(),
  keywords: z.array(z.string()).default([]),
});

export function extractContentGapsFromAudit(resultJson: unknown): { title: string; description: string; reasoning: string }[] {
  if (!resultJson || typeof resultJson !== "object") return [];
  const audit = (resultJson as Record<string, unknown>).audit;
  if (!audit || typeof audit !== "object") return [];
  const rawGaps = (audit as Record<string, unknown>).contentGaps;
  if (!Array.isArray(rawGaps)) return [];
  return rawGaps.map((g) => rawContentGapSchema.safeParse(g)).filter((r) => r.success).map((r) => (r as { success: true; data: z.infer<typeof rawContentGapSchema> }).data);
}

export function extractContentClustersFromAudit(resultJson: unknown): { clusterName: string; keywords: string[] }[] {
  if (!resultJson || typeof resultJson !== "object") return [];
  const audit = (resultJson as Record<string, unknown>).audit;
  if (!audit || typeof audit !== "object") return [];
  const keywordIntelligence = (audit as Record<string, unknown>).keywordIntelligence;
  if (!keywordIntelligence || typeof keywordIntelligence !== "object") return [];
  const rawClusters = (keywordIntelligence as Record<string, unknown>).contentClusters;
  if (!Array.isArray(rawClusters)) return [];
  return rawClusters
    .map((c) => rawContentClusterSchema.safeParse(c))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: z.infer<typeof rawContentClusterSchema> }).data);
}

export function extractCrawledPageTitles(resultJson: unknown): string[] {
  if (!resultJson || typeof resultJson !== "object") return [];
  const pages = (resultJson as Record<string, unknown>).crawledPages;
  if (!Array.isArray(pages)) return [];
  return pages
    .map((p) => (p && typeof p === "object" && typeof (p as Record<string, unknown>).title === "string" ? ((p as Record<string, unknown>).title as string) : null))
    .filter((t): t is string => !!t && t.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Deterministic coverage/cluster matching — computed entirely in code,
// never delegated to the model. Per Stage A discovery: Content.url is
// unpopulated for every row in this database, so matching is title-text
// only; deliberately conservative (requires a substantial, not incidental,
// word overlap) so a couple of generic shared words (e.g. "self storage
// investment", which recurs across nearly every page on a single-topic
// site) never produce a false "already covered" claim. Framed everywhere
// downstream as a heuristic signal, never as confirmed semantic coverage.
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(["the", "and", "for", "with", "your", "you", "are", "this", "that", "from", "into", "about", "our"]);

function significantWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Words appearing in at least half of the site's own page titles carry no
 * discriminating signal — on a single-topic site every title repeats the
 * same brand/subject terms ("self", "storage", "moguls" on
 * storagemoguls.com), so counting them as evidence of overlap produces a
 * false "already covered" claim from generic words alone. Confirmed live:
 * without this filter, the "FAQs on Self-Storage Investing" gap matched
 * the unrelated homepage title "Institutional Self-Storage Investments"
 * on "self"+"storage" alone. Only computed when there are enough titles to
 * make a frequency meaningful — with 3 or fewer, every word looks common.
 */
const MIN_TITLES_FOR_FREQUENCY_FILTER = 4;

function commonCorpusWords(existingTitles: string[]): Set<string> {
  if (existingTitles.length < MIN_TITLES_FOR_FREQUENCY_FILTER) return new Set();
  const counts = new Map<string, number>();
  for (const title of existingTitles) {
    for (const word of new Set(significantWords(title))) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const threshold = existingTitles.length / 2;
  return new Set([...counts.entries()].filter(([, count]) => count >= threshold).map(([word]) => word));
}

/**
 * Deliberately matches on the gap's TITLE only, never its description:
 * confirmed live that description words pull in incidental subject terms
 * ("...focusing on local market trends and investment opportunities" in a
 * gap about location pages) that then match an unrelated existing page
 * about those terms. The title is what actually names the topic, so it is
 * the only honest matching signal here.
 */
export function computeExistingCoverage(gapTitle: string, existingTitles: string[]): { status: "NOT_FOUND" } | { status: "POSSIBLE_MATCH"; matchedTitle: string } {
  const gapWords = new Set(significantWords(gapTitle));
  if (gapWords.size === 0) return { status: "NOT_FOUND" };

  const commonWords = commonCorpusWords(existingTitles);

  for (const existingTitle of existingTitles) {
    const existingWords = significantWords(existingTitle).filter((w) => !commonWords.has(w));
    if (existingWords.length < 2) continue;
    const overlap = existingWords.filter((w) => gapWords.has(w));
    if (overlap.length >= 2 && overlap.length / existingWords.length >= 0.5) {
      return { status: "POSSIBLE_MATCH", matchedTitle: existingTitle };
    }
  }
  return { status: "NOT_FOUND" };
}

/** Same word-overlap heuristic as computeExistingCoverage, applied to relate a gap to the cluster whose keywords share the most significant words with it. Returns null when no cluster shares any word — never forces a weak/arbitrary match. */
export function matchCluster(gapTitle: string, gapDescription: string, clusters: { clusterName: string; keywords: string[] }[]): string | null {
  const gapWords = new Set([...significantWords(gapTitle), ...significantWords(gapDescription)]);
  if (gapWords.size === 0 || clusters.length === 0) return null;

  let best: { clusterName: string; score: number } | null = null;
  for (const cluster of clusters) {
    const clusterWords = significantWords(cluster.keywords.join(" "));
    const score = clusterWords.filter((w) => gapWords.has(w)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { clusterName: cluster.clusterName, score };
    }
  }
  return best?.clusterName ?? null;
}

/**
 * Cleans and enriches each raw audit gap with its deterministic
 * coverage/cluster signal, dropping any gap that is empty after cleaning
 * or whose text is leaked instruction/configuration content rather than a
 * real gap (defense against malformed/legacy audit rows — degrades to
 * fewer items, never throws).
 *
 * Stage C — this is now the ONLY gate on which opportunities reach the
 * user, since buildContentGapAnalysisResult no longer drops a gap just
 * because the model failed to classify it. The validation of the actual
 * audit data is correspondingly stricter here, not weaker: the
 * instruction-echo check that previously ran against the model's echoed
 * topic now runs against the audit's own title/description, and duplicate
 * titles collapse to one opportunity.
 */
export function prepareContentGaps(
  gaps: { title: string; description: string; reasoning: string }[],
  contentClusters: { clusterName: string; keywords: string[] }[],
  existingTitles: string[]
): PreparedContentGap[] {
  const clean = (text: string) => stripHtmlTags(stripConfigurationArtifacts(text));
  const seen = new Set<string>();

  return gaps
    .map((gap) => {
      const title = clean(gap.title);
      const description = clean(gap.description);
      const reasoning = clean(gap.reasoning);
      return {
        title,
        description,
        reasoning,
        relatedCluster: matchCluster(title, description, contentClusters),
        coverage: computeExistingCoverage(title, existingTitles),
      };
    })
    .filter((gap) => {
      if (!gap.title || !gap.description || !gap.reasoning) return false;
      if (looksLikeInstructionEcho(gap.title) || looksLikeInstructionEcho(gap.description)) return false;
      const key = gap.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function buildPrompt(ctx: { seoProjectName: string; domain: string; gaps: PreparedContentGap[] }): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];
  lines.push(`\nThe most recent SEO audit for this site identified the following content gap${ctx.gaps.length === 1 ? "" : "s"}:`);

  ctx.gaps.forEach((gap, index) => {
    lines.push(`\n${index + 1}. Topic: "${gap.title}"`);
    lines.push(`   Opportunity: ${gap.description}`);
    lines.push(`   Why it matters: ${gap.reasoning}`);
    lines.push(
      `   Existing coverage check (already determined — not your judgment to make): ${
        gap.coverage.status === "POSSIBLE_MATCH" ? `a similarly-titled existing page was found: "${gap.coverage.matchedTitle}"` : "no matching existing page title was found"
      }`
    );
    if (gap.relatedCluster) lines.push(`   Related keyword cluster: "${gap.relatedCluster}"`);
  });

  return `${lines.join("\n")}

For EACH numbered topic above, return an object with exactly:
1. topic: copy the topic text EXACTLY as given above, unchanged — this is used only to match your answer back to the correct item.
2. suggestedContentType: one of ARTICLE, FAQ_PAGE, LANDING_PAGE, CASE_STUDY — whichever format best fits the topic and opportunity described above.
3. recommendedNextAction: CREATE_NEW if no matching existing page was found above for that topic, or UPDATE_EXISTING if a similarly-titled existing page was found above for that topic.

Base every answer only on the information given for that specific topic above. Never mention or imply anything about competitors, search rankings, search volume, keyword difficulty, or website traffic — none of that information was supplied and none of it belongs in your response.`;
}

type ModelClassification = { suggestedContentType: ContentGapContentType | null; recommendedNextAction: ContentGapNextAction | null };

/**
 * Indexes the model's classifications by the topic it echoed back, keeping
 * only values that are valid on their own terms. An item echoing a topic
 * that matches no real gap is simply never looked up (it can't fabricate a
 * new opportunity); an item with a garbage enum value contributes null for
 * that field rather than poisoning the whole response. First valid echo of
 * a topic wins — a repeated topic is ignored, never merged.
 */
function indexModelClassifications(rawOpportunities: unknown[]): Map<string, ModelClassification> {
  const classifications = new Map<string, ModelClassification>();

  for (const raw of rawOpportunities) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.topic !== "string") continue;

    const cleanedTopic = stripHtmlTags(stripConfigurationArtifacts(item.topic));
    if (!cleanedTopic || looksLikeInstructionEcho(cleanedTopic)) continue;

    const key = cleanedTopic.trim().toLowerCase();
    if (classifications.has(key)) continue;

    const suggestedContentType =
      typeof item.suggestedContentType === "string" && (CONTENT_GAP_CONTENT_TYPES as readonly string[]).includes(item.suggestedContentType)
        ? (item.suggestedContentType as ContentGapContentType)
        : null;
    const recommendedNextAction =
      typeof item.recommendedNextAction === "string" && (CONTENT_GAP_NEXT_ACTIONS as readonly string[]).includes(item.recommendedNextAction)
        ? (item.recommendedNextAction as ContentGapNextAction)
        : null;

    classifications.set(key, { suggestedContentType, recommendedNextAction });
  }

  return classifications;
}

/**
 * Builds the final result from the DETERMINISTIC gaps outward, overlaying
 * whatever valid classification the model managed to supply for each one.
 *
 * Stage C reversed the direction this used to iterate. Previously it walked
 * the model's response and kept only items that matched a real gap, so a
 * weak fallback model returning nothing usable discarded every genuine
 * audit opportunity along with it (confirmed live). Every field except the
 * two classification fields is real audit data that needs no AI at all, so
 * every prepared gap now always appears exactly once, in its original
 * order, with its deterministic fields intact — the model can only enrich
 * an opportunity, never remove or alter one.
 *
 * The anti-fabrication guarantees are unchanged and, for the next action,
 * strengthened: topic/opportunity/reason/relatedCluster/
 * existingCoverageStatus/matchedExistingTitle are always the prepared gap's
 * own values, and recommendedNextAction is only ever populated when the
 * deterministic coverage check actually found a possible match — so
 * UPDATE_EXISTING remains structurally impossible for a gap with no match,
 * and no create-vs-update verdict is invented for one either.
 */
export function buildContentGapAnalysisResult(rawOpportunities: unknown[], gaps: PreparedContentGap[]): ContentGapAnalysisResult {
  const classifications = indexModelClassifications(rawOpportunities);

  const opportunities: ContentGapOpportunity[] = gaps.map((gap) => {
    const classification = classifications.get(gap.title.trim().toLowerCase());
    const coverage = gap.coverage;

    return {
      topic: gap.title,
      opportunity: gap.description,
      reason: gap.reasoning,
      relatedCluster: gap.relatedCluster,
      existingCoverageStatus: coverage.status,
      matchedExistingTitle: coverage.status === "POSSIBLE_MATCH" ? coverage.matchedTitle : null,
      suggestedContentType: classification?.suggestedContentType ?? null,
      // Not applicable when nothing matched — there is no existing page to
      // update, so no verdict is stored rather than a manufactured one.
      recommendedNextAction: coverage.status === "POSSIBLE_MATCH" ? (classification?.recommendedNextAction ?? null) : null,
    };
  });

  return { opportunities };
}

/**
 * The ninth AI Workspace tool's generation entry point. Mirrors
 * schema-markup-generator.service.ts's shape exactly: a thin prompt-builder
 * around the shared generateStructuredOutput orchestrator — no changes to
 * lib/ai/providers/*. Does not consume Brand Profile: no output field here
 * depends on brand voice/tone (topic/opportunity/reason are copied
 * verbatim from the audit; suggestedContentType/recommendedNextAction are
 * format/action judgments that don't need it), so it is deliberately
 * omitted to keep the grounding surface — and therefore the fabrication
 * surface — as small as the approved scope actually requires.
 */
export async function generateContentGapAnalysis(ctx: ContentGapAnalysisContext, onChunk?: (event: StreamEvent) => void): Promise<ContentGapAnalysisResult> {
  const gaps = prepareContentGaps(ctx.gaps, ctx.contentClusters, ctx.existingTitles);
  if (gaps.length === 0) return { opportunities: [] };

  const options = {
    system: CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT,
    prompt: buildPrompt({ seoProjectName: ctx.seoProjectName, domain: ctx.domain, gaps }),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "CONTENT_GAP_ANALYSIS" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const raw = onChunk
    ? await generateStructuredOutputStreaming(contentGapAnalysisProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(contentGapAnalysisProviderOutputSchema, options);
  const parsed = contentGapAnalysisProviderOutputSchema.parse(raw);

  return buildContentGapAnalysisResult(parsed.opportunities, gaps);
}
