import { z } from "zod";
import { z as zv4 } from "zod/v4";

/**
 * Advisory-only length guidance, per the STEP 18 discovery report's finding
 * (features/seo/services/seo-issue-detection.service.ts:71,94): this app
 * already states "50-60 characters" for a title and "120-160 characters"
 * for a meta description elsewhere. Reused here rather than inventing new
 * numbers. Deliberately NOT the same as seo-checklist.service.ts's own
 * checkMetaLengths (which uses 150-160 for description, tuned for Google's
 * SERP truncation point) — that mismatch between two existing, independent
 * conventions in this codebase is a real, pre-existing inconsistency, not
 * something introduced here; this tool follows the specific guidance this
 * task named. These ranges are advisory — see filterValidSuggestions below,
 * which never rejects a suggestion for falling outside them.
 */
export const META_TITLE_GUIDANCE = { min: 50, max: 60 } as const;
export const META_DESCRIPTION_GUIDANCE = { min: 120, max: 160 } as const;

/**
 * The generation-form input — a plain form-validated shape (regular zod),
 * matching every other AI Workspace tool's own v3-input/v4-output split.
 * contentIds is a non-empty array (not a single contentId): this tool's own
 * purpose is bulk review across multiple existing pages at once, per the
 * approved multi-content selection design.
 */
/**
 * Stage C addition (flagged, not silent): the Stage B version of this
 * schema validated shape only (non-empty strings). Stage C's own explicit
 * security requirements — bounding the bulk selection size, and rejecting
 * a malformed id before it ever reaches a database lookup against a
 * @db.Uuid column — are genuine integration needs, so both constraints are
 * added here. No other field, and none of Stage B's own 29 tests (which
 * exercise filterValidSuggestions/buildPrompt, not this input schema), are
 * affected. MAX_SELECTED_CONTENT mirrors content.service.ts's own
 * MAX_INVENTORY_SIZE=50 (module-private there, so not importable) —
 * confirmed by inspection to be this repository's only precedent for this
 * kind of cap, reused at the same value rather than inventing a new one.
 */
export const MAX_SELECTED_CONTENT = 50;

export const metaTagOptimizerInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
  contentIds: z
    .array(z.string().min(1).uuid("Invalid content id"))
    .min(1, "Select at least one page to optimize")
    .max(MAX_SELECTED_CONTENT, `Select at most ${MAX_SELECTED_CONTENT} pages at once`),
});
export type MetaTagOptimizerInput = z.infer<typeof metaTagOptimizerInputSchema>;

/**
 * The PROVIDER-FACING output shape — deliberately loose, with NO fixed
 * enum of content IDs (per this task's explicit instruction). Every field
 * is a plain string; the server-authorized selected-content inventory is
 * cross-checked afterward, deterministically, in filterValidSuggestions —
 * the same "loose contract in, strict filter out" principle
 * internal-link-analyzer.schema.ts and social-snippet-generator.schema.ts
 * already established for their own domains (target-page URLs, platform
 * values). Encoding a fixed contentId enum here would also be structurally
 * wrong, not just riskier: the valid set changes per request (whichever
 * content the user selected), so it can never be a static schema shape.
 */
export const metaTagOptimizerProviderOutputSchema = zv4.object({
  suggestions: zv4
    .array(
      zv4.object({
        contentId: zv4.string(),
        suggestedMetaTitle: zv4.string(),
        suggestedMetaDescription: zv4.string(),
        reasoning: zv4.string(),
      })
    )
    .default([]),
});

/**
 * A single length-guidance readout — mirrors seo-checklist.service.ts's own
 * LengthCheck shape exactly (length/min/max/status) so a future UI can
 * reuse the same rendering it already has for ContentBriefReview.tsx/
 * LongFormContentReview.tsx's meta-length badges, rather than inventing a
 * second shape for the same concept.
 */
export const lengthGuidanceSchema = zv4.object({
  length: zv4.number(),
  min: zv4.number(),
  max: zv4.number(),
  status: zv4.enum(["OK", "TOO_SHORT", "TOO_LONG"]),
});
export type LengthGuidance = zv4.infer<typeof lengthGuidanceSchema>;

/**
 * The CANONICAL job-result shape — what a suggestion looks like once
 * filterValidSuggestions has already run. url/currentMetaTitle/
 * currentMetaDescription come from the server-authorized inventory, never
 * from the AI. titleLengthGuidance/descriptionLengthGuidance are always
 * computed here from the actual accepted (post-sanitizer) text — never a
 * model-reported value — and are informational only: see
 * filterValidSuggestions's own comment for why a suggestion is never
 * rejected merely for falling outside the advisory range.
 *
 * titleChanged/descriptionChanged are likewise always computed here from a
 * deterministic string comparison against the real current value — never
 * from the AI's own `reasoning` narrative. Discovered live: the model can
 * return a suggestion byte-identical to the current value while its
 * reasoning still claims a change was made. These two booleans let the UI
 * tell the truth regardless of what the reasoning text says — see
 * filterValidSuggestions's own comment for exactly how they're computed.
 */
export const metaTagSuggestionSchema = zv4.object({
  contentId: zv4.string(),
  url: zv4.string().nullable(),
  currentMetaTitle: zv4.string().nullable(),
  suggestedMetaTitle: zv4.string(),
  titleChanged: zv4.boolean(),
  currentMetaDescription: zv4.string().nullable(),
  suggestedMetaDescription: zv4.string(),
  descriptionChanged: zv4.boolean(),
  reasoning: zv4.string(),
  titleLengthGuidance: lengthGuidanceSchema,
  descriptionLengthGuidance: lengthGuidanceSchema,
});
export type MetaTagSuggestion = zv4.infer<typeof metaTagSuggestionSchema>;

export const metaTagOptimizerResultSchema = zv4.object({
  suggestions: zv4.array(metaTagSuggestionSchema).default([]),
});
export type MetaTagOptimizerResult = zv4.infer<typeof metaTagOptimizerResultSchema>;

/**
 * The apply-one-suggestion input — a plain form-validated shape (regular
 * zod), matching metaTagOptimizerInputSchema's own v3-input convention.
 * Deliberately takes the approved metaTitle/metaDescription text directly
 * (not a suggestion id or the whole MetaTagSuggestion object): the action
 * re-verifies ownership of contentId against BOTH seoProjectId and the
 * actor's company itself before writing anything, so it never trusts a
 * client-supplied "this suggestion is valid" claim — only the two literal
 * strings the user is choosing to apply.
 */
export const applyMetaTagSuggestionInputSchema = z.object({
  seoProjectId: z.string().min(1, "Missing SEO project").uuid("Invalid SEO project id"),
  contentId: z.string().min(1, "Missing content id").uuid("Invalid content id"),
  metaTitle: z.string().min(1, "Meta title is required"),
  metaDescription: z.string().min(1, "Meta description is required"),
});
export type ApplyMetaTagSuggestionInput = z.infer<typeof applyMetaTagSuggestionInputSchema>;
