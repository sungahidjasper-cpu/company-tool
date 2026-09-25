import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";

import { computeExistingCoverage } from "@/features/ai-workspace/services/content-gap-analysis.service";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";
import type { BrandProfile } from "@/lib/generated/prisma/client";
import {
  TOPIC_CONTENT_TYPES,
  TOPIC_SEARCH_INTENTS,
  topicClusterProviderOutputSchema,
  type TopicCluster,
  type TopicClusterPlanResult,
  type TopicContentType,
  type TopicExistingCoverage,
  type TopicSearchIntent,
  type TopicSupportingTopic,
} from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";

export const PROMPT_VERSION = 2;

const MAX_OUTPUT_TOKENS = 3500;
const MAX_CLUSTERS = 5;
const MAX_SUPPORTING_TOPICS_PER_CLUSTER = 6;
const MAX_SUBTOPICS_PER_TOPIC = 5;
const MAX_CONTENT_IDEAS_PER_CLUSTER = 4;

/**
 * The tenth AI Workspace tool's system prompt.
 *
 * The hard rule is data honesty. This app has real values for only a handful
 * of keywords and no ranking, traffic, or Search Console data at all, so any
 * numeric SEO figure in the output would necessarily be invented. The model
 * is also never asked to identify existing keywords or pages — that is
 * computed in code below — so it is told plainly not to claim such identities
 * either.
 *
 * The hierarchy instructions carry the SEO/GEO/AEO intent: distinct content
 * targets that don't compete with each other (SEO), comprehensive
 * non-repetitive topical coverage of the subject (GEO), and question-shaped
 * subtopics that can be answered concisely (AEO) — without ever promising a
 * ranking, a snippet, or any performance outcome.
 */
export const TOPIC_CLUSTER_PLANNER_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are an SEO content strategist planning topical clusters around one primary topic. The primary topic supplied below was written by the user and is the authoritative subject — every cluster must be a meaningful grouping WITHIN that subject, never a different subject. Any keyword terms, cluster names, or existing page titles supplied below are real records from this customer's own project; treat them as factual context only.

Structure matters and must not be flattened. A CLUSTER is a meaningful topical grouping under the primary topic. A SUPPORTING TOPIC is a distinct page-level content target within that cluster — something that deserves its own page. A SUBTOPIC is a specific angle, section, or question inside a supporting topic — never its own page. A CONTENT IDEA is a possible future piece related to the cluster that isn't one of the supporting topics.

Every supporting topic must target a genuinely distinct search need. Never split a single search need into near-identical topics, never list synonyms or simple keyword variations as separate topics, and never pad the plan to reach a count — fewer, sharper topics are better. Where a topic is naturally question-shaped, phrase subtopics as the actual questions a reader would ask, so they can be answered concisely.

Never state or imply a search volume, keyword difficulty, ranking position, SERP position, impression count, click count, traffic figure, click-through rate, domain authority, backlink count, or competitor fact — none of that data has been supplied to you, and inventing any of it is a serious error. Never claim that a topic "ranks", "is ranking", or "gets traffic". Never promise a ranking, a featured snippet, AI-assistant visibility, or any performance outcome. Never invent a URL, a page title, or a keyword and present it as an existing record in this customer's account — if you want to reference existing coverage, describe it in general terms and let the application match it.`;

export type TopicClusterPlannerContext = {
  /** Provenance for the AiUsageLog row. */
  seoProjectId: string;
  /** Required for enforceCompanyAiLimits. */
  companyId: string;
  seoProjectName: string;
  domain: string;
  /** USER INPUT — never a platform record. */
  seedTopic: string;
  audience?: string;
  notes?: string;
  /** Real, server-loaded project records. */
  keywordTerms: string[];
  clusterNames: string[];
  existingTitles: string[];
};

/**
 * Numeric SEO claims the platform cannot support. Matched conservatively —
 * each pattern requires a DIGIT next to a metric word, so ordinary strategic
 * prose ("high search intent", "competitive topic", "drives traffic to the
 * pillar") is untouched while "1,200 monthly searches" or "ranks #3" is not.
 *
 * Reject, never repair: an entry carrying such a claim is dropped whole
 * rather than having the number stripped out, matching the doctrine every
 * other tool's deterministic filter follows.
 */
const FABRICATED_METRIC_PATTERNS: readonly RegExp[] = [
  /\b\d[\d,.]*\s*(?:\+\s*)?(?:monthly\s+)?(?:searches|search(?:es)? per month|queries per month)\b/i,
  /\b(?:search\s+volume|monthly\s+volume|volume)\s*(?:of|is|:|=|~|about|approximately)?\s*\d/i,
  /\b(?:kd|keyword\s+difficulty|difficulty)\s*(?:of|is|:|=|~)?\s*\d/i,
  /\branks?\s*(?:#|no\.?|number|at|in)?\s*\d/i,
  /\branking\s+(?:#|no\.?|number|position)\s*\d/i,
  /\bposition\s*(?:#|no\.?)?\s*\d/i,
  /\b\d[\d,.]*\s*(?:monthly\s+)?(?:impressions|clicks|visits|visitors|sessions|pageviews|page views)\b/i,
  /\b\d[\d,.]*%\s*(?:of\s+)?(?:traffic|ctr|click-through|conversion)/i,
  /\b(?:ctr|click-through rate)\s*(?:of|is|:|=)?\s*\d/i,
  /\b(?:da|dr|domain authority|domain rating)\s*(?:of|is|:|=)?\s*\d/i,
  /\b\d[\d,.]*\s*backlinks?\b/i,
];

/** True when the text makes a numeric SEO claim this platform has no data to support. */
export function containsFabricatedMetric(text: string): boolean {
  if (typeof text !== "string" || text.trim() === "") return false;
  return FABRICATED_METRIC_PATTERNS.some((pattern) => pattern.test(text));
}

/** Enum-validates a model-supplied classification; null when it isn't one of ours. Never guesses a fallback. */
export function normalizeSearchIntent(value: unknown): TopicSearchIntent | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (TOPIC_SEARCH_INTENTS as readonly string[]).includes(upper) ? (upper as TopicSearchIntent) : null;
}

export function normalizeContentType(value: unknown): TopicContentType | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (TOPIC_CONTENT_TYPES as readonly string[]).includes(upper) ? (upper as TopicContentType) : null;
}

/**
 * Associates a topic with the project's OWN keyword terms — computed here,
 * never taken from the model, so a keyword that does not exist in this
 * project can never appear as though it did.
 *
 * Conservative on purpose: a term counts only when the topic text actually
 * contains it (or vice versa). No stemming, no synonyms, no semantic
 * guessing — this app has no trustworthy mechanism for those, so it must not
 * imply one.
 */
export function matchProjectKeywords(topic: string, keywordTerms: readonly string[]): string[] {
  const haystack = topic.toLowerCase();
  const matches: string[] = [];
  for (const term of keywordTerms) {
    const needle = term.trim().toLowerCase();
    if (needle === "") continue;
    if (haystack.includes(needle) || needle.includes(haystack)) matches.push(term);
  }
  return Array.from(new Set(matches));
}

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const OVERLAP_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "your", "you", "how", "what", "why", "when", "is", "are", "best", "guide", "tips",
]);

function overlapWords(text: string): string[] {
  return normalizeKey(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !OVERLAP_STOP_WORDS.has(word));
}

/**
 * Deterministic near-duplicate detection between two supporting topics.
 *
 * This is the cannibalization safeguard, and it is deliberately modest: it
 * compares the actual words of two proposed topics and reports that they look
 * similar. It does NOT claim that either page ranks, that traffic would be
 * split, or that cannibalization will occur — the platform has no ranking or
 * traffic data, so any such claim would be invented.
 */
export function topicsSubstantiallyOverlap(a: string, b: string): boolean {
  const wordsA = new Set(overlapWords(a));
  const wordsB = new Set(overlapWords(b));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  const smaller = Math.min(wordsA.size, wordsB.size);
  return shared >= 2 && shared / smaller >= 0.6;
}

function coverageFor(topic: string, existingTitles: string[]): TopicExistingCoverage {
  const coverage = computeExistingCoverage(topic, existingTitles);
  return coverage.status === "POSSIBLE_MATCH"
    ? { status: "POSSIBLE_MATCH", matchedTitle: coverage.matchedTitle }
    : { status: "NOT_FOUND", matchedTitle: null };
}

/** Cleans a free-text list (subtopics, content ideas): trims, drops empties, metric claims and duplicates, and caps length. */
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
 * The strict, deterministic filter. Everything trustworthy in the result is
 * produced here rather than accepted from the model:
 *
 * - the hierarchy is enforced (a cluster with no supporting topics is dropped),
 * - classifications are enum-validated (null when invalid),
 * - existing coverage is computed from real Content titles,
 * - related keywords are matched against real project keyword terms,
 * - entries making unsupported numeric SEO claims are dropped whole,
 * - duplicate clusters, supporting topics and subtopics are removed,
 * - near-duplicate supporting topics are flagged for consolidation.
 *
 * Supporting-topic de-duplication is GLOBAL across clusters, not per-cluster:
 * the same page-level target appearing under two clusters is exactly the
 * competing-content problem this tool is meant to prevent.
 */
export function buildTopicClusterPlanResult(
  raw: unknown,
  ctx: { seedTopic: string; keywordTerms: string[]; clusterNames: string[]; existingTitles: string[] }
): TopicClusterPlanResult {
  const base: TopicClusterPlanResult = {
    seedTopic: ctx.seedTopic,
    clusters: [],
    existingClusterNames: ctx.clusterNames,
  };

  const parsed = topicClusterProviderOutputSchema.safeParse(raw);
  if (!parsed.success) return base;

  const seenClusterNames = new Set<string>();
  const acceptedTopics: { topic: string; clusterName: string }[] = [];
  const clusters: TopicCluster[] = [];

  for (const rawCluster of parsed.data.clusters) {
    if (clusters.length >= MAX_CLUSTERS) break;

    const name = rawCluster.name.trim();
    const purpose = rawCluster.purpose.trim();
    const pillarRelationship = rawCluster.pillarRelationship.trim();
    if (name === "") continue;
    if (containsFabricatedMetric(name) || containsFabricatedMetric(purpose) || containsFabricatedMetric(pillarRelationship)) continue;

    const clusterKey = normalizeKey(name);
    if (seenClusterNames.has(clusterKey)) continue;

    const supportingTopics: TopicSupportingTopic[] = [];
    for (const rawTopic of rawCluster.supportingTopics) {
      if (supportingTopics.length >= MAX_SUPPORTING_TOPICS_PER_CLUSTER) break;

      const topic = rawTopic.topic.trim();
      if (topic === "") continue;

      const relationshipToPillar = rawTopic.relationshipToPillar.trim();
      const rationale = rawTopic.rationale.trim();
      if (containsFabricatedMetric(topic) || containsFabricatedMetric(relationshipToPillar) || containsFabricatedMetric(rationale)) continue;

      const topicKey = normalizeKey(topic);
      // Exact duplicates anywhere in the plan are dropped outright.
      if (acceptedTopics.some((accepted) => normalizeKey(accepted.topic) === topicKey)) continue;
      // A supporting topic that merely restates its own cluster is not a distinct target.
      if (topicKey === clusterKey) continue;

      // Near-duplicate: kept, but flagged so the user can decide. Never
      // presented as a ranking or cannibalization claim.
      const similar = acceptedTopics.find((accepted) => topicsSubstantiallyOverlap(accepted.topic, topic));
      const overlapNote = similar
        ? `Potential overlap with "${similar.topic}"${similar.clusterName === name ? "" : ` in "${similar.clusterName}"`} — consider consolidating them into one page.`
        : null;

      supportingTopics.push({
        topic,
        relationshipToPillar,
        rationale,
        searchIntent: normalizeSearchIntent(rawTopic.searchIntent),
        suggestedContentType: normalizeContentType(rawTopic.suggestedContentType),
        subtopics: cleanTextList(rawTopic.subtopics, MAX_SUBTOPICS_PER_TOPIC),
        existingCoverage: coverageFor(topic, ctx.existingTitles),
        relatedKeywords: matchProjectKeywords(topic, ctx.keywordTerms),
        overlapNote,
      });
      acceptedTopics.push({ topic, clusterName: name });
    }

    // The hierarchy is the product. A cluster with nothing beneath it is not
    // a cluster, so it is dropped rather than shown as an empty shell.
    if (supportingTopics.length === 0) continue;

    seenClusterNames.add(clusterKey);
    clusters.push({
      name,
      purpose,
      pillarRelationship,
      searchIntent: normalizeSearchIntent(rawCluster.searchIntent),
      suggestedContentType: normalizeContentType(rawCluster.suggestedContentType),
      existingCoverage: coverageFor(name, ctx.existingTitles),
      relatedKeywords: matchProjectKeywords(name, ctx.keywordTerms),
      supportingTopics,
      contentIdeas: cleanTextList(rawCluster.contentIdeas, MAX_CONTENT_IDEAS_PER_CLUSTER),
    });
  }

  return { ...base, clusters };
}

export function buildPrompt(ctx: TopicClusterPlannerContext, brandProfile?: BrandProfile | null): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  lines.push("", `USER-PROVIDED PRIMARY TOPIC (authoritative subject): "${ctx.seedTopic}"`);
  if (ctx.audience) lines.push(`User-provided target audience: ${ctx.audience}`);
  if (ctx.notes) lines.push(`User-provided notes: ${ctx.notes}`);

  if (brandProfile?.targetAudience) lines.push(`Brand Profile audience: ${brandProfile.targetAudience}`);
  if (brandProfile?.brandVoice) lines.push(`Brand voice: ${brandProfile.brandVoice}`);

  lines.push("", "EXISTING PROJECT DATA (real records from this customer's account — factual context only):");
  lines.push(
    ctx.keywordTerms.length > 0
      ? `- Existing tracked keywords: ${ctx.keywordTerms.map((t) => `"${t}"`).join(", ")}`
      : "- Existing tracked keywords: none recorded for this project."
  );
  lines.push(
    ctx.clusterNames.length > 0
      ? `- Existing keyword clusters: ${ctx.clusterNames.map((n) => `"${n}"`).join(", ")}`
      : "- Existing keyword clusters: none recorded for this project."
  );
  lines.push(
    ctx.existingTitles.length > 0
      ? `- Existing content titles: ${ctx.existingTitles.slice(0, 40).map((t) => `"${t}"`).join(", ")}`
      : "- Existing content titles: none recorded for this project."
  );
  lines.push(
    "",
    "No search volume, keyword difficulty, ranking, traffic, or competitor data is available for this project. Do not state or estimate any such figure."
  );

  lines.push(
    "",
    `Produce between 2 and ${MAX_CLUSTERS} topical clusters for this primary topic. For each cluster:`,
    "1. name: a short name for the topical grouping.",
    "2. purpose: what this cluster covers and who it serves.",
    "3. pillarRelationship: how this cluster supports the primary topic.",
    `4. supportingTopics: up to ${MAX_SUPPORTING_TOPICS_PER_CLUSTER} distinct page-level content targets. Each needs relationshipToPillar, rationale, and up to ${MAX_SUBTOPICS_PER_TOPIC} subtopics (specific angles or reader questions inside that page — not separate pages).`,
    `5. contentIdeas: up to ${MAX_CONTENT_IDEAS_PER_CLUSTER} further ideas related to the cluster, beyond the supporting topics above.`,
    `6. searchIntent for the cluster and for each supporting topic: one of ${TOPIC_SEARCH_INTENTS.join(", ")}.`,
    `7. suggestedContentType for the cluster and for each supporting topic: one of ${TOPIC_CONTENT_TYPES.join(", ")}.`,
    "",
    "Do not include any keyword ids, content ids, URLs, or numeric SEO metrics — the application supplies existing-keyword and existing-coverage information itself."
  );

  return lines.join("\n");
}

/**
 * Generation entry point. A thin prompt-builder around the shared
 * generateStructuredOutput orchestrator — no changes to lib/ai/providers/*.
 */
export async function generateTopicClusterPlan(
  ctx: TopicClusterPlannerContext,
  onChunk?: (event: StreamEvent) => void
): Promise<TopicClusterPlanResult> {
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);

  const options = {
    system: TOPIC_CLUSTER_PLANNER_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, brandProfile),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "TOPIC_CLUSTER_PLANNING" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };

  const raw = onChunk
    ? await generateStructuredOutputStreaming(topicClusterProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(topicClusterProviderOutputSchema, options);

  return buildTopicClusterPlanResult(raw, {
    seedTopic: ctx.seedTopic,
    keywordTerms: ctx.keywordTerms,
    clusterNames: ctx.clusterNames,
    existingTitles: ctx.existingTitles,
  });
}
