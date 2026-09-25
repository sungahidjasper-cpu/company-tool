import type { BrandProfile } from "@/lib/generated/prisma/client";
import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import { imageAltTextProviderOutputSchema, type ImageAltTextResult } from "@/features/ai-workspace/schemas/image-alt-text.schema";
import { CONTENT_QUALITY_DOCTRINE, SEO_METRIC_GROUNDING_GUARD } from "@/features/ai-workspace/services/content-quality-doctrine";
import { looksLikeInstructionEcho, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";
import { containsFabricatedMetric } from "@/features/ai-workspace/services/topic-cluster-planner.service";
import { containsUnsupportedMarketingClaim } from "@/features/ai-workspace/services/email-newsletter.service";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";

/** Bumped whenever the prompt template below changes — same convention as every other AI Workspace service. */
export const PROMPT_VERSION = 1;

/** Alt text is one short string; this ceiling is generous for that and far below every other tool's. */
const MAX_OUTPUT_TOKENS = 600;

/** Above this, alt text is usually doing more than alt text should. Guidance only — never a rejection. */
export const COMFORTABLE_ALT_TEXT_LENGTH = 150;

export type ImageAltTextSource = {
  fileName: string;
  mimeType: string;
  /** The Content this image is attached to, when it is attached to one at all. */
  contentTitle: string | null;
  contentMetaDescription: string | null;
};

/**
 * The generation context. The naming is deliberate: `imageDescription` is the
 * user's own account of the picture and is the ONLY evidence of what the
 * image contains. Everything else is context for tone and wording.
 */
export type ImageAltTextContext = {
  seoProjectId: string;
  companyId: string;
  seoProjectName: string;
  domain: string;
  source: ImageAltTextSource;
  imageDescription: string;
  additionalContext?: string;
};

export const IMAGE_ALT_TEXT_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are an accessibility specialist writing alt text for ONE image.

CRITICAL — YOU CANNOT SEE THE IMAGE. No image data has been given to you. You have not viewed, inspected, analysed, scanned or read anything in the picture, and you must never write or imply otherwise. The user's written description below is your only evidence of what the image contains.

Treat the supplied material as follows:
1. USER-PROVIDED IMAGE DESCRIPTION — the authoritative account of what the image shows. Everything you describe must come from here.
2. CONTENT CONTEXT — the page this image sits on. Use it to judge what about the image matters to a reader, and for correct terminology. It is NOT evidence of what is in the image: an article about self-storage investing does not mean the picture shows a storage unit.
3. BRAND PROFILE — tone, language and company context only. It is NOT evidence of what is in the image: a company selling storage units does not mean this image shows one.
4. FILE NAME — a label someone typed, not a description. "storage-investing-final-v2.png" is not proof the image shows storage investing. Never describe the image based on its file name.

Never invent a person, object, location, setting, action, product, colour, logo, brand, company name, or any text appearing in the image. Never claim to have read words, signs, captions, labels or numbers inside the image — if the user wants text from the image included, they must supply it in their description. Never state a statistic, measurement, count or performance claim.

Write alt text that serves a screen-reader user: convey the meaningful visual information as concisely as the content allows, in natural language, as a single sentence or short phrase. Do not start with "Image of", "Picture of", "Photo of" or "Graphic of" — a screen reader already announces that it is an image. Do not end with a file extension. Do not stuff keywords, repeat a term for emphasis, or add marketing language, slogans, superlatives or promotional claims: alt text describes the image, it does not advertise the company. Only use a project keyword if the user's description genuinely supports it — never insert one because it exists in the project.

If the user's description is too vague to support any specific alt text, say so honestly in your reasoning and write the most accurate short description the description actually supports rather than inventing detail to fill it out.

${SEO_METRIC_GROUNDING_GUARD}`;

/**
 * Screen readers already announce "image", so these openings are pure
 * redundancy for the listener. Stripped deterministically rather than
 * rejected: the rest of the sentence is usually perfectly good alt text.
 */
const REDUNDANT_PREFIX = /^\s*(?:an?\s+)?(?:image|picture|photo(?:graph)?|graphic|illustration|screenshot)\s+(?:of|showing|depicting)(?:\s+|$)/i;

export function stripRedundantImagePrefix(text: string): string {
  const stripped = text.replace(REDUNDANT_PREFIX, "");
  if (stripped === text) return text.trim();
  // Restore sentence capitalisation after removing the opening words.
  return (stripped.charAt(0).toUpperCase() + stripped.slice(1)).trim();
}

/**
 * Detects the same term being repeated for search-engine benefit rather than
 * for the listener. Alt text is one short sentence: a content word appearing
 * three or more times in it is padding, not description.
 *
 * Short function words are excluded so ordinary grammar ("a man in a room in
 * a house") never trips it.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with", "by", "from", "as", "is", "are",
  "was", "were", "be", "being", "been", "it", "its", "this", "that", "these", "those", "his", "her", "their",
  "over", "under", "into", "next", "near", "while", "during", "two", "three",
  // Common sentence openers in alt text — capitalised by position, not because
  // they name anything. Listed so they are never mistaken for proper nouns.
  "one", "four", "five", "several", "many", "some", "close", "up", "top", "left", "right",
  "front", "back", "side", "view", "detail", "group", "part", "inside", "outside",
]);

export function looksLikeKeywordStuffing(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

/**
 * Detects proper nouns in the alt text that no supplied evidence mentions —
 * the deterministic guard against an invented brand, logo, person, company or
 * place name.
 *
 * A capitalised token is suspicious when it appears nowhere in the user's
 * description, the Content context, the Brand Profile text, the project name
 * or the domain.
 *
 * The first word is deliberately NOT exempt. Sentence-initial capitalisation
 * is ambiguous, but exempting it lets an invented name at the start of the
 * sentence ("Sarah reviewing a spreadsheet") through unchallenged — and alt
 * text is derived from the description, so a legitimate opening word almost
 * always appears in the evidence anyway. Where it does not, the common
 * openers below cover it. Erring toward rejection is the right direction for
 * a tool whose purpose is preventing invention.
 */
export function findUnsupportedProperNouns(altText: string, evidence: string): string[] {
  const haystack = evidence.toLowerCase();
  const tokens = altText.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  const unsupported: string[] = [];

  for (const token of tokens) {
    if (!/^[A-Z]/.test(token)) continue;
    if (token.length < 2) continue;
    if (STOP_WORDS.has(token.toLowerCase())) continue;
    if (haystack.includes(token.toLowerCase())) continue;
    if (!unsupported.includes(token)) unsupported.push(token);
  }
  return unsupported;
}

/** Deterministic guidance, never a rejection — a long alt text that genuinely needs its length is kept and simply flagged. */
export function buildLengthGuidance(altText: string): string {
  if (altText.length <= COMFORTABLE_ALT_TEXT_LENGTH) return "";
  return `This alt text is ${altText.length} characters. Most screen-reader users are best served by around ${COMFORTABLE_ALT_TEXT_LENGTH} or fewer — consider whether any detail here belongs in the surrounding page text instead. Keep the length if every part of it carries meaning the reader needs.`;
}

/**
 * Builds the prompt, keeping the evidence hierarchy visible so the model is
 * told not only what it knows but how much each piece is worth.
 */
export function buildPrompt(ctx: ImageAltTextContext, brandProfile?: BrandProfile | null): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  lines.push("\n=== USER-PROVIDED IMAGE DESCRIPTION (your only evidence of what the image shows) ===");
  lines.push(ctx.imageDescription.trim());
  if (ctx.additionalContext) lines.push(`\nAdditional context from the user: ${ctx.additionalContext}`);

  lines.push("\n=== CONTENT CONTEXT (where the image appears — relevance and terminology only, NOT evidence of image contents) ===");
  if (ctx.source.contentTitle) {
    lines.push(`Page title: ${ctx.source.contentTitle}`);
    if (ctx.source.contentMetaDescription) lines.push(`Page summary: ${ctx.source.contentMetaDescription}`);
  } else {
    lines.push("(this image is not attached to a content record — rely on the user's description alone)");
  }

  lines.push("\n=== FILE METADATA (a label someone typed — never a description of the image) ===");
  lines.push(`File name: ${ctx.source.fileName}`);
  lines.push(`File type: ${ctx.source.mimeType}`);

  const brandLines: string[] = [];
  if (brandProfile?.brandName) brandLines.push(`Brand name: ${brandProfile.brandName}.`);
  if (brandProfile?.brandVoice) brandLines.push(`Brand voice: ${brandProfile.brandVoice}.`);
  if (brandProfile?.targetAudience) brandLines.push(`Target audience: ${brandProfile.targetAudience}.`);
  if (brandProfile?.language) brandLines.push(`Write in this language: ${brandProfile.language}.`);
  if (brandLines.length > 0) {
    lines.push("\n=== BRAND PROFILE (tone and language only, NOT evidence of image contents) ===");
    lines.push(...brandLines);
  }

  return `${lines.join("\n")}

Return an object with:
1. altText: the alt text itself — natural language describing the meaningful visual information, drawn only from the user's description. No "Image of" opening, no keyword stuffing, no marketing language.
2. reasoning: one or two sentences for the human reviewer explaining what you based the alt text on, and noting honestly if the description was too vague to support more detail. This is never part of the alt text.
3. accessibilityNote: an optional short note if there is something the reviewer should know — for example that the image may be decorative, that it appears to contain text the user should supply, or that a longer description elsewhere on the page may be needed. Empty string if there is nothing to add.

Describe only what the user's description supports. Never add a person, object, place, brand, logo, colour or piece of text that is not in it.`;
}

/**
 * Deterministic, whole-result validation — "loose contract in, strict filter
 * out; reject, never repair", with two deliberate exceptions where a
 * mechanical cleanup is clearly right:
 *
 * - The redundant "Image of" opening is STRIPPED, not rejected: it is a fixed
 *   accessibility rule and the remainder of the sentence is usually good.
 * - Length produces GUIDANCE, not rejection, because an arbitrary character
 *   cap would sometimes force less accessible alt text — the opposite of this
 *   tool's purpose.
 *
 * Everything else that indicates invention — a fabricated metric, an
 * unsupported marketing claim, keyword stuffing, or a proper noun no evidence
 * supports — rejects the whole result, because alt text is a single sentence
 * with nothing separable to drop.
 */
export function buildImageAltTextResult(raw: unknown, ctx: ImageAltTextContext, brandProfile?: BrandProfile | null): ImageAltTextResult | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  if (typeof item.altText !== "string" || typeof item.reasoning !== "string") return null;
  const accessibilityNoteRaw = typeof item.accessibilityNote === "string" ? item.accessibilityNote : "";
  if (!item.reasoning.trim()) return null;

  const clean = (text: string) => stripHtmlTags(stripConfigurationArtifacts(text));
  const altText = stripRedundantImagePrefix(clean(item.altText));
  if (!altText.trim()) return null;

  if (looksLikeInstructionEcho(altText)) return null;
  if (containsFabricatedMetric(altText)) return null;
  if (containsUnsupportedMarketingClaim(altText)) return null;
  if (looksLikeKeywordStuffing(altText)) return null;

  /*
   * The evidence pool the alt text is allowed to draw proper nouns from.
   * Brand Profile and Content context are included because naming the real
   * company or the page's own subject is legitimate; anything outside all of
   * it is invention.
   */
  const evidence = [
    ctx.imageDescription,
    ctx.additionalContext ?? "",
    ctx.source.contentTitle ?? "",
    ctx.source.contentMetaDescription ?? "",
    ctx.source.fileName,
    ctx.seoProjectName,
    ctx.domain,
    brandProfile?.brandName ?? "",
    brandProfile?.productsServices ?? "",
    brandProfile?.targetAudience ?? "",
    brandProfile?.targetCountry ?? "",
  ].join(" ");
  if (findUnsupportedProperNouns(altText, evidence).length > 0) return null;

  const accessibilityNote = clean(accessibilityNoteRaw).trim();
  if (accessibilityNote && looksLikeInstructionEcho(accessibilityNote)) return null;

  return {
    altText,
    reasoning: item.reasoning.trim(),
    accessibilityNote,
    lengthGuidance: buildLengthGuidance(altText),
    characterCount: altText.length,
  };
}

/**
 * The generation wrapper — the shared orchestrator, no new AI client, no
 * provider bypass, and deliberately NO multimodal/vision call: the provider
 * architecture is text-only and this tool does not change that.
 *
 * Review-only: never writes to File or Content, and never creates a revision.
 */
export async function generateImageAltText(ctx: ImageAltTextContext, onChunk?: (event: StreamEvent) => void): Promise<ImageAltTextResult | null> {
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);
  const options = {
    system: IMAGE_ALT_TEXT_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, brandProfile),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "IMAGE_ALT_TEXT" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(imageAltTextProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(imageAltTextProviderOutputSchema, options);
  const parsed = imageAltTextProviderOutputSchema.parse(result);
  return buildImageAltTextResult(parsed, ctx, brandProfile);
}
