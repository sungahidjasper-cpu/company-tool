import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import type { ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import { DEFAULT_CONTENT_BRIEF_SETTINGS, type ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { buildLongFormOutputSchema } from "@/features/ai-workspace/schemas/long-form-output-builder";
import { longFormContentOutputSchema, type LongFormContentOutput } from "@/features/ai-workspace/schemas/long-form-content.schema";
import { filterReservedSections, stripConfigurationArtifacts } from "@/features/ai-workspace/services/content-sanitizer";

/**
 * Bumped whenever the prompt template below changes — own, independent
 * version from content-brief.service.ts's PROMPT_VERSION, same convention
 * as every existing AI task in this app keeping its own counter.
 */
export const PROMPT_VERSION = 6;

const LONG_FORM_SYSTEM_PROMPT =
  "You are a senior SEO content writer producing a DRAFT article for internal human review before anything is published. Never invent statistics, prices, dates, named clients, testimonials, certifications, or services/locations not present in the supplied context. Never state a specific market statistic, percentage, financial figure, or industry data point (e.g. typical unit sizes, utilization rates, market share) unless it is present in the supplied context — describe such things qualitatively instead of inventing a number. Never characterize a specific real company or brand name as a generic category, product type, or common noun — if a real company name appears in the supplied context, refer to it accurately as a company/provider, not as a type of product or service. Never invent a URL, citation, or source you cannot verify. Integrate the target keyword naturally — do not keyword-stuff. This is a draft; a human will fact-check it before it is ever published.";

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

  // A weak/small fallback model reliably under-writes against a bare
  // "approximately N words" instruction with nothing anchoring it — the
  // per-section budget below is what actually connects the total target to
  // how much the model should write for each outline section.
  const outlineSectionCount = ctx.brief.outline.length || settings.outline.h2Count || 5;
  const perSectionWords = Math.round(settings.wordCount / outlineSectionCount);
  const lowWords = Math.round(settings.wordCount * 0.93);
  const highWords = Math.round(settings.wordCount * 1.07);

  const requirements = [
    "1. An introduction that hooks the reader and states what the article covers.",
    `2. ${outlineSectionCount} H2 sections following the brief's outline, in order, each with MULTIPLE substantive paragraphs (not a single short paragraph) — and a bulleted/numbered list where genuinely appropriate. Each section must contribute distinct information not covered elsewhere in the article — a concrete example, a specific process or step, a decision-making criterion, or a named consideration. Do not repeat the same general claim or benefit across multiple sections. If a section covers more than one sub-topic, organize it with \`###\`-style sub-headers within that section's body text.`,
    `3. This list of sections must contain ONLY ordinary content sections — never your own "Conclusion", "FAQ", "Key Takeaways", "Resources", or any other summary/structural section. Those are separate, dedicated fields this schema already provides elsewhere; do not duplicate them here.`,
    "4. Internal-link placement suggestions: for each of the brief's internal-link suggestions, provide the recommended anchor text, a target page description, the reason it's relevant, and where in THIS article it should be placed (e.g. \"in the introduction\", \"after the second section\") — describe pages in words, never invent URLs that don't exist.",
  ];
  if (settings.sections.conclusion)
    requirements.push(
      "5. A conclusion that synthesizes the specific points made earlier in this article (not a generic restatement of the topic) and reinforces the target keyword's intent — when a call-to-action is configured, end with a natural transition toward taking action, without writing the CTA copy itself."
    );
  if (settings.sections.faq)
    requirements.push(
      `6. A FAQ section of exactly ${settings.faqConfig.count} items, following the brief's FAQ suggestions — each answer must give a direct answer in the first sentence, then one to two sentences of concise explanation; never a one-word or single-phrase answer.`
    );
  if (settings.sections.keyTakeaways)
    requirements.push(
      "7. A short list of key takeaways — each one a specific, decision-useful insight drawn from this article's actual content, not a statement generic enough to apply to any article on this topic."
    );
  if (settings.draftOptions.imagePlaceholders) requirements.push("8. A list of image placeholder descriptions (where an image should go and what it should show).");
  if (settings.draftOptions.altTextSuggestions) requirements.push("9. Suggested alt text for each image placeholder.");
  if (settings.draftOptions.featuredImagePrompt) requirements.push("10. A single descriptive prompt suitable for generating a featured image for this article.");
  if (settings.draftOptions.socialSnippets) requirements.push("11. Two or three short social-media post snippets promoting this article.");
  if (settings.draftOptions.excerpt) requirements.push("12. A one-to-two sentence excerpt/summary suitable for a blog listing page.");

  return `Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})
${keywordLine}

This article's APPROVED BRIEF (already reviewed and approved by a human — follow it, do not deviate from its scope):
- Title: ${ctx.brief.title}
- Outline: ${ctx.brief.outline.join(" | ") || "(none)"}
- Suggested headings: ${ctx.brief.suggestedHeadings.join(" | ") || "(none)"}
- SEO recommendations to apply: ${ctx.brief.seoRecommendations.join(" | ") || "(none)"}
- GEO/AEO notes: ${ctx.brief.geoAeoNotes}
- Suggested search intent: ${ctx.brief.suggestedSearchIntent}

This article should be approximately ${settings.wordCount} words in total — a range of roughly ${lowWords}-${highWords} words is fine. The outline above has ${outlineSectionCount} sections; write roughly ${perSectionWords} words (multiple full paragraphs, not one short paragraph) for each section so the complete article reasonably reaches the target. Falling far short of the target (for example, writing half of it) is not acceptable. Do not, however, pad with repetition, generic restatements, or filler sentences just to hit the number — add genuine depth instead: more specific detail, more practical explanation, more concrete examples per section.
Reading level: ${settings.readingLevel.toLowerCase().replace("_", " ")}. Brand voice/tone: ${settings.brandVoice.toLowerCase().replace(/_/g, " ")}.
${settings.sections.cta ? "A call-to-action belongs near the end of this piece. Do NOT write the CTA copy, button text, phone number, or URL yourself — it will be inserted separately from the requester's own literal, pre-approved text. Only account for its presence when structuring the article." : ""}

Using ONLY the information above, write a complete draft article with:
${requirements.join("\n")}

Do not restate the brief verbatim — write real prose. Do not add facts, numbers, dates, or claims that aren't already in the context above. Never include internal instructions, configuration labels, word-count targets, or any other generation parameter as literal text anywhere in the headings or body — these values guide you but must never appear as visible content.`;
}

/**
 * Mirrors content-brief.service.ts's pattern exactly: a thin prompt-builder
 * around the shared generateStructuredOutput orchestrator. No changes to
 * lib/ai/providers/* — still a single schema-validated JSON call, just
 * with a dynamically-narrowed, settings-driven schema instead of a fixed
 * one.
 */
export async function generateLongFormContent(ctx: LongFormContentContext, onChunk?: (event: StreamEvent) => void): Promise<LongFormContentOutput> {
  const settings = ctx.settings ?? DEFAULT_CONTENT_BRIEF_SETTINGS;
  const schema = buildLongFormOutputSchema(settings.sections, settings.draftOptions);
  const options = {
    system: LONG_FORM_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx),
    maxTokens: 4000,
    taskType: "CONTENT_DRAFT" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  // Phase 22 — onChunk present means the caller (the job runner, when
  // AI_STREAMING_ENABLED) wants live progress; generateStructuredOutput
  // itself is never touched, this just picks which orchestrator to call.
  const result = onChunk ? await generateStructuredOutputStreaming(schema, options, onChunk) : await generateStructuredOutput(schema, options);
  // Reparse through the canonical schema so every disabled-section field
  // gets its default rather than being undefined at runtime — see
  // content-brief.service.ts's identical comment.
  const parsed = longFormContentOutputSchema.parse(result);
  // Deterministic cleanup for the classes of defect a prompt instruction
  // alone can't guarantee against — see content-sanitizer.ts. Headings are
  // cleaned BEFORE the reserved-section filter runs, so a leaked "1.
  // Conclusion" numbering artifact still normalizes to "conclusion" and
  // gets filtered, not left behind as a stray duplicate.
  const cleanedSections = parsed.sections.map((section) => ({ ...section, heading: stripConfigurationArtifacts(section.heading) }));
  return {
    ...parsed,
    introduction: stripConfigurationArtifacts(parsed.introduction),
    sections: filterReservedSections(cleanedSections),
    faq: parsed.faq.map((item) => ({ ...item, question: stripConfigurationArtifacts(item.question) })),
  };
}
