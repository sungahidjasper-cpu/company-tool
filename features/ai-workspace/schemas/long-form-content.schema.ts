import { z } from "zod";
import { z as zv4 } from "zod/v4";

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
export const longFormContentOutputSchema = zv4.object({
  introduction: zv4.string(),
  sections: zv4.array(
    zv4.object({
      heading: zv4.string(),
      body: zv4.string(),
    })
  ),
  conclusion: zv4.string(),
  /** Null when a FAQ section isn't a natural fit for this topic — the model decides this, not a fixed toggle. */
  faq: zv4
    .array(
      zv4.object({
        question: zv4.string(),
        answer: zv4.string(),
      })
    )
    .nullable(),
  /** Informational for the human reviewer only — never written into the saved body (see formatLongFormContentAsMarkdown). */
  internalLinkPlacementSuggestions: zv4.array(zv4.string()),
});

export type LongFormContentOutput = zv4.infer<typeof longFormContentOutputSchema>;

/**
 * Flattens the structured AI output into one Markdown string — the only
 * representation ever persisted to Content.body. The structured object
 * itself lives only in memory during generation/review; storage stays a
 * single plain-text column with no new editor dependency.
 */
export function formatLongFormContentAsMarkdown(article: LongFormContentOutput): string {
  const parts: string[] = [article.introduction];

  for (const section of article.sections) {
    parts.push(`## ${section.heading}\n\n${section.body}`);
  }

  parts.push(`## Conclusion\n\n${article.conclusion}`);

  if (article.faq && article.faq.length > 0) {
    const faqBody = article.faq.map((item) => `**${item.question}**\n\n${item.answer}`).join("\n\n");
    parts.push(`## FAQ\n\n${faqBody}`);
  }

  return parts.join("\n\n");
}
