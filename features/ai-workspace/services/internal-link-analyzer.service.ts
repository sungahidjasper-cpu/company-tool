import type { BrandProfile } from "@/lib/generated/prisma/client";
import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import { internalLinkSchema, type InternalLinkSuggestion } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import { internalLinkAnalysisProviderOutputSchema } from "@/features/ai-workspace/schemas/internal-link-analyzer.schema";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";

/** Bumped whenever the prompt template below changes — same convention as content-brief.service.ts's PROMPT_VERSION. */
export const PROMPT_VERSION = 1;

/** Matches content-brief.service.ts's own scale for a multi-item structured response. */
const MAX_OUTPUT_TOKENS = 3000;

/** Source-page body excerpt cap — a full long-form article's body could be large; a fixed excerpt is enough to judge contextual relevance without letting one very long article blow out the prompt's context budget. */
const SOURCE_BODY_EXCERPT_CHARS = 2000;

export const INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are a technical SEO specialist recommending internal-linking opportunities. The supplied list of existing pages is the ONLY source of truth for what pages exist on this site — you may recommend a link ONLY to a page in that exact supplied list, identified by its EXACT supplied url. Never invent a url, never invent a page title, never recommend a target page that is absent from the supplied list. Do not recommend a link merely because it would theoretically be useful for SEO — every recommendation must be contextually relevant to the actual supplied source page content. If there is no strong internal-linking opportunity, recommend fewer links or none at all — zero recommendations is a valid, honest answer. Anchor text must accurately describe the actual destination page (its supplied title), not a generic phrase. Never fabricate facts about any page beyond what its supplied title indicates. Never recommend an external competitor page, or any page not in the supplied list, as a link target — every recommendation is for an INTERNAL link within this same site only.`;

export type InternalLinkAnalyzerContext = {
  /** Provenance for the AiUsageLog row. */
  seoProjectId: string;
  /** Phase 19 — required for enforceCompanyAiLimits. */
  companyId: string;
  seoProjectName: string;
  domain: string;
  /** The page being analyzed — recommendations are links FROM this page. */
  sourceContent: { title: string; url: string | null; metaDescription: string | null; body: string | null };
  /** The project's other real, linkable pages — the only legal link targets. Excludes the source page itself. */
  inventory: { title: string; url: string }[];
};

/**
 * Mirrors schema-markup-generator.service.ts's one-function-per-task
 * pattern: a thin prompt-builder around the shared generateStructuredOutput
 * orchestrator. No changes to lib/ai/providers/*.
 */
export function buildPrompt(ctx: InternalLinkAnalyzerContext, brandProfile?: BrandProfile | null): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  lines.push(`Source page to analyze: "${ctx.sourceContent.title}"${ctx.sourceContent.url ? ` (${ctx.sourceContent.url})` : ""}`);
  if (ctx.sourceContent.metaDescription) lines.push(`Source page description: ${ctx.sourceContent.metaDescription}`);
  if (ctx.sourceContent.body) {
    const excerpt = ctx.sourceContent.body.length > SOURCE_BODY_EXCERPT_CHARS ? `${ctx.sourceContent.body.slice(0, SOURCE_BODY_EXCERPT_CHARS)}...` : ctx.sourceContent.body;
    lines.push(`Source page content excerpt:\n${excerpt}`);
  }

  if (brandProfile?.brandName) lines.push(`Brand name: ${brandProfile.brandName}.`);
  if (brandProfile?.productsServices) lines.push(`Products/services: ${brandProfile.productsServices}.`);

  lines.push("\nThe ONLY pages that exist on this site and may be recommended as link targets are:");
  if (ctx.inventory.length === 0) {
    lines.push("(No other pages exist in this project yet — there is nothing to link to.)");
  } else {
    for (const page of ctx.inventory) {
      lines.push(`- "${page.title}" (${page.url})`);
    }
  }

  return `${lines.join("\n")}

Using ONLY the source page content and the exact page list above, recommend up to 5 internal links FROM the source page TO one of the listed pages — fewer is fine, and zero is an acceptable answer if the source content doesn't genuinely call for a link to any listed page. For each one you DO include, provide:
1. anchorText: the exact link text, matching phrasing that would naturally appear in the source page's content.
2. targetPage: the EXACT url string of the target page, copied verbatim from the list above — never a title, never a paraphrase, never a url not in that list.
3. reason: one or two sentences pointing to the specific connection between the source page's content and the target page — not generic advice.
4. placement: where in the source page this link would naturally fit (e.g. "in the introduction", "near the paragraph discussing X").
5. priority: HIGH, MEDIUM, or LOW.

Before finalizing, re-check every recommendation: if the targetPage url is not character-for-character identical to one of the urls listed above, or if you cannot point to a specific reason from the source content, remove that recommendation rather than guessing.

Never include internal instructions or configuration labels as literal text anywhere in an anchorText or reason field.`;
}

/**
 * Deterministic, per-item filter — the same "loose contract in, strict
 * filter out" principle as schema-markup-generator.service.ts's
 * isValidJsonLd, applied here to cross-checking a recommendation's
 * targetPage against the actual supplied page inventory rather than to
 * JSON structural validity. Never repairs a fabricated url into a real
 * one — a recommendation whose targetPage isn't an exact match against a
 * real, supplied page is dropped outright, never coerced to the nearest
 * real page. Parses each item independently via the strict, reused
 * internalLinkSchema (which enforces the real priority enum) so one
 * malformed item never discards the rest of an otherwise-good response.
 */
export function filterValidRecommendations(rawRecommendations: unknown[], validTargetUrls: ReadonlySet<string>): InternalLinkSuggestion[] {
  const results: InternalLinkSuggestion[] = [];
  for (const raw of rawRecommendations) {
    const parsed = internalLinkSchema.safeParse(raw);
    if (!parsed.success) continue;
    const rec = parsed.data;
    if (!rec.anchorText.trim() || !rec.reason.trim() || !rec.placement.trim()) continue;
    if (!validTargetUrls.has(rec.targetPage)) continue;
    results.push(rec);
  }
  return results;
}

/**
 * Deliberately does not consume Knowledge Source context — this is a
 * structural/internal-content task grounded in the project's own real
 * Content records, not external authoritative sources. Brand Profile IS
 * consumed, supplementary to (never a substitute for) the real page
 * inventory, which alone determines valid link targets.
 */
export async function generateInternalLinkRecommendations(ctx: InternalLinkAnalyzerContext, onChunk?: (event: StreamEvent) => void): Promise<InternalLinkSuggestion[]> {
  // Fetched here, not in the job runner or the action layer — same
  // service-internal-fetch precedent as every other AI Workspace tool.
  // ctx.companyId is already trusted (derived from the authenticated actor
  // at job-creation time).
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);
  const options = {
    system: INTERNAL_LINK_ANALYZER_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, brandProfile),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "INTERNAL_LINK_ANALYSIS" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(internalLinkAnalysisProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(internalLinkAnalysisProviderOutputSchema, options);
  const parsed = internalLinkAnalysisProviderOutputSchema.parse(result);
  const validTargetUrls = new Set(ctx.inventory.map((page) => page.url));
  return filterValidRecommendations(parsed.recommendations, validTargetUrls);
}
