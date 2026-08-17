import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { faqItemSchema } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import { contentBriefSettingsSchema } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { optionalString } from "@/lib/zod-helpers";

/**
 * Context for generating long-form content from a brief still held in the
 * caller's in-memory state — the "fresh flow," where the brief hasn't been
 * saved yet. Deliberately does NOT nest contentBriefOutputSchema (zod/v4)
 * as a field here: a plain zod (v3) `.object()` cannot validate a nested
 * zod/v4 sub-schema (confirmed directly — it throws `keyValidator._parse
 * is not a function`, a real incompatibility between the two zod majors,
 * not a false alarm). The action validates `brief` separately, with
 * contentBriefOutputSchema.safeParse() on its own.
 */
export const generateLongFormFromBriefContextSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project"),
  keywordId: optionalString(),
  /** Phase 21 — the same settings the brief was generated with; optional so a caller that omits it reproduces Phase 20's fixed-shape behavior exactly. */
  settings: contentBriefSettingsSchema.optional(),
});

export type GenerateLongFormFromBriefContext = z.infer<typeof generateLongFormFromBriefContextSchema>;

/**
 * The editable title/metaTitle/metaDescription/body fields as the reviewer
 * currently has them — validated here so both the create and update save
 * actions share one check. `body` is deliberately the plain string the
 * reviewer may have hand-edited, not re-derived from the original AI
 * output at save time: re-flattening from the structured article on the
 * server would silently discard any edits the user made to the body
 * textarea. formatLongFormContentAsMarkdown below is only ever called
 * client-side, once, to seed the textarea right after a
 * generate/regenerate — never again at save time.
 */
export const longFormSaveFieldsSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  metaTitle: z.string().min(1, "Meta title is required"),
  metaDescription: z.string().min(1, "Meta description is required"),
  body: z.string().min(1, "Article body cannot be empty"),
});

export type LongFormSaveFields = z.infer<typeof longFormSaveFieldsSchema>;

/**
 * The AI's structured output for the article body only. title/metaTitle/
 * metaDescription are deliberately NOT part of this schema — they come
 * from the already-approved brief and stay fixed across regenerations
 * (see long-form-content.service.ts's buildPrompt), so the saved Content
 * row's title can never drift from what the brief promised, and so this
 * schema stays small and simple rather than risking the same "compiled
 * grammar too large" provider error seo-audit.schema.ts's comment
 * documents for a more heavily nested schema.
 */
/**
 * The CANONICAL long-form output shape — a superset of whatever a single
 * generation request actually asked for, same reasoning as
 * content-brief.schema.ts's contentBriefOutputSchema. `conclusion`/`faq`
 * were unconditional through Phase 20; Phase 21 gates both behind the same
 * `sections` toggles the brief uses, so both are optional/defaulted here.
 * The actual per-request schema is narrower — see
 * long-form-output-builder.ts's buildLongFormOutputSchema.
 */
export const longFormContentOutputSchema = zv4.object({
  introduction: zv4.string(),
  sections: zv4.array(
    zv4.object({
      heading: zv4.string(),
      body: zv4.string(),
    })
  ),
  conclusion: zv4.string().optional(),
  faq: zv4.array(faqItemSchema).default([]),
  keyTakeaways: zv4.array(zv4.string()).default([]),
  imagePlaceholders: zv4.array(zv4.string()).default([]),
  altTextSuggestions: zv4.array(zv4.string()).default([]),
  featuredImagePrompt: zv4.string().optional(),
  socialSnippets: zv4.array(zv4.string()).default([]),
  excerpt: zv4.string().optional(),
  /** Informational for the human reviewer only — never written into the saved body (see formatLongFormContentAsMarkdown). */
  internalLinkPlacementSuggestions: zv4.array(zv4.string()),
});

export type LongFormContentOutput = zv4.infer<typeof longFormContentOutputSchema>;

/**
 * User-supplied CTA fields, rendered deterministically by our own code —
 * never handed to the model to paraphrase. See contentBriefCtaSchema.
 */
export type LongFormCta = {
  title?: string;
  text?: string;
  buttonText?: string;
  url?: string;
  phone?: string;
  email?: string;
};

function formatCtaBlock(cta: LongFormCta): string | null {
  const lines: string[] = [];
  if (cta.title) lines.push(`### ${cta.title}`);
  if (cta.text) lines.push(cta.text);
  if (cta.buttonText && cta.url) lines.push(`[${cta.buttonText}](${cta.url})`);
  else if (cta.buttonText) lines.push(`**${cta.buttonText}**`);
  if (cta.phone) lines.push(`Call: ${cta.phone}`);
  if (cta.email) lines.push(`Email: ${cta.email}`);
  return lines.length > 0 ? lines.join("\n\n") : null;
}

/**
 * Flattens the structured AI output into one Markdown string — the only
 * representation ever persisted to Content.body. The structured object
 * itself lives only in memory during generation/review; storage stays a
 * single plain-text column with no new editor dependency. When `cta` is
 * provided, its literal user-supplied fields are appended verbatim — the
 * model never writes this text itself.
 */
export function formatLongFormContentAsMarkdown(article: LongFormContentOutput, cta?: LongFormCta): string {
  const parts: string[] = [article.introduction];

  for (const section of article.sections) {
    parts.push(`## ${section.heading}\n\n${section.body}`);
  }

  if (article.keyTakeaways.length > 0) {
    parts.push(`## Key Takeaways\n\n${article.keyTakeaways.map((item) => `- ${item}`).join("\n")}`);
  }

  if (article.conclusion) {
    parts.push(`## Conclusion\n\n${article.conclusion}`);
  }

  if (article.faq.length > 0) {
    const faqBody = article.faq.map((item) => `**${item.question}**\n\n${item.answer}`).join("\n\n");
    parts.push(`## FAQ\n\n${faqBody}`);
  }

  if (cta) {
    const ctaBlock = formatCtaBlock(cta);
    if (ctaBlock) parts.push(ctaBlock);
  }

  return parts.join("\n\n");
}
