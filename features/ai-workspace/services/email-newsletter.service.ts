import type { BrandProfile } from "@/lib/generated/prisma/client";
import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import type { StreamEvent } from "@/lib/ai/providers/types";
import {
  emailNewsletterProviderOutputSchema,
  type EmailNewsletterResult,
  type EmailNewsletterSection,
} from "@/features/ai-workspace/schemas/email-newsletter.schema";
import { CONTENT_QUALITY_DOCTRINE, SEO_METRIC_GROUNDING_GUARD } from "@/features/ai-workspace/services/content-quality-doctrine";
import { looksLikeInstructionEcho, stripConfigurationArtifacts, stripHtmlTags } from "@/features/ai-workspace/services/content-sanitizer";
import { containsFabricatedMetric } from "@/features/ai-workspace/services/topic-cluster-planner.service";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";

/** Bumped whenever the prompt template below changes — same convention as every other AI Workspace service. */
export const PROMPT_VERSION = 1;

/** Matches every other AI Workspace service's own token ceiling — a known, shared, honest limitation, not scaled per request. */
const MAX_OUTPUT_TOKENS = 4000;

/**
 * The generation context, built by the dispatcher from the RE-FETCHED
 * Content row plus the user's own form input. The four grounding categories
 * the newsletter must keep distinct are visible in this type's shape:
 * `sourceContent` (the customer's real page), the user's own fields
 * (`audience`/`callToAction`/`campaignAngle`/`additionalContext`/`notes`),
 * the Brand Profile fetched separately below, and everything else — which is
 * AI writing and is treated as such.
 */
export type EmailNewsletterSourceContent = {
  title: string;
  url: string | null;
  metaDescription: string | null;
  body: string | null;
};

export type EmailNewsletterContext = {
  seoProjectId: string;
  companyId: string;
  seoProjectName: string;
  domain: string;
  sourceContent: EmailNewsletterSourceContent;
  audience?: string;
  callToAction?: string;
  campaignAngle?: string;
  additionalContext?: string;
  notes?: string;
};

export const EMAIL_NEWSLETTER_SYSTEM_PROMPT = `${CONTENT_QUALITY_DOCTRINE} You are an email marketing writer drafting ONE email newsletter.

You are given four clearly separated kinds of material, and you must treat them differently:
1. SOURCE CONTENT — a real page the customer already published or drafted. This is the factual basis of the newsletter. You may summarise, rewrite, reorder and condense it freely, but you may not add facts to it.
2. USER INPUT — audience, call to action, campaign angle, additional context and notes supplied by the person requesting this draft. Treat these as instructions and as their own material. If they supplied a call to action, use their wording and intent rather than inventing a different one.
3. BRAND PROFILE — stored brand name, voice, audience, products/services, language and market. Use it for tone and for describing the company. It is not a source of new factual claims.
4. YOUR OWN WRITING — the connective prose, structure and phrasing you contribute. This must never introduce a new fact.

Never invent a statistic, percentage, number of customers, revenue figure, growth figure, survey result, case study, customer result, testimonial, review, quote, named person, named client, partner, award, certification, accreditation, guarantee, price, discount, offer, deadline, date, event, product capability, or service not present in the supplied material. If a fact is not in the source content, the user's input or the Brand Profile, it does not go in the newsletter.

Avoid unsupported marketing claims. Do not write phrases like "our best-selling product", "thousands of customers", "increased conversions by 200%", "guaranteed results", "industry-leading", "award-winning", "the #1 choice", or "trusted by thousands" unless that exact claim is present in the supplied material. When you have no evidence for a superlative, use neutral, descriptive language instead — describe what the content actually covers and why a reader might find it useful.

Preserve the source page's important topic terminology so the newsletter stays consistent with it, but write natural email copy — never force keywords in, and never claim the newsletter will improve rankings, search visibility or AI visibility.

This is a draft only. Never write anything that implies the email has been sent, scheduled, or delivered to a list, and never invent recipient, subscriber or performance information.

Never include instruction text, configuration labels, character/word counts, or a JSON wrapper as part of the visible copy.

${SEO_METRIC_GROUNDING_GUARD}`;

/**
 * Deterministic detector for the unsupported marketing claims the prompt
 * forbids. The prompt is advisory; this is the guarantee.
 *
 * Every pattern requires the claim itself to be present — a superlative, an
 * unevidenced scale/volume claim, or a guarantee. Ordinary marketing verbs
 * ("learn", "discover", "read more") are deliberately not matched: this
 * filter exists to catch fabricated evidence, not to flatten the writing.
 */
const UNSUPPORTED_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bbest[-\s]?selling\b/i,
  /\bbest[-\s]?in[-\s]?class\b/i,
  /\bindustry[-\s]?leading\b/i,
  /\bmarket[-\s]?leading\b/i,
  /\baward[-\s]?winning\b/i,
  /\bworld[-\s]?class\b/i,
  /\b(?:the\s+)?(?:#\s*1|no\.?\s*1|number\s+one)\b/i,
  /\bguarantee(?:d|s)?\b/i,
  /\b(?:thousands|millions|hundreds)\s+of\s+(?:customers|clients|users|subscribers|businesses|readers|investors)\b/i,
  /\btrusted\s+by\s+(?:thousands|millions|hundreds|\d)/i,
  /\bjoin\s+(?:thousands|millions|hundreds|\d[\d,.]*\+?)\s+/i,
  /\b(?:increase|boost|grow|improve|reduce|cut)\w*\s+(?:your\s+)?\w*\s*(?:by\s+)?\d[\d,.]*\s*%/i,
  /\b\d[\d,.]*\s*%\s*(?:increase|growth|improvement|more|higher|faster|better)\b/i,
  /\bproven\s+(?:results|track record|to\s+(?:increase|boost|double))\b/i,
  /\brisk[-\s]?free\b/i,
  /\b(?:money[-\s]?back|satisfaction)\s+guarantee\b/i,
];

/**
 * True when the text makes a marketing claim this platform has no evidence
 * for. Exported so the boundary is directly testable rather than only
 * observable through a full generation.
 */
export function containsUnsupportedMarketingClaim(text: string): boolean {
  if (!text) return false;
  return UNSUPPORTED_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

/** A field is unusable when it echoes instructions, fabricates a metric, or makes an unevidenced marketing claim. */
function isUngrounded(text: string): boolean {
  return looksLikeInstructionEcho(text) || containsFabricatedMetric(text) || containsUnsupportedMarketingClaim(text);
}

const clean = (text: string) => stripHtmlTags(stripConfigurationArtifacts(text));

/**
 * Builds the prompt, keeping the four material categories visibly separate
 * so the model is told not just what the facts are but where each one came
 * from and how much authority it carries.
 *
 * The source body is truncated to a bounded excerpt: a newsletter is a
 * summary, and sending an unbounded article body would risk the request
 * exceeding the model's context on a long page. The truncation is stated in
 * the prompt rather than hidden, so the model does not treat the cut-off
 * point as the end of the article.
 */
const MAX_SOURCE_BODY_CHARS = 12000;

export function buildPrompt(ctx: EmailNewsletterContext, brandProfile?: BrandProfile | null): string {
  const lines: string[] = [`Website: ${ctx.domain} (SEO project: ${ctx.seoProjectName})`];

  lines.push("\n=== SOURCE CONTENT (the customer's real page — the factual basis; rewrite it, never add to it) ===");
  lines.push(`Title: ${ctx.sourceContent.title}`);
  if (ctx.sourceContent.url) lines.push(`URL: ${ctx.sourceContent.url}`);
  if (ctx.sourceContent.metaDescription) lines.push(`Meta description: ${ctx.sourceContent.metaDescription}`);

  const body = (ctx.sourceContent.body ?? "").trim();
  if (body) {
    const excerpt = body.length > MAX_SOURCE_BODY_CHARS ? `${body.slice(0, MAX_SOURCE_BODY_CHARS)}\n[…the article continues beyond this excerpt…]` : body;
    lines.push(`Body:\n---\n${excerpt}\n---`);
  } else {
    lines.push("Body: (this content record has no body text — draft only from the additional context supplied below, and do not invent article content)");
  }

  lines.push("\n=== USER INPUT (supplied by the person requesting this draft) ===");
  lines.push(ctx.audience ? `Audience: ${ctx.audience}` : "Audience: (not specified — write for a general reader of this site, do not invent a segment)");
  lines.push(
    ctx.callToAction
      ? `Call to action to use (their wording and intent): ${ctx.callToAction}`
      : "Call to action: (none supplied — close by pointing the reader to the source page itself; do not invent an offer, discount, deadline or event)"
  );
  if (ctx.campaignAngle) lines.push(`Campaign angle / newsletter purpose: ${ctx.campaignAngle}`);
  if (ctx.additionalContext) lines.push(`Additional context supplied by the user (their own material, as factual as the source page):\n---\n${ctx.additionalContext}\n---`);
  if (ctx.notes) lines.push(`Additional notes: ${ctx.notes}`);

  const brandLines: string[] = [];
  if (brandProfile?.brandName) brandLines.push(`Brand name: ${brandProfile.brandName}.`);
  if (brandProfile?.brandVoice) brandLines.push(`Brand voice: ${brandProfile.brandVoice}.`);
  if (brandProfile?.targetAudience) brandLines.push(`Brand target audience: ${brandProfile.targetAudience}.`);
  if (brandProfile?.productsServices) brandLines.push(`Products/services: ${brandProfile.productsServices}.`);
  if (brandProfile?.targetCountry) brandLines.push(`Target country/market: ${brandProfile.targetCountry}.`);
  if (brandProfile?.language) brandLines.push(`Write in this language: ${brandProfile.language}.`);
  if (brandLines.length > 0) {
    lines.push("\n=== BRAND PROFILE (tone and company description only — not a source of new facts) ===");
    lines.push(...brandLines);
  }

  return `${lines.join("\n")}

Return an object with:
1. subjectLine: the email subject line — specific to this content, under about 60 characters, no clickbait and no claim the content doesn't support.
2. previewText: the preview/preheader text that follows the subject in an inbox — one short sentence that adds to the subject rather than repeating it.
3. headline: the headline at the top of the email body.
4. introduction: a short opening paragraph that tells the reader what this is about and why it is useful to them.
5. bodySections: an array of sections, each with a heading and a body paragraph or two, covering the substance of the source content. Each section must carry information the others do not.
6. callToAction: the closing call to action. Use the user's supplied call to action if there is one; otherwise point the reader to the source page.
7. closing: a brief sign-off line.
8. reasoning: one or two sentences for the human reviewer summarising how the draft was put together. This is not part of the email.

Use only the material supplied above. Never introduce a fact, figure, testimonial, claim, price, date or guarantee that is not already there.`;
}

/**
 * Deterministic, whole-result validation — "loose contract in, strict filter
 * out; reject, never repair", applied to a single result object.
 *
 * The asymmetry here is deliberate and mirrors the same judgement
 * buildCompetitorAnalysisResult makes about topics versus coverage bullets:
 *
 * - subjectLine, previewText, headline and introduction are load-bearing. A
 *   fabricated metric or unsupported claim in any of them contaminates the
 *   whole newsletter, so the entire result is rejected.
 * - A body section is separable. One bad section is dropped and the rest of
 *   the newsletter survives — but at least one section must remain, since a
 *   newsletter with no body is not a newsletter.
 * - callToAction is treated the way press-release's quoteSection is: when
 *   the USER supplied a call to action, the words trace back to them and
 *   only an instruction echo disqualifies it. When they supplied none, an
 *   unevidenced claim is fabrication by definition, and the field is cleared
 *   to the empty string rather than invalidating an otherwise-good draft.
 */
export function buildEmailNewsletterResult(raw: unknown, ctx: EmailNewsletterContext): EmailNewsletterResult | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  if (
    typeof item.subjectLine !== "string" ||
    typeof item.previewText !== "string" ||
    typeof item.headline !== "string" ||
    typeof item.introduction !== "string" ||
    !Array.isArray(item.bodySections) ||
    typeof item.callToAction !== "string" ||
    typeof item.closing !== "string" ||
    typeof item.reasoning !== "string"
  ) {
    return null;
  }
  if (!item.reasoning.trim()) return null;

  const subjectLine = clean(item.subjectLine);
  const previewText = clean(item.previewText);
  const headline = clean(item.headline);
  const introduction = clean(item.introduction);
  const closing = clean(item.closing);

  // Required content — a newsletter missing any of these is not usable.
  if (!subjectLine.trim() || !previewText.trim() || !headline.trim() || !introduction.trim()) return null;

  // Load-bearing fields: any ungrounded claim invalidates the whole draft.
  if ([subjectLine, previewText, headline, introduction].some(isUngrounded)) return null;
  if (closing.trim() && isUngrounded(closing)) return null;

  const bodySections: EmailNewsletterSection[] = [];
  for (const section of item.bodySections) {
    if (!section || typeof section !== "object") continue;
    const candidate = section as Record<string, unknown>;
    if (typeof candidate.heading !== "string" || typeof candidate.body !== "string") continue;

    const heading = clean(candidate.heading);
    const body = clean(candidate.body);
    if (!heading.trim() || !body.trim()) continue;
    // A separable unit: one ungrounded section is dropped, not fatal.
    if (isUngrounded(heading) || isUngrounded(body)) continue;

    bodySections.push({ heading, body });
  }
  if (bodySections.length === 0) return null;

  const cleanedCallToAction = clean(item.callToAction);
  let callToAction = "";
  if (cleanedCallToAction.trim()) {
    if (looksLikeInstructionEcho(cleanedCallToAction)) return null;
    // The user's own wording carries their authority; an invented one does not.
    const userSuppliedCallToAction = (ctx.callToAction ?? "").trim().length > 0;
    callToAction = userSuppliedCallToAction || !isUngrounded(cleanedCallToAction) ? cleanedCallToAction : "";
  }

  return {
    subjectLine,
    previewText,
    headline,
    introduction,
    bodySections,
    callToAction,
    closing,
    reasoning: item.reasoning.trim(),
  };
}

/**
 * The generation wrapper — mirrors every other AI Workspace tool's
 * generateXxx shape exactly: service-internal Brand Profile fetch
 * (ctx.companyId is already trusted, derived from the authenticated actor at
 * job-creation time), the shared generateStructuredOutput/Streaming
 * orchestrator (no new AI client, no provider bypass), then this file's own
 * buildEmailNewsletterResult applied to whatever the provider returns.
 *
 * Drafting only: this never writes to Content, never creates a
 * ContentRevision, never sends or schedules anything, and has no email
 * provider of any kind.
 */
export async function generateEmailNewsletter(ctx: EmailNewsletterContext, onChunk?: (event: StreamEvent) => void): Promise<EmailNewsletterResult | null> {
  const brandProfile = await getBrandProfileByCompanyId(ctx.companyId);
  const options = {
    system: EMAIL_NEWSLETTER_SYSTEM_PROMPT,
    prompt: buildPrompt(ctx, brandProfile),
    maxTokens: MAX_OUTPUT_TOKENS,
    taskType: "EMAIL_NEWSLETTER" as const,
    promptVersion: PROMPT_VERSION,
    seoProjectId: ctx.seoProjectId,
    companyId: ctx.companyId,
  };
  const result = onChunk
    ? await generateStructuredOutputStreaming(emailNewsletterProviderOutputSchema, options, onChunk)
    : await generateStructuredOutput(emailNewsletterProviderOutputSchema, options);
  const parsed = emailNewsletterProviderOutputSchema.parse(result);
  return buildEmailNewsletterResult(parsed, ctx);
}
