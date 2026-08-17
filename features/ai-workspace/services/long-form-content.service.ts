import { generateStructuredOutput } from "@/lib/ai/structured-output";
import type { ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import { DEFAULT_CONTENT_BRIEF_SETTINGS, type ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { buildLongFormOutputSchema } from "@/features/ai-workspace/schemas/long-form-output-builder";
import { longFormContentOutputSchema, type LongFormContentOutput } from "@/features/ai-workspace/schemas/long-form-content.schema";

/**
 * Bumped whenever the prompt template below changes — own, independent
 * version from content-brief.service.ts's PROMPT_VERSION, same convention
 * as every existing AI task in this app keeping its own counter.
 */
export const PROMPT_VERSION = 2;

const LONG_FORM_SYSTEM_PROMPT =
  "You are a senior SEO content writer producing a DRAFT article for internal human review before anything is published. Never invent statistics, prices, dates, named clients, testimonials, certifications, or services/locations not present in the supplied context. Never invent a URL, citation, or source you cannot verify. Integrate the target keyword naturally — do not keyword-stuff. This is a draft; a human will fact-check it before it is ever published.";

export type LongFormContentContext = {
  /** Provenance for the AiUsageLog row — never a WebsiteAnalysisJob, same as content-brief.service.ts. */
  seoProjectId: string;
  /** Phase 19 — required for enforceCompanyAiLimits. */
  companyId: string;
  seoProjectName: string;
  domain: string;
  /** The already-approved brief — from content-brief.service.ts, either still in memory or read back from a saved Content row's stored fields. */
  brief: ContentBriefOutput;
  keyword: { term: string; intent: string | null } | null;
  /** Phase 21 — the same settings object used to generate the brief; defaults reproduce Phase 20's fixed-shape 900-1500-word behavior. */
  settings?: ContentBriefSettings;
};

/**
 * ctx.brief's fields are raw, user-editable text (edited in
 * ContentBriefReview.tsx before this ever runs) interpolated directly
 * below. Accepted risk, not an oversight — same rationale as
 * content-brief.service.ts's buildPrompt: nothing generated from it is
 * ever persisted without an explicit human review + Save, and the system
 * prompt above already instructs the model not to invent facts.
 */
export function buildPrompt(ctx: LongFormContentContext): string {
  const settings = ctx.settings ?? DEFAULT_CONTENT_BRIEF_SETTINGS;
  const keywordLine = ctx.keyword
    ? `Target keyword: "${ctx.keyword.term}"${ctx.keyword.intent ? ` (tracked search intent: ${ctx.keyword.intent})` : ""}`
    : "No specific tracked keyword was selected — follow the brief's suggested search intent below.";

  const requirements = [
    "1. An introduction that hooks the reader and states what the article covers.",
    `2. H2 sections following the brief's outline, each with substantive paragraphs (and a bulleted/numbered list where genuinely appropriate).`,
    "3. A list of internal-link placement suggestions: where in THIS article the brief's internal-link suggestions could naturally go (describe in words — do not invent URLs that don't exist).",
  ];
  if (settings.sections.conclusion) requirements.push("4. A conclusion that reinforces the target keyword's intent and prompts action.");
  if (settings.sections.faq) requirements.push(`5. A FAQ section of exactly ${settings.faqConfig.count} items, following the brief's FAQ suggestions.`);
  if (settings.sections.keyTakeaways) requirements.push("6. A short list of key takeaways.");
  if (settings.draftOptions.imagePlaceholders) requirements.push("7. A list of image placeholder descriptions (where an image should go and what it should show).");
  if (settings.draftOptions.altTextSuggestions) requirements.push("8. Suggested alt text for each image placeholder.");
  if (settings.draftOptions.featuredImagePrompt) requirements.push("9. A single descriptive prompt suitable for generating a featured image for this article.");
  if (settings.draftOptions.socialSnippets) requirements.push("10. Two or three short social-media post snippets promoting this article.");
  if (settings.draftOptions.excerpt) requirements.push("11. A one-to-two sentence excerpt/summary suitable for a blog listing page.");

  return `Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})
${keywordLine}

This article's APPROVED BRIEF (already reviewed and approved by a human — follow it, do not deviate from its scope):
- Title: ${ctx.brief.title}
- Outline: ${ctx.brief.outline.join(" | ") || "(none)"}
- Suggested headings: ${ctx.brief.suggestedHeadings.join(" | ") || "(none)"}
- SEO recommendations to apply: ${ctx.brief.seoRecommendations.join(" | ") || "(none)"}
- GEO/AEO notes: ${ctx.brief.geoAeoNotes}
- Suggested search intent: ${ctx.brief.suggestedSearchIntent}

Target article length: approximately ${settings.wordCount} words (a soft target — do not pad or truncate artificially to hit it exactly).
Reading level: ${settings.readingLevel.toLowerCase().replace("_", " ")}. Brand voice/tone: ${settings.brandVoice.toLowerCase().replace(/_/g, " ")}.
${settings.sections.cta ? "A call-to-action belongs near the end of this piece. Do NOT write the CTA copy, button text, phone number, or URL yourself — it will be inserted separately from the requester's own literal, pre-approved text. Only account for its presence when structuring the article." : ""}

Using ONLY the information above, write a complete draft article with:
${requirements.join("\n")}

Do not restate the brief verbatim — write real prose. Do not add facts, numbers, dates, or claims that aren't already in the context above.`;
}

/**
 * Mirrors content-brief.service.ts's pattern exactly: a thin prompt-builder
 * around the shared generateStructuredOutput orchestrator. No changes to
 * lib/ai/providers/* — still a single schema-validated JSON call, just
 * with a dynamically-narrowed, settings-driven schema instead of a fixed
 * one.
 */
export async function generateLongFormContent(ctx: LongFormContentContext): Promise<LongFormContentOutput> {
  const settings = ctx.settings ?? DEFAULT_CONTENT_BRIEF_SETTINGS;
  const result = await generateStructuredOutput(buildLongFormOutputSchema(settings.sections, settings.draftOptions), {
    system: LONG_FORM_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx),
    maxTokens: 4000,
    taskType: "CONTENT_DRAFT",
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  });
  // Reparse through the canonical schema so every disabled-section field
  // gets its default rather than being undefined at runtime — see
  // content-brief.service.ts's identical comment.
  return longFormContentOutputSchema.parse(result);
}
