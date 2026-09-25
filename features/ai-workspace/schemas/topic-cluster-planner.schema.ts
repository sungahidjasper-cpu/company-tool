import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { optionalString } from "@/lib/zod-helpers";

/**
 * The tenth AI Workspace tool. Same v3-input / v4-output split every other
 * tool uses.
 *
 * The primary (seed) topic is REQUIRED and is explicitly USER INPUT — it is
 * the one thing this tool cannot derive, and the database's keyword inventory
 * is far too sparse to start from. keywordIds is the opposite: those are
 * real, authoritative platform records, validated server-side against the
 * selected project before they are ever used.
 */
export const topicClusterPlannerInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
  seedTopic: z.string().trim().min(3, "Enter a primary topic").max(200, "Primary topic is too long"),
  /** Optional selection of the project's OWN existing keywords — ids only, re-verified server-side. */
  keywordIds: z.array(z.string().uuid()).max(25).default([]),
  audience: optionalString(),
  notes: optionalString(),
});
export type TopicClusterPlannerInput = z.infer<typeof topicClusterPlannerInputSchema>;

/**
 * The PROVIDER-FACING shape — deliberately loose (every classification a
 * plain string), the same "loose contract in, strict filter out" principle
 * content-gap-analysis.schema.ts established: one cosmetically-off enum value
 * must not fail the entire response and burn a retry/fallback.
 *
 * Note what the model is NEVER asked for: no keyword id, no content id, no
 * URL, no search volume, no difficulty, no ranking, no traffic. Those fields
 * do not exist on this contract at all, so a fabricated one is structurally
 * impossible rather than merely discouraged.
 *
 * The hierarchy is explicit here rather than flattened: clusters contain
 * supporting topics, which contain subtopics. Flattening would lose exactly
 * the structure this tool exists to produce.
 */
export const topicClusterProviderOutputSchema = zv4.object({
  clusters: zv4
    .array(
      zv4.object({
        name: zv4.string(),
        purpose: zv4.string(),
        pillarRelationship: zv4.string(),
        searchIntent: zv4.string(),
        suggestedContentType: zv4.string(),
        supportingTopics: zv4
          .array(
            zv4.object({
              topic: zv4.string(),
              relationshipToPillar: zv4.string(),
              rationale: zv4.string(),
              searchIntent: zv4.string(),
              suggestedContentType: zv4.string(),
              subtopics: zv4.array(zv4.string()).default([]),
            })
          )
          .default([]),
        contentIdeas: zv4.array(zv4.string()).default([]),
      })
    )
    .default([]),
});
export type TopicClusterProviderOutput = zv4.infer<typeof topicClusterProviderOutputSchema>;

export const TOPIC_SEARCH_INTENTS = ["INFORMATIONAL", "COMMERCIAL", "TRANSACTIONAL", "NAVIGATIONAL"] as const;
export type TopicSearchIntent = (typeof TOPIC_SEARCH_INTENTS)[number];

export const TOPIC_CONTENT_TYPES = ["ARTICLE", "GUIDE", "LANDING_PAGE", "FAQ_PAGE", "CASE_STUDY", "COMPARISON"] as const;
export type TopicContentType = (typeof TOPIC_CONTENT_TYPES)[number];

/**
 * Deterministic, code-computed coverage against the project's REAL Content
 * titles. Deliberately hedged: POSSIBLE_MATCH means "a title looks related",
 * never "this topic is covered" or "this page ranks" — this app has no
 * semantic-coverage or ranking mechanism, so it must not imply one.
 */
export const topicExistingCoverageSchema = zv4.object({
  status: zv4.enum(["NOT_FOUND", "POSSIBLE_MATCH"]),
  matchedTitle: zv4.string().nullable(),
});
export type TopicExistingCoverage = zv4.infer<typeof topicExistingCoverageSchema>;

/**
 * One supporting topic — a distinct content target beneath a cluster.
 *
 * searchIntent and suggestedContentType are nullable for the same reason
 * content-gap-analysis.schema.ts made its judgment fields nullable: when a
 * weak fallback model returns nothing valid, an all-or-nothing contract would
 * discard an otherwise-good plan. Null means "not supplied" — never a
 * fabricated fallback classification.
 *
 * overlapNote is computed in code, never asserted by the model, and is
 * deliberately worded as a possibility to consider rather than a ranking or
 * cannibalization claim the platform has no data to support.
 */
export const topicSupportingTopicSchema = zv4.object({
  topic: zv4.string(),
  relationshipToPillar: zv4.string(),
  rationale: zv4.string(),
  searchIntent: zv4.enum(TOPIC_SEARCH_INTENTS).nullable(),
  suggestedContentType: zv4.enum(TOPIC_CONTENT_TYPES).nullable(),
  subtopics: zv4.array(zv4.string()).default([]),
  existingCoverage: topicExistingCoverageSchema,
  /** Real keyword terms from this project, matched deterministically. Never model-supplied. */
  relatedKeywords: zv4.array(zv4.string()).default([]),
  /** Deterministic "these two look similar — consider consolidating" note. Never a ranking claim. */
  overlapNote: zv4.string().nullable(),
});
export type TopicSupportingTopic = zv4.infer<typeof topicSupportingTopicSchema>;

export const topicClusterSchema = zv4.object({
  name: zv4.string(),
  purpose: zv4.string(),
  pillarRelationship: zv4.string(),
  searchIntent: zv4.enum(TOPIC_SEARCH_INTENTS).nullable(),
  suggestedContentType: zv4.enum(TOPIC_CONTENT_TYPES).nullable(),
  existingCoverage: topicExistingCoverageSchema,
  relatedKeywords: zv4.array(zv4.string()).default([]),
  supportingTopics: zv4.array(topicSupportingTopicSchema).default([]),
  contentIdeas: zv4.array(zv4.string()).default([]),
});
export type TopicCluster = zv4.infer<typeof topicClusterSchema>;

export const topicClusterPlanResultSchema = zv4.object({
  /** Echoed back so the review screen can label it plainly as the user's own input. */
  seedTopic: zv4.string(),
  clusters: zv4.array(topicClusterSchema).default([]),
  /** Real cluster names from this project, for context only — never invented. */
  existingClusterNames: zv4.array(zv4.string()).default([]),
});
export type TopicClusterPlanResult = zv4.infer<typeof topicClusterPlanResultSchema>;

export const topicClusterPlanJobResultSchema = zv4.object({ result: topicClusterPlanResultSchema.nullable() });
export type TopicClusterPlanJobResult = zv4.infer<typeof topicClusterPlanJobResultSchema>;

/**
 * The FIRST released shape of this tool's result: a single pillar plus a flat
 * list of supporting topics. Kept so a job generated before the multi-cluster
 * enhancement still opens correctly when resumed via ?jobId= — losing an
 * already-paid-for generation would be a real regression, not a cosmetic one.
 * Only ever read, never written.
 */
export const legacyTopicClusterPlanResultSchema = zv4.object({
  seedTopic: zv4.string(),
  pillar: zv4
    .object({
      topic: zv4.string(),
      description: zv4.string(),
      searchIntent: zv4.enum(TOPIC_SEARCH_INTENTS).nullable(),
      suggestedContentType: zv4.enum(TOPIC_CONTENT_TYPES).nullable(),
      existingCoverage: topicExistingCoverageSchema,
      relatedKeywords: zv4.array(zv4.string()).default([]),
    })
    .nullable(),
  supportingTopics: zv4
    .array(
      zv4.object({
        topic: zv4.string(),
        searchIntent: zv4.enum(TOPIC_SEARCH_INTENTS).nullable(),
        suggestedContentType: zv4.enum(TOPIC_CONTENT_TYPES).nullable(),
        relationshipToPillar: zv4.string(),
        rationale: zv4.string(),
        existingCoverage: topicExistingCoverageSchema,
        relatedKeywords: zv4.array(zv4.string()).default([]),
      })
    )
    .default([]),
  existingClusterNames: zv4.array(zv4.string()).default([]),
});

/**
 * Adapts a first-release plan into the current multi-cluster shape by
 * presenting its single pillar as one cluster. Nothing is invented: subtopics
 * and content ideas are empty because that plan never had them.
 */
/**
 * Reads a stored job result into the current shape, whichever shape it was
 * written in.
 *
 * Order matters, and not obviously: `clusters` carries `.default([])`, so the
 * CURRENT schema parses a first-release payload quite happily — into a plan
 * with zero clusters. Trusting that would silently discard a real, already
 * paid-for plan and show "nothing was returned". Browser verification caught
 * exactly that. So a successful parse that yields no clusters is treated as
 * inconclusive and the legacy adapter is given a chance before the empty
 * result is accepted.
 */
export function parseTopicClusterPlanResult(raw: unknown): TopicClusterPlanResult | null {
  const parsed = topicClusterPlanResultSchema.safeParse(raw);
  if (parsed.success && parsed.data.clusters.length > 0) return parsed.data;

  const legacy = adaptLegacyTopicClusterPlan(raw);
  if (legacy) return legacy;

  // A genuinely empty current-shape result (the model returned nothing usable)
  // is still a valid, honest outcome — return it so the caller can say so.
  return parsed.success ? parsed.data : null;
}

export function adaptLegacyTopicClusterPlan(raw: unknown): TopicClusterPlanResult | null {
  const parsed = legacyTopicClusterPlanResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const legacy = parsed.data;
  if (!legacy.pillar && legacy.supportingTopics.length === 0) return null;

  const pillar = legacy.pillar;
  return {
    seedTopic: legacy.seedTopic,
    existingClusterNames: legacy.existingClusterNames,
    clusters: [
      {
        name: pillar?.topic ?? legacy.seedTopic,
        purpose: pillar?.description ?? "",
        pillarRelationship: "Pillar topic for this plan.",
        searchIntent: pillar?.searchIntent ?? null,
        suggestedContentType: pillar?.suggestedContentType ?? null,
        existingCoverage: pillar?.existingCoverage ?? { status: "NOT_FOUND", matchedTitle: null },
        relatedKeywords: pillar?.relatedKeywords ?? [],
        contentIdeas: [],
        supportingTopics: legacy.supportingTopics.map((topic) => ({
          ...topic,
          subtopics: [],
          overlapNote: null,
        })),
      },
    ],
  };
}
