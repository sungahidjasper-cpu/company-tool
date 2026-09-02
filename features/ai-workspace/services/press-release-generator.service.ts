import type { BrandProfile } from "@/lib/generated/prisma/client";
import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import { pressReleaseGeneratorProviderOutputSchema, type PressReleaseResult } from "@/features/ai-workspace/schemas/press-release-generator.schema";
import { CONTENT_QUALITY_DOCTRINE } from "@/features/ai-workspace/services/content-quality-doctrine";
import { looksLikeInstructionEcho, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";

/** Bumped whenever the prompt template below changes — same convention as every other AI Workspace service's PROMPT_VERSION. */
export const PROMPT_VERSION = 1;

/** Matches every other AI Workspace service's own token ceiling (Long-Form Content and Content Rewriter both use the same 4000) — a known, shared, honest limitation, not scaled per request size by any tool in this app. */
const MAX_OUTPUT_TOKENS = 4000;

/**
 * The generation context — built by the caller (the generation action) from
 * the actor's own request, never grounded in any existing Content row. The
 * user's own supplied announcement facts are the ONLY real-world grounding
 * source, alongside optional supplementary Brand Profile context.
 */
export type PressReleaseGeneratorContext = {
  seoProjectId: string;
  companyId: string;
  seoProjectName: string;
  domain: string;
  headline: string;
  keyFacts: string;
  quote?: string;
  dateline?: string;
  callToAction?: string;
  notes?: string;
};

export const PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are a public-relations writer drafting ONE press release. The announcement headline and details supplied below are the ONLY source of truth for what happened — never invent a date, named person, company, partner, customer, award, certification, statistic, location, product capability, partnership, testimonial, or quote that is not explicitly present in the supplied headline, announcement details, quote, dateline, notes, or Brand Profile context. If no quote was supplied, leave quoteSection empty rather than inventing one. If no dateline or location was supplied, leave dateline empty rather than guessing a city. If a fact is not available in the supplied context, omit it entirely — never fill the gap with a plausible-sounding detail. Write in standard press-release style: a clear headline, a supporting subheadline, an inverted-pyramid lead paragraph covering who/what/when/where/why using only the supplied facts, one or more supporting body paragraphs, and — only if a quote was supplied — a quote section attributing it exactly as given, never paraphrased or attributed to someone not named. The boilerplate/company-description paragraph may describe the company using only the Brand Profile context supplied below — never invent products, services, achievements, or history not stated there. Never include instruction text, configuration labels, character/word counts, or a JSON wrapper as part of the visible text.`;

/**
 * Mirrors every other AI Workspace service's one-function-per-task pattern.
 * No changes to lib/ai/providers/*. Deliberately does not consume Knowledge
 * Source: this tool is grounded entirely in the user's own supplied facts
 * plus Brand Profile, with nothing external to ground against.
 */
export function buildPrompt(ctx: PressReleaseGeneratorContext, brandProfile?: BrandProfile | null): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  lines.push(`\nAnnouncement headline: "${ctx.headline}"`);
  lines.push(`Announcement details (the only facts to draw from):\n---\n${ctx.keyFacts}\n---`);
  lines.push(ctx.quote ? `Quote to include, attributed exactly as given: "${ctx.quote}"` : "Quote: (none supplied — do not invent a quote; leave quoteSection empty)");
  lines.push(ctx.dateline ? `Dateline/location: "${ctx.dateline}"` : "Dateline/location: (none supplied — do not guess one; leave dateline empty)");
  lines.push(ctx.callToAction ? `Call to action / contact info to close with: "${ctx.callToAction}"` : "Call to action: (none supplied — leave callToAction empty)");
  if (ctx.notes) lines.push(`Additional notes: ${ctx.notes}`);

  if (brandProfile?.brandName) lines.push(`\nBrand name: ${brandProfile.brandName}.`);
  if (brandProfile?.brandVoice) lines.push(`Brand voice: ${brandProfile.brandVoice}.`);
  if (brandProfile?.targetAudience) lines.push(`Target audience: ${brandProfile.targetAudience}.`);
  if (brandProfile?.productsServices) lines.push(`Products/services: ${brandProfile.productsServices}.`);
  if (brandProfile?.targetCountry) lines.push(`Target country/market: ${brandProfile.targetCountry}.`);
  if (brandProfile?.language) lines.push(`Write in this language: ${brandProfile.language}.`);

  return `${lines.join("\n")}

Return an object with:
1. headline: the press release headline.
2. subheadline: a supporting subheadline.
3. dateline: the dateline/location line, or an empty string if none was supplied.
4. leadParagraph: the opening paragraph covering who/what/when/where/why.
5. bodyParagraphs: an array of one or more supporting paragraphs.
6. quoteSection: the quote, attributed exactly as given, or an empty string if none was supplied.
7. boilerplate: a short "About [Company]" paragraph grounded only in the Brand Profile context above.
8. callToAction: the closing call to action, or an empty string if none was supplied.
9. reasoning: one or two sentences summarizing how the release was structured.

Use only the facts supplied above — never introduce a fact, name, date, location, quote, or claim that isn't already there.`;
}

/**
 * Deterministic, whole-result validation — the same "loose contract in,
 * strict filter out, reject never repair" principle every other AI
 * Workspace tool's own filter function follows, applied here to a single
 * result object. Any required field failing validation invalidates the
 * whole release — returns null (a genuine, successful "no valid release"
 * outcome, not an error), matching Content Rewriter's own precedent.
 *
 * stripHtmlTags is applied to every short field (headline/subheadline/
 * dateline/quoteSection/boilerplate/callToAction) AND to each individual
 * bodyParagraphs entry — unlike Content Rewriter's multi-heading article
 * body, each paragraph here is ordinary single-paragraph prose with no
 * internal structure to preserve, so the whitespace-collapse stripHtmlTags
 * performs is safe and appropriate, not destructive.
 *
 * A narrow, deliberate exception to "reject the whole result" rather than
 * "clear one field": quoteSection/dateline/callToAction may only be
 * non-empty when the user actually supplied that input. If the model
 * returns text for one of these despite no corresponding input, that text
 * is fabricated by definition (there is nothing in the grounding context it
 * could legitimately be quoting) — this is cleared deterministically to an
 * empty string rather than invalidating an otherwise-good release, since
 * unlike a missing REQUIRED field, this doesn't make the release unusable,
 * and clearing a field to "no value" is a mechanical completeness rule, not
 * a content repair.
 */
export function buildPressReleaseResult(raw: unknown, ctx: PressReleaseGeneratorContext): PressReleaseResult | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (
    typeof item.headline !== "string" ||
    typeof item.subheadline !== "string" ||
    typeof item.dateline !== "string" ||
    typeof item.leadParagraph !== "string" ||
    !Array.isArray(item.bodyParagraphs) ||
    typeof item.quoteSection !== "string" ||
    typeof item.boilerplate !== "string" ||
    typeof item.callToAction !== "string"
  ) {
    return null;
  }
  if (!item.bodyParagraphs.every((p): p is string => typeof p === "string")) return null;
  if (typeof item.reasoning !== "string" || !item.reasoning.trim()) return null;

  const cleanShort = (text: string) => stripHtmlTags(stripConfigurationArtifacts(text));

  const cleanedHeadline = cleanShort(item.headline);
  const cleanedSubheadline = cleanShort(item.subheadline);
  const cleanedLeadParagraph = cleanShort(item.leadParagraph);
  const cleanedBoilerplate = cleanShort(item.boilerplate);
  const cleanedBodyParagraphs = item.bodyParagraphs.map(cleanShort).filter((p) => p.trim().length > 0);

  // Required content: a press release with no headline, lead, body, or
  // company description is not a usable release — reject the whole thing.
  if (!cleanedHeadline.trim() || !cleanedLeadParagraph.trim() || !cleanedBoilerplate.trim() || cleanedBodyParagraphs.length === 0) {
    return null;
  }

  if (
    looksLikeInstructionEcho(cleanedHeadline) ||
    looksLikeInstructionEcho(cleanedSubheadline) ||
    looksLikeInstructionEcho(cleanedLeadParagraph) ||
    looksLikeInstructionEcho(cleanedBoilerplate) ||
    cleanedBodyParagraphs.some((p) => looksLikeInstructionEcho(p))
  ) {
    return null;
  }

  // Conditionally-required fields: only ever populated when the user
  // actually supplied the corresponding input — see this function's own
  // comment above for why an ungrounded value here is cleared, not a
  // reason to reject the whole release.
  const cleanedDateline = ctx.dateline ? cleanShort(item.dateline) : "";
  const cleanedQuoteSection = ctx.quote ? cleanShort(item.quoteSection) : "";
  const cleanedCallToAction = ctx.callToAction ? cleanShort(item.callToAction) : "";

  if (
    (cleanedDateline && looksLikeInstructionEcho(cleanedDateline)) ||
    (cleanedQuoteSection && looksLikeInstructionEcho(cleanedQuoteSection)) ||
    (cleanedCallToAction && looksLikeInstructionEcho(cleanedCallToAction))
  ) {
    return null;
  }

  return {
    headline: cleanedHeadline,
    subheadline: cleanedSubheadline,
    dateline: cleanedDateline,
    leadParagraph: cleanedLeadParagraph,
    bodyParagraphs: cleanedBodyParagraphs,
    quoteSection: cleanedQuoteSection,
    boilerplate: cleanedBoilerplate,
    callToAction: cleanedCallToAction,
    reasoning: item.reasoning.trim(),
  };
}

/**
 * The generation wrapper — mirrors every other AI Workspace tool's
 * generateXxx shape exactly: service-internal Brand Profile fetch
 * (ctx.companyId is already trusted, derived from the authenticated actor
 * at job-creation time), the shared generateStructuredOutput/Streaming
 * orchestrator (no new AI client, no provider bypass), then this file's own
 * buildPressReleaseResult applied to whatever the provider returns.
 * Generation only: never writes to Content, never creates a
 * ContentRevision — this tool never even reads either of those.
 */
export async function generatePressRelease(ctx: PressReleaseGeneratorContext, onChunk?: (event: StreamEvent) => void): Promise<PressReleaseResult | null> {
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);
  const options = {
    system: PRESS_RELEASE_GENERATOR_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, brandProfile),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "PRESS_RELEASE_GENERATION" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(pressReleaseGeneratorProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(pressReleaseGeneratorProviderOutputSchema, options);
  const parsed = pressReleaseGeneratorProviderOutputSchema.parse(result);
  return buildPressReleaseResult(parsed, ctx);
}
