import type { BrandProfile } from "@/lib/generated/prisma/client";
import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import {
  SOCIAL_SNIPPET_CHARACTER_LIMITS,
  SOCIAL_SNIPPET_PLATFORMS,
  socialSnippetProviderOutputSchema,
  type SocialSnippet,
  type SocialSnippetPlatform,
} from "@/features/ai-workspace/schemas/social-snippet-generator.schema";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";

/** Bumped whenever the prompt template below changes — same convention as internal-link-analyzer.service.ts's PROMPT_VERSION. */
export const PROMPT_VERSION = 1;

/** Matches internal-link-analyzer.service.ts's own scale for a short, multi-item structured response. */
const MAX_OUTPUT_TOKENS = 2000;

/** Source content body excerpt cap — same rationale and same value as internal-link-analyzer.service.ts's SOURCE_BODY_EXCERPT_CHARS: enough to judge faithful promotional content without blowing out the prompt's context budget. */
const SOURCE_BODY_EXCERPT_CHARS = 2000;

const PLATFORM_LABELS: Record<SocialSnippetPlatform, string> = {
  X: "X (formerly Twitter)",
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
};

export const SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are a social media copywriter creating short promotional posts about a specific, already-published piece of content. The supplied source content is the ONLY source of truth for what this post may claim — every fact, claim, or detail in a snippet must be directly supported by the supplied source content. Never invent a statistic, quote, testimonial, review, endorsement, product, service, person, organization, date, price, award, or certification that is not present in the supplied source content. Never make an exaggerated or unsupported claim. If a URL is included in a snippet, it must be exactly the supplied source content's own URL — never invent or guess a URL. Respect each requested platform's character limit exactly, and write comfortably below the hard limit where possible rather than right up against it. When brand context is supplied, use it only to shape tone, audience framing, language, and brand identity — brand context must never introduce a fact that is not present in the supplied source content. Return fewer snippets than requested, or zero, if the source content does not genuinely support a good snippet for a given platform. Zero or fewer recommendations is acceptable. Never guess to fill the requested number. Before finalizing your response, perform a final factual check on every snippet: if any claim cannot be traced back to the supplied source content, remove or rewrite that snippet rather than guessing.`;

export type SocialSnippetGeneratorContext = {
  /** Provenance for the AiUsageLog row. */
  seoProjectId: string;
  /** Phase 19 — required for enforceCompanyAiLimits. */
  companyId: string;
  seoProjectName: string;
  domain: string;
  /** The content being promoted — every snippet must be faithful to this. */
  sourceContent: { title: string; url: string | null; metaDescription: string | null; body: string | null };
  platforms: SocialSnippetPlatform[];
  notes?: string;
};

/**
 * Mirrors internal-link-analyzer.service.ts's one-function-per-task
 * pattern: a thin prompt-builder around the shared generateStructuredOutput
 * orchestrator. No changes to lib/ai/providers/*.
 */
export function buildPrompt(ctx: SocialSnippetGeneratorContext, brandProfile?: BrandProfile | null): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  lines.push(`Content to promote: "${ctx.sourceContent.title}"${ctx.sourceContent.url ? ` (${ctx.sourceContent.url})` : ""}`);
  if (ctx.sourceContent.metaDescription) lines.push(`Content description: ${ctx.sourceContent.metaDescription}`);
  if (ctx.sourceContent.body) {
    const excerpt = ctx.sourceContent.body.length > SOURCE_BODY_EXCERPT_CHARS ? `${ctx.sourceContent.body.slice(0, SOURCE_BODY_EXCERPT_CHARS)}...` : ctx.sourceContent.body;
    lines.push(`Content excerpt:\n${excerpt}`);
  }
  if (!ctx.sourceContent.url) lines.push("This content has no published URL yet — do not include a link in any snippet.");

  // Brand Profile is supplementary tone/audience context only — deliberately
  // omits productsServices (see the STEP 17 discovery report §5: a snippet
  // promotes THIS specific article, not the general product line, and
  // including it risks pulling the snippet off-topic from the source content).
  if (brandProfile?.brandName) lines.push(`Brand name: ${brandProfile.brandName}.`);
  if (brandProfile?.brandVoice) lines.push(`Brand voice: ${brandProfile.brandVoice}.`);
  if (brandProfile?.targetAudience) lines.push(`Target audience: ${brandProfile.targetAudience}.`);
  if (brandProfile?.targetCountry) lines.push(`Target country/market: ${brandProfile.targetCountry}.`);
  if (brandProfile?.language) lines.push(`Write in this language: ${brandProfile.language}.`);

  if (ctx.notes) lines.push(`Additional user instructions (must not override source-content truth, character limits, or safety rules above): ${ctx.notes}`);

  lines.push("\nGenerate one short promotional snippet for EACH of the following platforms:");
  for (const platform of ctx.platforms) {
    const limit = SOCIAL_SNIPPET_CHARACTER_LIMITS[platform];
    lines.push(`- ${PLATFORM_LABELS[platform]}: platform value "${platform}", ${limit ? `must stay under ${limit} characters` : "no strict character limit, but keep it a short, scannable social post"}.`);
  }

  return `${lines.join("\n")}

For each platform above, return an object with:
1. platform: the exact platform value shown above (e.g. "${ctx.platforms[0]}").
2. text: the snippet text itself, ready to post as-is.

Skip a platform entirely (return fewer snippets) if the source content does not genuinely support a good post for it — do not force a weak snippet just to cover every platform.`;
}

/** Matches any http(s) URL-like substring in a snippet's text, for the fabricated-URL cross-check below. */
const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * Cross-checks every URL-like substring found in a snippet's text against
 * the ONE real URL this snippet is allowed to reference — the source
 * content's own, already-verified url. Discovered live: the system prompt's
 * instruction alone ("never invent a URL"; "do not include a link" when
 * there is no real URL) was NOT sufficient — a real generation against this
 * content's null url still fabricated a plausible-looking URL in every
 * snippet. This is the same class of gap internal-link-analyzer.service.ts's
 * filterValidRecommendations already closed for target-page URLs: a prompt
 * instruction is advisory, so the guarantee has to be enforced
 * deterministically afterward, not just requested beforehand.
 */
function hasOnlyRealUrl(text: string, realUrl: string | null): boolean {
  const found = text.match(URL_PATTERN) ?? [];
  if (found.length === 0) return true;
  if (!realUrl) return false;
  return found.every((url) => url === realUrl || url.replace(/[.,;:!?)]+$/, "") === realUrl);
}

/**
 * Deterministic, per-item filter — the same "loose contract in, strict
 * filter out, reject never repair" principle as
 * internal-link-analyzer.service.ts's filterValidRecommendations, applied
 * here to platform validity, real computed character limits, and (see
 * hasOnlyRealUrl above) a fabricated-URL cross-check. The character count is
 * ALWAYS computed here from the actual text.length — a model-reported
 * count, if one were ever present on the loose provider schema, would never
 * be trusted (which is exactly why socialSnippetProviderOutputSchema has no
 * characterCount field at all). Never truncates or rewrites text to fit a
 * limit or to strip a bad URL — a violating snippet is dropped outright,
 * never repaired.
 */
export function filterValidSnippets(rawSnippets: unknown[], sourceUrl: string | null = null): SocialSnippet[] {
  const results: SocialSnippet[] = [];
  // Tracks which platforms have already produced an accepted snippet —
  // the same "keep the first, drop subsequent duplicates" principle
  // meta-tag-optimizer.service.ts's own filterValidSuggestions already
  // established for duplicate contentIds. Checked AFTER every other
  // validation step (normalization, URL safety, length), so a duplicate
  // is only ever recognized among snippets that already passed every
  // other rule — an invalid duplicate never "uses up" a platform slot
  // that a later, valid snippet for that same platform could have filled.
  const usedPlatforms = new Set<SocialSnippetPlatform>();
  for (const raw of rawSnippets) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.platform !== "string" || typeof item.text !== "string") continue;
    if (!item.text.trim()) continue;

    // Safe, deterministic normalization only — case/whitespace and one
    // well-known synonym ("TWITTER" -> "X", matching this platform's own
    // dual naming), never a fuzzy or guessed mapping. A value like
    // "X (Twitter)" is NOT normalized here — it doesn't match any of
    // these exact rules, so it's rejected by the membership check below,
    // same as any other unrecognized platform string.
    let normalizedPlatform = item.platform.trim().toUpperCase();
    if (normalizedPlatform === "TWITTER") normalizedPlatform = "X";
    if (!SOCIAL_SNIPPET_PLATFORMS.includes(normalizedPlatform as SocialSnippetPlatform)) continue;
    const platform = normalizedPlatform as SocialSnippetPlatform;

    if (!hasOnlyRealUrl(item.text, sourceUrl)) continue;

    const characterCount = item.text.length;
    const limit = SOCIAL_SNIPPET_CHARACTER_LIMITS[platform];
    if (limit !== null && characterCount > limit) continue;

    // A second valid snippet for a platform already accepted is a
    // duplicate — deterministically keep only the first, since there is
    // no basis in the data to prefer a later one over an earlier one.
    if (usedPlatforms.has(platform)) continue;

    usedPlatforms.add(platform);
    results.push({ platform, text: item.text, characterCount });
  }
  return results;
}

/**
 * Deliberately does not consume Knowledge Source context — this tool is
 * intentionally grounded in one real Content row, not external authoritative
 * sources (see the STEP 17 discovery report §6). Brand Profile IS consumed,
 * supplementary to (never a substitute for) the source content, which alone
 * determines what facts a snippet may state.
 */
export async function generateSocialSnippets(ctx: SocialSnippetGeneratorContext, onChunk?: (event: StreamEvent) => void): Promise<SocialSnippet[]> {
  // Fetched here, not in the job runner or the action layer — same
  // service-internal-fetch precedent as every other AI Workspace tool.
  // ctx.companyId is already trusted (derived from the authenticated actor
  // at job-creation time).
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);
  const options = {
    system: SOCIAL_SNIPPET_GENERATOR_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, brandProfile),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "SOCIAL_SNIPPET_GENERATION" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(socialSnippetProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(socialSnippetProviderOutputSchema, options);
  const parsed = socialSnippetProviderOutputSchema.parse(result);
  return filterValidSnippets(parsed.snippets, ctx.sourceContent.url);
}
