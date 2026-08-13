import { generateStructuredOutput } from "@/lib/ai/structured-output";
import {
  contentBriefOutputSchema,
  type ContentBriefOutput,
  type ContentBriefType,
} from "@/features/ai-workspace/schemas/content-brief.schema";

/**
 * Bumped whenever the prompt template below changes — same convention as
 * seo-audit.service.ts's PROMPT_VERSION, though nothing currently caches
 * or reuses a prior CONTENT_BRIEF result by this value (no crawl-hash
 * equivalent exists for this task; every "Generate"/"Regenerate" click is
 * a fresh call).
 */
export const PROMPT_VERSION = 1;

const CONTENT_BRIEF_SYSTEM_PROMPT =
  "You are a senior SEO content strategist. Produce a practical, concrete content brief grounded strictly in the provided project/keyword context. Never invent products, services, or facts not evidenced in the input. This is a BRIEF — outlines, headings, and suggestions, not a full drafted article body.";

export type ContentBriefContext = {
  /** Provenance for the AiUsageLog row — the project this brief is for. Never a WebsiteAnalysisJob, since this task has none. */
  seoProjectId: string;
  seoProjectName: string;
  domain: string;
  contentType: ContentBriefType;
  /** Null when the user generates from an ad-hoc topic (via notes) rather than an existing tracked keyword. */
  keyword: { term: string; intent: string | null } | null;
  notes?: string;
};

function buildPrompt(ctx: ContentBriefContext): string {
  const keywordLine = ctx.keyword
    ? `Target keyword: "${ctx.keyword.term}"${ctx.keyword.intent ? ` (tracked search intent: ${ctx.keyword.intent})` : ""}`
    : "No specific tracked keyword was selected — infer a sensible topic and target keyword from the notes below.";

  return `Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})
Content type: ${ctx.contentType}
${keywordLine}
${ctx.notes ? `Additional context/notes from the requester: ${ctx.notes}` : "No additional notes were provided."}

Using ONLY the information above, produce a content brief with:
1. A working title.
2. A meta title (~60 characters) and meta description (~155 characters).
3. An outline (ordered list of section names).
4. A separate list of suggested subheadings within those sections.
5. Internal-link suggestions (described in words — do not invent URLs that don't exist).
6. A short list of SEO recommendations specific to this piece (not generic advice).
7. GEO/AEO notes: concrete suggestions for how this content could be structured to be cited by AI answer engines (e.g. direct Q&A framing, definitions, structured lists).
8. Your own suggested search intent for this piece (one of: informational, navigational, commercial, transactional), confirming or refining the tracked intent above if one was given.`;
}

/**
 * Mirrors seo-audit.service.ts's one-function-per-task pattern exactly:
 * a thin prompt-builder around the shared generateStructuredOutput
 * orchestrator. No changes to lib/ai/providers/* — this is still a
 * schema-validated JSON call like every existing AI task, just with a
 * brief-shaped schema instead of an audit-shaped one.
 */
export async function generateContentBrief(ctx: ContentBriefContext): Promise<ContentBriefOutput> {
  return generateStructuredOutput(contentBriefOutputSchema, {
    system: CONTENT_BRIEF_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx),
    maxTokens: 3000,
    taskType: "CONTENT_BRIEF",
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
  });
}
