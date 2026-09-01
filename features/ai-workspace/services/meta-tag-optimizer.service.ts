import type { BrandProfile } from "@/lib/generated/prisma/client";
import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import {
  META_DESCRIPTION_GUIDANCE,
  META_TITLE_GUIDANCE,
  metaTagOptimizerProviderOutputSchema,
  type LengthGuidance,
  type MetaTagSuggestion,
} from "@/features/ai-workspace/schemas/meta-tag-optimizer.schema";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { looksLikeInstructionEcho, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";

/** Bumped whenever the prompt template below changes — same convention as every other AI Workspace service's PROMPT_VERSION. */
export const PROMPT_VERSION = 1;

/**
 * Matches internal-link-analyzer.service.ts's own scale for a multi-item
 * structured response. A full 50-item batch (this tool's own
 * MAX_SELECTED_CONTENT cap) could in principle need more, but no other AI
 * Workspace tool scales its token budget by request size either — noted
 * here as a known, honest limitation rather than solved silently.
 */
const MAX_OUTPUT_TOKENS = 4000;

/**
 * A server-authorized inventory entry — built by the caller (the future
 * generation action/dispatcher, in a later stage) from real, already
 * ownership-verified Content rows. This is the ONLY source of truth for
 * which contentId values are legal — see filterValidSuggestions, which
 * rejects any AI-supplied contentId not present in this exact list.
 */
export type MetaTagInventoryItem = {
  contentId: string;
  title: string;
  url: string | null;
  currentMetaTitle: string | null;
  currentMetaDescription: string | null;
};

export type MetaTagOptimizerContext = {
  /** Provenance for the AiUsageLog row, once a later stage wires the actual provider call. */
  seoProjectId: string;
  companyId: string;
  seoProjectName: string;
  domain: string;
  /** The exact set of pages this request may optimize — nothing outside this list is a legal suggestion target. */
  inventory: MetaTagInventoryItem[];
};

export const META_TAG_OPTIMIZER_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are an SEO specialist improving meta titles and meta descriptions for existing, already-published pages. The supplied list of pages — each with its real id, title, url, and current metadata — is the ONLY source of truth for what to optimize. Never invent a different page, never invent a url, and never invent a contentId that is not in the supplied list. For each page, write ONE improved meta title and ONE improved meta description that stays true to that page's actual, existing topic — never suggest metadata that describes a different subject than the page already covers. Write for a real person deciding whether to click a search result, not a keyword list: avoid keyword stuffing, avoid vague or generic phrasing, and never repeat the same phrase across multiple suggestions just to fill space. Never state a fact, statistic, offer, or claim that isn't already supported by the page's own title or current metadata. Never include instruction text, configuration labels, or a character count as part of the visible title or description. Return exactly one suggestion object per supplied page, using its exact contentId, and nothing else.`;

/**
 * Mirrors every other AI Workspace service's one-function-per-task pattern:
 * a thin prompt-builder around the shared generation context. No changes
 * to lib/ai/providers/*.
 */
export function buildPrompt(ctx: MetaTagOptimizerContext, brandProfile?: BrandProfile | null): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  lines.push(
    `\nGuidance (not a hard limit): aim for a meta title of roughly ${META_TITLE_GUIDANCE.min}-${META_TITLE_GUIDANCE.max} characters and a meta description of roughly ${META_DESCRIPTION_GUIDANCE.min}-${META_DESCRIPTION_GUIDANCE.max} characters.`
  );

  // Brand Profile is supplementary tone/audience context only — deliberately
  // omits productsServices, same reasoning as social-snippet-generator.service.ts:
  // a page's own metadata should stay about THAT page, not the general
  // product line.
  if (brandProfile?.brandName) lines.push(`Brand name: ${brandProfile.brandName}.`);
  if (brandProfile?.brandVoice) lines.push(`Brand voice: ${brandProfile.brandVoice}.`);
  if (brandProfile?.targetAudience) lines.push(`Target audience: ${brandProfile.targetAudience}.`);
  if (brandProfile?.targetCountry) lines.push(`Target country/market: ${brandProfile.targetCountry}.`);
  if (brandProfile?.language) lines.push(`Write in this language: ${brandProfile.language}.`);

  lines.push("\nPages to optimize (this is the complete, exact list — do not add, remove, or substitute a page):");
  for (const item of ctx.inventory) {
    lines.push(
      `- contentId: ${item.contentId} | title: "${item.title}"${item.url ? ` | url: ${item.url}` : " | url: (none set)"} | current meta title: ${item.currentMetaTitle ? `"${item.currentMetaTitle}"` : "(none set)"} | current meta description: ${item.currentMetaDescription ? `"${item.currentMetaDescription}"` : "(none set)"}`
    );
  }

  return `${lines.join("\n")}

For each page listed above, return an object with:
1. contentId: the EXACT contentId string copied verbatim from the list above — never a title, never a paraphrase, never an id not in that list.
2. suggestedMetaTitle: the improved meta title.
3. suggestedMetaDescription: the improved meta description.
4. reasoning: one or two sentences explaining what specifically changed and why it's an improvement over the current metadata.

Never modify a page's url. Generate exactly one suggestion per listed page.`;
}

/** Computes a length-guidance readout, never a rejection — see filterValidSuggestions's own comment for why. */
function checkGuidanceLength(value: string, min: number, max: number): LengthGuidance {
  const length = value.length;
  const status: LengthGuidance["status"] = length < min ? "TOO_SHORT" : length > max ? "TOO_LONG" : "OK";
  return { length, min, max, status };
}

/**
 * Deterministic, per-item filter — the same "loose contract in, strict
 * filter out, reject never repair" principle as every other AI Workspace
 * tool's own filter function, applied here to contentId membership (never
 * trusting an AI-supplied id, never expanding the caller's own inventory),
 * duplicate detection, and instruction-echo detection. Deliberately does
 * NOT reject a suggestion merely for falling outside the 50-60/120-160
 * advisory guidance — those are recommendations this app already states
 * elsewhere (features/seo/services/seo-issue-detection.service.ts:71,94),
 * not a hard platform limit the way a social-platform character cap is;
 * the computed titleLengthGuidance/descriptionLengthGuidance fields exist
 * so a caller/UI can flag this without the service silently discarding an
 * otherwise-good suggestion over a soft, common, easily-visible guideline.
 *
 * stripHtmlTags/stripConfigurationArtifacts are applied BEFORE the
 * emptiness and instruction-echo checks, matching the exact order
 * content-brief.service.ts already established for these same two
 * sanitizers — this is surgical removal of known-junk substrings (a stray
 * HTML tag, a leaked "| 1500 words" suffix), never a rewrite of real
 * content, so it carries no risk of masking a genuinely malformed
 * suggestion. Unlike content-brief.service.ts's own instruction-echo
 * handling (which substitutes a known-good fallback), this tool follows
 * the newer, stronger doctrine established by Schema Markup
 * Generator/Internal Link Analyzer/Social Snippet Generator: an
 * instruction-echoed suggestion is REJECTED outright, never repaired or
 * replaced with a substitute value.
 */
export function filterValidSuggestions(rawSuggestions: unknown[], inventory: MetaTagInventoryItem[]): MetaTagSuggestion[] {
  const inventoryById = new Map(inventory.map((item) => [item.contentId, item]));
  const usedContentIds = new Set<string>();
  const results: MetaTagSuggestion[] = [];

  for (const raw of rawSuggestions) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.contentId !== "string" || typeof item.suggestedMetaTitle !== "string" || typeof item.suggestedMetaDescription !== "string") continue;
    if (typeof item.reasoning !== "string" || !item.reasoning.trim()) continue;

    // Never trust an AI-supplied contentId — it must be an exact match
    // against the server-authorized inventory this function was given.
    // The AI can never expand this set; an id outside it is dropped, never
    // substituted with the "closest" real id.
    const inventoryItem = inventoryById.get(item.contentId);
    if (!inventoryItem) continue;

    // A second suggestion for a contentId already accepted is a duplicate
    // — deterministically keep only the first one seen, since there is no
    // basis in the data to prefer a later one over an earlier one.
    if (usedContentIds.has(item.contentId)) continue;

    const cleanedTitle = stripHtmlTags(stripConfigurationArtifacts(item.suggestedMetaTitle));
    const cleanedDescription = stripHtmlTags(stripConfigurationArtifacts(item.suggestedMetaDescription));
    if (!cleanedTitle.trim() || !cleanedDescription.trim()) continue;
    if (looksLikeInstructionEcho(cleanedTitle) || looksLikeInstructionEcho(cleanedDescription)) continue;

    usedContentIds.add(item.contentId);
    results.push({
      contentId: item.contentId,
      url: inventoryItem.url,
      currentMetaTitle: inventoryItem.currentMetaTitle,
      suggestedMetaTitle: cleanedTitle,
      currentMetaDescription: inventoryItem.currentMetaDescription,
      suggestedMetaDescription: cleanedDescription,
      reasoning: item.reasoning.trim(),
      titleLengthGuidance: checkGuidanceLength(cleanedTitle, META_TITLE_GUIDANCE.min, META_TITLE_GUIDANCE.max),
      descriptionLengthGuidance: checkGuidanceLength(cleanedDescription, META_DESCRIPTION_GUIDANCE.min, META_DESCRIPTION_GUIDANCE.max),
    });
  }

  return results;
}

/**
 * Stage C addition — the wrapper Stage B's own comment deferred to this
 * exact stage, once the real META_TAG_OPTIMIZATION AiTaskType value exists.
 * Mirrors every other AI Workspace tool's generateXxx shape exactly:
 * service-internal Brand Profile fetch (ctx.companyId is already trusted,
 * derived from the authenticated actor at job-creation time), the shared
 * generateStructuredOutput/Streaming orchestrator (no new AI client, no
 * provider bypass), then the SAME filterValidSuggestions this file already
 * defined in Stage B — completely unmodified — applied to whatever the
 * provider returns. Deliberately does not consume Knowledge Source, per
 * the discovery report: this tool describes pages that already exist, with
 * nothing external to ground.
 */
export async function generateMetaTagSuggestions(ctx: MetaTagOptimizerContext, onChunk?: (event: StreamEvent) => void): Promise<MetaTagSuggestion[]> {
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);
  const options = {
    system: META_TAG_OPTIMIZER_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, brandProfile),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "META_TAG_OPTIMIZATION" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(metaTagOptimizerProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(metaTagOptimizerProviderOutputSchema, options);
  const parsed = metaTagOptimizerProviderOutputSchema.parse(result);
  return filterValidSuggestions(parsed.suggestions, ctx.inventory);
}
