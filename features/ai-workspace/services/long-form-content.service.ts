import { generateStructuredOutput } from "@/lib/ai/structured-output";
import type { ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import { longFormContentOutputSchema, type LongFormContentOutput } from "@/features/ai-workspace/schemas/long-form-content.schema";

/**
 * Bumped whenever the prompt template below changes — own, independent
 * version from content-brief.service.ts's PROMPT_VERSION, same convention
 * as every existing AI task in this app keeping its own counter.
 */
export const PROMPT_VERSION = 1;

const LONG_FORM_SYSTEM_PROMPT =
  "You are a senior SEO content writer producing a DRAFT article for internal human review before anything is published. Never invent statistics, prices, dates, named clients, testimonials, certifications, or services/locations not present in the supplied context. Integrate the target keyword naturally — do not keyword-stuff. This is a draft; a human will fact-check it before it is ever published.";

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
};

/**
 * ctx.brief's fields are raw, user-editable text (edited in
 * ContentBriefReview.tsx before this ever runs) interpolated directly
 * below. Accepted risk, not an oversight — same rationale as
 * content-brief.service.ts's buildPrompt: nothing generated from it is
 * ever persisted without an explicit human review + Save, and the system
 * prompt above already instructs the model not to invent facts.
 */
function buildPrompt(ctx: LongFormContentContext): string {
  const keywordLine = ctx.keyword
    ? `Target keyword: "${ctx.keyword.term}"${ctx.keyword.intent ? ` (tracked search intent: ${ctx.keyword.intent})` : ""}`
    : "No specific tracked keyword was selected — follow the brief's suggested search intent below.";

  return `Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})
${keywordLine}

This article's APPROVED BRIEF (already reviewed and approved by a human — follow it, do not deviate from its scope):
- Title: ${ctx.brief.title}
- Outline: ${ctx.brief.outline.join(" | ") || "(none)"}
- Suggested headings: ${ctx.brief.suggestedHeadings.join(" | ") || "(none)"}
- Internal-link suggestions: ${ctx.brief.internalLinkSuggestions.join(" | ") || "(none)"}
- SEO recommendations to apply: ${ctx.brief.seoRecommendations.join(" | ") || "(none)"}
- GEO/AEO notes: ${ctx.brief.geoAeoNotes}
- Suggested search intent: ${ctx.brief.suggestedSearchIntent}

Using ONLY the information above, write a complete draft article of roughly 900-1500 words:
1. An introduction that hooks the reader and states what the article covers.
2. 3-6 H2 sections following the brief's outline, each with substantive paragraphs (and a bulleted/numbered list where genuinely appropriate).
3. A conclusion that reinforces the target keyword's intent and prompts action.
4. A FAQ section ONLY if the brief/topic genuinely supports real, distinct questions a searcher would ask — otherwise return null for faq. Never pad with generic filler questions just to have some.
5. A list of internal-link placement suggestions: where in THIS article the brief's internal-link suggestions could naturally go (describe in words — do not invent URLs that don't exist).

Do not restate the brief verbatim — write real prose. Do not add facts, numbers, dates, or claims that aren't already in the context above.`;
}

/**
 * Mirrors content-brief.service.ts's pattern exactly: a thin prompt-builder
 * around the shared generateStructuredOutput orchestrator. No changes to
 * lib/ai/providers/* — still a single schema-validated JSON call, just
 * with a long-form-shaped schema instead of a brief-shaped one.
 */
export async function generateLongFormContent(ctx: LongFormContentContext): Promise<LongFormContentOutput> {
  return generateStructuredOutput(longFormContentOutputSchema, {
    system: LONG_FORM_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx),
    maxTokens: 4000,
    taskType: "CONTENT_DRAFT",
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  });
}
