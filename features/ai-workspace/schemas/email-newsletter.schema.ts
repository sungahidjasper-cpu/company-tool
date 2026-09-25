import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { optionalString } from "@/lib/zod-helpers";

/**
 * The generation-form input — plain form-validated shape (regular zod),
 * matching every other AI Workspace tool's v3-input/v4-output split.
 *
 * `contentId` is REQUIRED, unlike Press Release Generator (which has none)
 * and Schema Markup Generator (which makes it optional): a newsletter that
 * is not grounded in a real page the customer actually owns would be pure
 * invention, which is exactly what this tool must not produce.
 *
 * `additionalContext` is the deliberate escape hatch for a Content row that
 * carries a title but no body (a brief-only record). It is the user's own
 * material, clearly separated from the source page's text everywhere it is
 * used. Capped at 4000 characters, matching press-release-generator's own
 * `keyFacts` cap — the same role: real grounding material rather than a
 * short supplementary aside.
 */
export const emailNewsletterInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
  contentId: z.string().min(1, "Select a source content record").uuid("Invalid content id"),
  audience: optionalString(),
  callToAction: optionalString(),
  campaignAngle: optionalString(),
  additionalContext: z.string().max(4000, "Keep additional context under 4000 characters").optional(),
  notes: optionalString(),
});
export type EmailNewsletterInput = z.infer<typeof emailNewsletterInputSchema>;

/**
 * The stored job-input shape. Identical to the form input: this tool stores
 * ids and the user's own text, never any resolved Content field — the
 * dispatcher re-fetches the authoritative Content row itself rather than
 * trusting anything about it from the job row.
 */
export const emailNewsletterJobInputSchema = emailNewsletterInputSchema;
export type EmailNewsletterJobInput = z.infer<typeof emailNewsletterJobInputSchema>;

/**
 * The PROVIDER-FACING output shape — deliberately loose, in line with the
 * "loose contract in, strict deterministic filter out; reject, never repair"
 * doctrine every AI Workspace tool follows. Every field is a plain string or
 * a plain array of objects; nothing here is trusted until
 * buildEmailNewsletterResult has run over it.
 */
export const emailNewsletterSectionProviderSchema = zv4.object({
  heading: zv4.string(),
  body: zv4.string(),
});

export const emailNewsletterProviderOutputSchema = zv4.object({
  subjectLine: zv4.string(),
  previewText: zv4.string(),
  headline: zv4.string(),
  introduction: zv4.string(),
  bodySections: zv4.array(emailNewsletterSectionProviderSchema).default([]),
  callToAction: zv4.string(),
  closing: zv4.string(),
  reasoning: zv4.string(),
});
export type EmailNewsletterProviderOutput = zv4.infer<typeof emailNewsletterProviderOutputSchema>;

/** One body section of the finished newsletter. */
export const emailNewsletterSectionSchema = zv4.object({
  heading: zv4.string(),
  body: zv4.string(),
});
export type EmailNewsletterSection = zv4.infer<typeof emailNewsletterSectionSchema>;

/**
 * The CANONICAL result shape — what a newsletter looks like once
 * buildEmailNewsletterResult has already validated and cleaned it. A single
 * result, not a list: exactly one newsletter is generated per request.
 *
 * The field set is exactly the newsletter anatomy that was asked for —
 * subject line, preview text, headline, introduction, body, CTA, closing —
 * plus the `reasoning` field every other AI Workspace tool carries for the
 * reviewer. No delivery, scheduling, recipient, list or campaign field
 * exists anywhere in this shape, because this tool drafts and nothing else.
 */
export const emailNewsletterResultSchema = zv4.object({
  subjectLine: zv4.string(),
  previewText: zv4.string(),
  headline: zv4.string(),
  introduction: zv4.string(),
  bodySections: zv4.array(emailNewsletterSectionSchema),
  callToAction: zv4.string(),
  closing: zv4.string(),
  reasoning: zv4.string(),
});
export type EmailNewsletterResult = zv4.infer<typeof emailNewsletterResultSchema>;

/**
 * The JOB-RESULT shape stored in AiGenerationJob.resultJson — a single
 * nullable result, matching Press Release Generator's precedent exactly.
 * `result: null` is a genuine SUCCEEDED outcome meaning "the model's output
 * could not be turned into a valid, grounded newsletter", not a job failure.
 */
export const emailNewsletterJobResultSchema = zv4.object({
  result: emailNewsletterResultSchema.nullable(),
});
export type EmailNewsletterJobResult = zv4.infer<typeof emailNewsletterJobResultSchema>;

/**
 * Renders a canonical result as Markdown for `Content.body` — the same
 * "single Markdown string" convention `formatLongFormContentAsMarkdown`
 * already established for long-form content, applied here for the newsletter
 * save action. `headline` is the newsletter's own on-page heading (distinct
 * from `subjectLine`, which is inbox metadata and becomes `Content.title`
 * instead), so it is rendered as the body's leading `# ` heading rather than
 * dropped. `subjectLine`/`previewText`/`reasoning` are NOT included here —
 * they are inbox/reviewer metadata, not article body text, and are saved
 * separately into `Content.aiBriefDetails` (the full canonical result, so
 * nothing is ever lost regardless of how this function serializes the body).
 */
export function formatEmailNewsletterAsMarkdown(result: EmailNewsletterResult): string {
  const parts: string[] = [`# ${result.headline}`, result.introduction];

  for (const section of result.bodySections) {
    parts.push(`## ${section.heading}\n\n${section.body}`);
  }

  if (result.callToAction.trim()) parts.push(result.callToAction);
  if (result.closing.trim()) parts.push(result.closing);

  return parts.join("\n\n");
}

/**
 * The single source of truth for "is there enough real material to ground a
 * newsletter?", shared by the server action (which refuses before creating a
 * job) and the picker (which disables Generate).
 *
 * A title alone is not enough, and neither is a meta description: a
 * newsletter written from a 155-character summary would be padded out with
 * invention, which is precisely the failure this tool must not have. Real
 * material means the source page has body text, or the user supplied their
 * own additional context. Pure and directly testable — no I/O.
 */
export function hasEnoughSourceMaterial(input: { body: string | null | undefined; additionalContext?: string | null }): boolean {
  return (input.body ?? "").trim().length > 0 || (input.additionalContext ?? "").trim().length > 0;
}

/**
 * The exact message shown when the source page has no body text and the user
 * supplied no context of their own. It explains the situation and names the
 * two real ways forward — it never blames the user, and it never implies the
 * AI failed, because nothing has been generated at this point.
 */
export const INSUFFICIENT_SOURCE_MATERIAL_MESSAGE =
  "This content record has no body text yet, so there isn't enough source material for a grounded newsletter. Add body text to the content record, or provide additional context below to draft from.";
