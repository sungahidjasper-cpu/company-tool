import { z } from "zod";
import { z as zv4 } from "zod/v4";

/**
 * The generation-form input — a plain form-validated shape (regular zod),
 * matching every other AI Workspace tool's own v3-input/v4-output split.
 * Deliberately a SINGLE contentId (not an array like Meta Tag Optimizer's
 * bulk contentIds): this tool rewrites one existing page at a time, per the
 * approved v1 workflow (select project -> select one page -> generate ->
 * review -> apply).
 */
export const contentRewriterInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
  contentId: z.string().min(1, "Select a page to rewrite").uuid("Invalid content id"),
});
export type ContentRewriterInput = z.infer<typeof contentRewriterInputSchema>;

/**
 * The PROVIDER-FACING output shape — deliberately loose, every field a
 * plain string, same "loose contract in, strict filter out" principle every
 * other AI Workspace tool's own provider schema already follows. No
 * contentId field here at all: unlike Meta Tag Optimizer (which hands the
 * AI a multi-page inventory it must pick from), this tool only ever
 * operates on the ONE content row the server already resolved — there is
 * structurally nothing for the AI to fabricate an id for, since it is never
 * asked to supply one. Same reasoning for the absence of any url field.
 */
export const contentRewriterProviderOutputSchema = zv4.object({
  rewrittenTitle: zv4.string(),
  rewrittenMetaTitle: zv4.string(),
  rewrittenMetaDescription: zv4.string(),
  rewrittenBody: zv4.string(),
  reasoning: zv4.string(),
});
export type ContentRewriterProviderOutput = zv4.infer<typeof contentRewriterProviderOutputSchema>;

/**
 * The CANONICAL rewrite shape — what a rewrite looks like once
 * buildContentRewriteResult has already run. contentId/currentTitle/
 * currentMetaTitle/currentMetaDescription/currentBody all come from the
 * server-authorized Content row fetched fresh from the database, never from
 * the AI. currentTitle/currentBody are non-nullable: title is a required
 * Content column, and eligibility (checked before generation even starts)
 * requires a non-null, non-empty body. currentMetaTitle/currentMetaDescription
 * stay nullable, matching Content's own schema and Meta Tag Optimizer's
 * identical precedent for these two fields.
 *
 * titleChanged/metaTitleChanged/metaDescriptionChanged/bodyChanged are
 * always computed from a deterministic string comparison against the real
 * current value — never from the AI's own `reasoning` narrative. Same
 * lesson Meta Tag Optimizer's own live testing surfaced: the model can
 * return a field byte-identical to the current value while its reasoning
 * still claims a change was made.
 */
export const contentRewriteResultSchema = zv4.object({
  contentId: zv4.string(),
  currentTitle: zv4.string(),
  rewrittenTitle: zv4.string(),
  titleChanged: zv4.boolean(),
  currentMetaTitle: zv4.string().nullable(),
  rewrittenMetaTitle: zv4.string(),
  metaTitleChanged: zv4.boolean(),
  currentMetaDescription: zv4.string().nullable(),
  rewrittenMetaDescription: zv4.string(),
  metaDescriptionChanged: zv4.boolean(),
  currentBody: zv4.string(),
  rewrittenBody: zv4.string(),
  bodyChanged: zv4.boolean(),
  reasoning: zv4.string(),
});
export type ContentRewriteResult = zv4.infer<typeof contentRewriteResultSchema>;

/**
 * The JOB-RESULT shape actually stored in AiGenerationJob.resultJson — a
 * single nullable result rather than Meta Tag Optimizer's array, matching
 * this tool's single-content shape. `result: null` is a genuine, SUCCEEDED
 * outcome (not a job failure) representing "the model's output could not be
 * turned into any valid, safe rewrite" — the same "loose in, strict filter
 * out, total rejection is still a successful empty result" precedent every
 * array-shaped tool already established (e.g. Meta Tag Optimizer's own
 * `{ suggestions: [] }`), just expressed as null instead of an empty array
 * since there is only ever one possible result here.
 */
export const contentRewriterJobResultSchema = zv4.object({
  result: contentRewriteResultSchema.nullable(),
});
export type ContentRewriterJobResult = zv4.infer<typeof contentRewriterJobResultSchema>;

/**
 * The apply-rewrite input — a plain form-validated shape (regular zod),
 * matching meta-tag-optimizer.schema.ts's applyMetaTagSuggestionInputSchema
 * convention. Takes the four approved literal strings directly (not a
 * suggestion id or the whole ContentRewriteResult object): the action
 * re-verifies ownership of contentId against BOTH seoProjectId and the
 * actor's company before writing anything, so it never trusts a
 * client-supplied "this rewrite is valid" claim — only the four literal
 * strings the user is choosing to apply.
 */
export const applyContentRewriteInputSchema = z.object({
  seoProjectId: z.string().min(1, "Missing SEO project").uuid("Invalid SEO project id"),
  contentId: z.string().min(1, "Missing content id").uuid("Invalid content id"),
  title: z.string().min(1, "Title is required"),
  metaTitle: z.string().min(1, "Meta title is required"),
  metaDescription: z.string().min(1, "Meta description is required"),
  body: z.string().min(1, "Body is required"),
});
export type ApplyContentRewriteInput = z.infer<typeof applyContentRewriteInputSchema>;
