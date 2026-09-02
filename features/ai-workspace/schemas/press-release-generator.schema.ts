import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { optionalString } from "@/lib/zod-helpers";

/**
 * The generation-form input — a plain form-validated shape (regular zod),
 * matching every other AI Workspace tool's own v3-input/v4-output split.
 * Deliberately has no contentId at all: unlike Schema Markup Generator
 * (optional contentId) or Content Rewriter (required contentId), this tool
 * never grounds in any existing Content row — the user's own supplied
 * announcement facts are the only real-world grounding source.
 *
 * keyFacts is required and capped at 4000 characters — the tool's actual
 * grounding source, so it needs to hold more than a short supplementary
 * aside; double social-snippet-generator.schema.ts's own 2000-character
 * cap on its supplementary `notes` field, not an arbitrary number.
 * quote/dateline/callToAction/notes use optionalString() (no explicit cap)
 * matching content-brief.schema.ts's and schema-markup-generator.schema.ts's
 * own identical `notes` field precedent — the majority convention in this
 * codebase for a supplementary free-text field.
 */
export const pressReleaseGeneratorInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
  headline: z.string().min(1, "Headline is required"),
  keyFacts: z.string().min(1, "Announcement details are required").max(4000, "Keep announcement details under 4000 characters"),
  quote: optionalString(),
  dateline: optionalString(),
  callToAction: optionalString(),
  notes: optionalString(),
});
export type PressReleaseGeneratorInput = z.infer<typeof pressReleaseGeneratorInputSchema>;

/**
 * The PROVIDER-FACING output shape — deliberately loose, every field a
 * plain string (bodyParagraphs a plain string array), same "loose contract
 * in, strict filter out" principle every other AI Workspace tool's own
 * provider schema follows. No contentId/url field at all — there is
 * structurally nothing for the AI to fabricate an id or URL for, since it
 * is never asked to supply one.
 */
export const pressReleaseGeneratorProviderOutputSchema = zv4.object({
  headline: zv4.string(),
  subheadline: zv4.string(),
  dateline: zv4.string(),
  leadParagraph: zv4.string(),
  bodyParagraphs: zv4.array(zv4.string()).default([]),
  quoteSection: zv4.string(),
  boilerplate: zv4.string(),
  callToAction: zv4.string(),
  reasoning: zv4.string(),
});
export type PressReleaseGeneratorProviderOutput = zv4.infer<typeof pressReleaseGeneratorProviderOutputSchema>;

/**
 * The CANONICAL result shape — what a press release looks like once
 * buildPressReleaseResult has already run. A single result, not a list
 * (matching Content Rewriter's own single-result precedent): exactly one
 * release is ever generated per request. reasoning is informational only,
 * same role as every other tool's own reasoning field — never a source of
 * truth for what changed, since there is nothing being compared here (this
 * tool never reads a prior version of anything).
 */
export const pressReleaseResultSchema = zv4.object({
  headline: zv4.string(),
  subheadline: zv4.string(),
  dateline: zv4.string(),
  leadParagraph: zv4.string(),
  bodyParagraphs: zv4.array(zv4.string()),
  quoteSection: zv4.string(),
  boilerplate: zv4.string(),
  callToAction: zv4.string(),
  reasoning: zv4.string(),
});
export type PressReleaseResult = zv4.infer<typeof pressReleaseResultSchema>;

/**
 * The JOB-RESULT shape actually stored in AiGenerationJob.resultJson — a
 * single nullable result, matching Content Rewriter's own
 * contentRewriterJobResultSchema precedent exactly. `result: null` is a
 * genuine, SUCCEEDED outcome (not a job failure) representing "the model's
 * output could not be turned into a valid, safe press release."
 */
export const pressReleaseJobResultSchema = zv4.object({
  result: pressReleaseResultSchema.nullable(),
});
export type PressReleaseJobResult = zv4.infer<typeof pressReleaseJobResultSchema>;
