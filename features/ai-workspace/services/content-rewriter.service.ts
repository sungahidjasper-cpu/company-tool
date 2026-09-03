import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import { contentRewriterProviderOutputSchema, type ContentRewriteResult } from "@/features/ai-workspace/schemas/content-rewriter.schema";
import { CONTENT_QUALITY_DOCTRINE, SEO_METRIC_GROUNDING_GUARD } from "@/features/ai-workspace/services/content-quality-doctrine";
import { looksLikeInstructionEcho, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";

/** Bumped whenever the prompt template below changes — same convention as every other AI Workspace service's PROMPT_VERSION. */
export const PROMPT_VERSION = 2;

/** Matches every other AI Workspace service's own token ceiling (Long-Form Content uses the same 4000 even for a full article) — a known, shared, honest limitation, not scaled per request size by any tool in this app. */
const MAX_OUTPUT_TOKENS = 4000;

/**
 * A server-authorized snapshot of the ONE Content row being rewritten —
 * built by the caller (the generation action / job dispatcher) from a real,
 * already ownership-verified row, fetched fresh from the database. This is
 * the ONLY source of truth for what "current" means; the AI never supplies
 * or overrides any of these values.
 */
export type ContentRewriterContext = {
  contentId: string;
  companyId: string;
  seoProjectId: string;
  seoProjectName: string;
  domain: string;
  currentTitle: string;
  currentMetaTitle: string | null;
  currentMetaDescription: string | null;
  currentBody: string;
};

export const CONTENT_REWRITER_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are an SEO editor rewriting and improving ONE existing page that has already been written. The page's real, current title, meta title, meta description, and full body text are supplied below — this is the ONLY source of truth for what this page is about. Rewrite the title, meta title, meta description, and body to be clearer, more engaging, and more effective, while staying strictly grounded in the facts, claims, topics, and structure already present in the supplied current content — never invent a new fact, statistic, example, claim, product, service, credential, or detail that is not already stated in the current title, meta fields, or body. Preserve the page's actual subject and intent; never change what the page is fundamentally about. The rewritten body must remain valid Markdown, using the same general heading/paragraph/list conventions the current body already uses, and must never include instruction text, configuration labels, a character or word count, or a JSON wrapper as part of the visible text. If a field is already effective as written, return it unchanged rather than changing it just for the sake of change — an unnecessary change is not an improvement.

${SEO_METRIC_GROUNDING_GUARD}`;

/**
 * Mirrors every other AI Workspace service's one-function-per-task pattern:
 * a thin prompt-builder around the shared generation context. No changes to
 * lib/ai/providers/*. Deliberately does not consume Brand Profile or
 * Knowledge Source, per the discovery report's v1 scope: this tool
 * improves a page using only that page's own existing text, nothing else.
 */
export function buildPrompt(ctx: ContentRewriterContext): string {
  return `Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})

Current title: "${ctx.currentTitle}"
Current meta title: ${ctx.currentMetaTitle ? `"${ctx.currentMetaTitle}"` : "(none set)"}
Current meta description: ${ctx.currentMetaDescription ? `"${ctx.currentMetaDescription}"` : "(none set)"}
Current body:
---
${ctx.currentBody}
---

Return an object with:
1. rewrittenTitle: the improved page title.
2. rewrittenMetaTitle: the improved meta title.
3. rewrittenMetaDescription: the improved meta description.
4. rewrittenBody: the improved body, as valid Markdown.
5. reasoning: one or two sentences summarizing what was improved and why.

Rewrite all four fields grounded strictly in the current content above — never introduce a fact, claim, or topic that isn't already there.`;
}

/**
 * Deterministic, whole-result validation — the same "loose contract in,
 * strict filter out, reject never repair" principle every other AI
 * Workspace tool's own filter function follows, applied here to a single
 * result object instead of a list. Unlike a list-shaped tool (where one bad
 * item is simply dropped, leaving the rest), there is only one deliverable
 * here, so any field failing validation invalidates the whole rewrite —
 * returns null (a genuine, successful "no valid rewrite" outcome, not an
 * error) rather than a partially-valid result.
 *
 * stripHtmlTags is applied to the three short fields (title/metaTitle/
 * metaDescription) exactly like Meta Tag Optimizer already does, but
 * deliberately NOT to rewrittenBody: stripHtmlTags collapses all whitespace
 * to single spaces, which would destroy a multi-line Markdown body's
 * paragraph/list/heading structure. stripConfigurationArtifacts is safe for
 * the body regardless — its patterns are anchored to the very start/end of
 * the whole string (^/$ without the multiline flag), so it only ever trims
 * a leaked artifact at the true beginning or end of the body, never touches
 * a numbered list or heading elsewhere in the middle of the article.
 *
 * Also computes titleChanged/metaTitleChanged/metaDescriptionChanged/
 * bodyChanged — a deterministic string comparison against the real current
 * value, never trusting the AI's own `reasoning` text. A field being
 * unchanged is never a rejection reason — matching "do not reject a valid
 * rewrite merely because one field didn't change."
 *
 * Known, honest limitation (not solved here, consistent with how Content
 * Brief/Long-Form already treat body prose): a URL embedded inside the
 * rewritten body's own Markdown link syntax is not independently validated
 * against the real page. No existing AI Workspace tool validates URLs
 * embedded in free-form body prose either — only structured, dedicated URL
 * fields (e.g. Internal Link Analyzer's target pages) get that treatment.
 */
export function buildContentRewriteResult(raw: unknown, ctx: ContentRewriterContext): ContentRewriteResult | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (
    typeof item.rewrittenTitle !== "string" ||
    typeof item.rewrittenMetaTitle !== "string" ||
    typeof item.rewrittenMetaDescription !== "string" ||
    typeof item.rewrittenBody !== "string"
  ) {
    return null;
  }
  if (typeof item.reasoning !== "string" || !item.reasoning.trim()) return null;

  const cleanedTitle = stripHtmlTags(stripConfigurationArtifacts(item.rewrittenTitle));
  const cleanedMetaTitle = stripHtmlTags(stripConfigurationArtifacts(item.rewrittenMetaTitle));
  const cleanedMetaDescription = stripHtmlTags(stripConfigurationArtifacts(item.rewrittenMetaDescription));
  const cleanedBody = stripConfigurationArtifacts(item.rewrittenBody);

  if (!cleanedTitle.trim() || !cleanedMetaTitle.trim() || !cleanedMetaDescription.trim() || !cleanedBody.trim()) return null;
  if (
    looksLikeInstructionEcho(cleanedTitle) ||
    looksLikeInstructionEcho(cleanedMetaTitle) ||
    looksLikeInstructionEcho(cleanedMetaDescription) ||
    looksLikeInstructionEcho(cleanedBody)
  ) {
    return null;
  }

  return {
    contentId: ctx.contentId,
    currentTitle: ctx.currentTitle,
    rewrittenTitle: cleanedTitle,
    titleChanged: cleanedTitle !== ctx.currentTitle,
    currentMetaTitle: ctx.currentMetaTitle,
    rewrittenMetaTitle: cleanedMetaTitle,
    metaTitleChanged: cleanedMetaTitle !== ctx.currentMetaTitle,
    currentMetaDescription: ctx.currentMetaDescription,
    rewrittenMetaDescription: cleanedMetaDescription,
    metaDescriptionChanged: cleanedMetaDescription !== ctx.currentMetaDescription,
    currentBody: ctx.currentBody,
    rewrittenBody: cleanedBody,
    bodyChanged: cleanedBody !== ctx.currentBody,
    reasoning: item.reasoning.trim(),
  };
}

/**
 * The generation wrapper — mirrors every other AI Workspace tool's
 * generateXxx shape exactly: the shared generateStructuredOutput/Streaming
 * orchestrator (no new AI client, no provider bypass), then this file's own
 * buildContentRewriteResult applied to whatever the provider returns.
 * Generation only: never writes to Content, never creates a
 * ContentRevision — see content-rewriter.actions.ts (Stage C) and
 * content-revision.service.ts, neither touched by this function.
 */
export async function generateContentRewrite(ctx: ContentRewriterContext, onChunk?: (event: StreamEvent) => void): Promise<ContentRewriteResult | null> {
  const options = {
    system: CONTENT_REWRITER_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "CONTENT_REWRITE" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(contentRewriterProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(contentRewriterProviderOutputSchema, options);
  const parsed = contentRewriterProviderOutputSchema.parse(result);
  return buildContentRewriteResult(parsed, ctx);
}
