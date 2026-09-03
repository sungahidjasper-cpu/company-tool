import { z } from "zod";
import { z as zv4 } from "zod/v4";

/**
 * The generation-form input — a plain form-validated shape (regular zod),
 * matching every other AI Workspace tool's own v3-input/v4-output split.
 * No contentId, no notes: per Stage A discovery, the underlying
 * WebsiteAnalysisJob is resolved server-side (the latest SUCCEEDED audit
 * with real content-gap data), never user-picked — an SEO project only
 * ever has one "current" audit worth using, so there is no genuine choice
 * to surface here.
 */
export const contentGapAnalysisInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
});
export type ContentGapAnalysisInput = z.infer<typeof contentGapAnalysisInputSchema>;

/**
 * The actual AiGenerationJob.inputJson shape — richer than the form input
 * above, since it also carries the specific websiteAnalysisJobId the action
 * resolved server-side at job-creation time (see
 * content-gap-analysis.actions.ts). Validated separately from
 * contentGapAnalysisInputSchema, same precedent as ai-generation-job.schema.ts's
 * LongFormJobInput carrying more than its own form ever collects.
 */
export const contentGapAnalysisJobInputSchema = z.object({
  seoProjectId: z.string().min(1).uuid(),
  websiteAnalysisJobId: z.string().min(1).uuid(),
});
export type ContentGapAnalysisJobInput = z.infer<typeof contentGapAnalysisJobInputSchema>;

/**
 * The PROVIDER-FACING output shape — deliberately loose (every field a
 * plain string), following the exact "loose contract in, strict filter out"
 * shape internal-link-analyzer.schema.ts already established for the same
 * reason: a strict enum here would fail the ENTIRE response over one
 * cosmetically-off value, burning a wasted retry/fallback. The model is
 * asked for very little: topic (echoed back to correlate its answer to a
 * real, already-known gap — see buildContentGapAnalysisResult), plus a
 * content-type/next-action classification. It is never asked to invent a
 * gap, judge existing coverage itself, or supply topic/opportunity/reason
 * text of its own — those are always the original audit's own values.
 */
export const contentGapAnalysisProviderOutputSchema = zv4.object({
  opportunities: zv4
    .array(
      zv4.object({
        topic: zv4.string(),
        suggestedContentType: zv4.string(),
        recommendedNextAction: zv4.string(),
      })
    )
    .default([]),
});
export type ContentGapAnalysisProviderOutput = zv4.infer<typeof contentGapAnalysisProviderOutputSchema>;

export const CONTENT_GAP_CONTENT_TYPES = ["ARTICLE", "FAQ_PAGE", "LANDING_PAGE", "CASE_STUDY"] as const;
export type ContentGapContentType = (typeof CONTENT_GAP_CONTENT_TYPES)[number];

export const CONTENT_GAP_NEXT_ACTIONS = ["CREATE_NEW", "UPDATE_EXISTING"] as const;
export type ContentGapNextAction = (typeof CONTENT_GAP_NEXT_ACTIONS)[number];

/**
 * The CANONICAL per-opportunity shape — what actually lands in
 * AiGenerationJob.resultJson once buildContentGapAnalysisResult's own
 * strict, per-item filtering has already run. topic/opportunity/reason are
 * always the original audit's own text (never AI-rewritten);
 * relatedCluster/existingCoverageStatus/matchedExistingTitle are always
 * computed deterministically in code, never asserted by the model.
 *
 * Stage C — the two AI-judgment fields are nullable, because every field
 * above them is real audit data that needs no AI at all. Live verification
 * confirmed the failure this prevents: when Gemini was quota-limited and
 * the weak local fallback model returned no usable classifications, an
 * all-or-nothing contract discarded every genuine audit opportunity and
 * showed the user an empty result. Null means "not supplied" — never a
 * fabricated fallback classification. Their two null cases are told apart
 * deterministically by existingCoverageStatus, not by another field:
 *
 * - suggestedContentType: null = the model returned nothing valid for this
 *   item (always applicable — any opportunity could carry a format hint).
 * - recommendedNextAction: null when existingCoverageStatus is NOT_FOUND
 *   means NOT APPLICABLE — there is no existing page to update, so there is
 *   no create-vs-update decision to make and none is invented. Null when
 *   existingCoverageStatus is POSSIBLE_MATCH means the model returned
 *   nothing valid for an item where the question genuinely applied.
 *   UPDATE_EXISTING therefore remains structurally impossible whenever the
 *   deterministic coverage check found no match.
 */
export const contentGapOpportunitySchema = zv4.object({
  topic: zv4.string(),
  opportunity: zv4.string(),
  reason: zv4.string(),
  relatedCluster: zv4.string().nullable(),
  existingCoverageStatus: zv4.enum(["NOT_FOUND", "POSSIBLE_MATCH"]),
  matchedExistingTitle: zv4.string().nullable(),
  suggestedContentType: zv4.enum(CONTENT_GAP_CONTENT_TYPES).nullable(),
  recommendedNextAction: zv4.enum(CONTENT_GAP_NEXT_ACTIONS).nullable(),
});
export type ContentGapOpportunity = zv4.infer<typeof contentGapOpportunitySchema>;

export const contentGapAnalysisResultSchema = zv4.object({
  opportunities: zv4.array(contentGapOpportunitySchema).default([]),
});
export type ContentGapAnalysisResult = zv4.infer<typeof contentGapAnalysisResultSchema>;

export const contentGapAnalysisJobResultSchema = zv4.object({ result: contentGapAnalysisResultSchema.nullable() });
export type ContentGapAnalysisJobResult = zv4.infer<typeof contentGapAnalysisJobResultSchema>;
