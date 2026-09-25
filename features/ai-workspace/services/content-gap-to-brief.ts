import { CONTENT_BRIEF_TYPES, type ContentBriefType } from "@/features/ai-workspace/schemas/content-brief.schema";
import type { ContentGapContentType, ContentGapOpportunity } from "@/features/ai-workspace/schemas/content-gap-analysis.schema";

/**
 * Phase C2 — the deterministic hand-off from a Content Gap Analysis
 * opportunity to the SEO Content Brief form.
 *
 * This is a pure mapping module, NOT a workflow engine: it holds no state,
 * performs no I/O, creates no records, and calls no AI. Its only job is to
 * turn one already-generated opportunity into prefilled, user-editable form
 * values. Every value it produces is a suggestion the user sees and can
 * change before anything is generated or saved, and none of it carries any
 * authority — the server re-derives project/company ownership regardless of
 * what these values say.
 */

/**
 * C2.3 — the two tools use different content-type vocabularies:
 * Content Gap Analysis emits ARTICLE | FAQ_PAGE | LANDING_PAGE | CASE_STUDY,
 * while the Brief accepts BLOG_POST | LANDING_PAGE | PILLAR_PAGE | OTHER.
 * Only LANDING_PAGE matches exactly. This conversion is done here in
 * application code, deterministically — the AI is never asked to perform it.
 *
 * FAQ_PAGE and CASE_STUDY map to OTHER because the Brief has no closer
 * equivalent; deliberately not forced into BLOG_POST, which would misdescribe
 * the format. The result is only ever a PREFILL — the user can pick any type.
 */
const GAP_TYPE_TO_BRIEF_TYPE: Record<ContentGapContentType, ContentBriefType> = {
  ARTICLE: "BLOG_POST",
  FAQ_PAGE: "OTHER",
  LANDING_PAGE: "LANDING_PAGE",
  CASE_STUDY: "OTHER",
};

/**
 * Returns null when the opportunity carried no AI format suggestion (a valid,
 * expected state — see the nullable classification contract in
 * content-gap-analysis.schema.ts) or when the value isn't a type we recognise.
 * Null means "no prefill; let the user choose", never a guessed default.
 */
export function mapGapContentTypeToBriefType(suggested: string | null | undefined): ContentBriefType | null {
  if (!suggested) return null;
  return GAP_TYPE_TO_BRIEF_TYPE[suggested as ContentGapContentType] ?? null;
}

/**
 * Composes the opportunity into the Brief's existing `notes` field.
 *
 * C1 established that contentBriefInputSchema has no dedicated topic field
 * and that adding one is out of scope; `notes` is the correct carrier
 * because it is already free text, already fed to the prompt, and — most
 * importantly — already visible and editable, so the user reviews the
 * AI-suggested opportunity before it influences anything. The text is
 * deliberately plain and label-led rather than encoded, so it reads as
 * ordinary notes the user can rewrite or delete.
 *
 * Only fields the opportunity genuinely carries are included; nothing is
 * invented, and no coverage/metric claim is restated as fact.
 */
export function buildBriefNotesFromOpportunity(opportunity: Pick<ContentGapOpportunity, "topic" | "opportunity" | "reason" | "relatedCluster">): string {
  const lines: string[] = [`Content opportunity: ${opportunity.topic}`];
  if (opportunity.opportunity.trim()) lines.push(opportunity.opportunity.trim());
  if (opportunity.reason.trim()) lines.push(`Why it matters: ${opportunity.reason.trim()}`);
  if (opportunity.relatedCluster) lines.push(`Related keyword cluster: ${opportunity.relatedCluster}`);
  return lines.join("\n\n");
}

/** The prefill values a Content Gap opportunity hands to the Brief form. */
export type BriefHandoff = {
  seoProjectId: string;
  notes: string;
  /** Absent when the opportunity carried no usable format suggestion. */
  contentType?: ContentBriefType;
};

/**
 * Builds the complete hand-off. Returns null for an opportunity with no
 * usable topic — the action that renders the button uses this to decide
 * whether to offer it at all, so a malformed item can never start a Brief.
 *
 * `seoProjectId` is passed only so the form can preselect the project the
 * user already chose in Content Gap Analysis; it is an id, never a name or
 * domain, and the server re-verifies it against the authenticated actor's
 * company on every subsequent call.
 */
export function buildBriefHandoff(seoProjectId: string, opportunity: ContentGapOpportunity): BriefHandoff | null {
  if (!seoProjectId.trim() || !opportunity.topic.trim()) return null;

  const contentType = mapGapContentTypeToBriefType(opportunity.suggestedContentType);
  return {
    seoProjectId,
    notes: buildBriefNotesFromOpportunity(opportunity),
    ...(contentType ? { contentType } : {}),
  };
}

/** Serialises a hand-off into the Brief route's query string. Values are ordinary form prefills, never authorization input. */
export function buildBriefHandoffHref(handoff: BriefHandoff): string {
  const params = new URLSearchParams({ seoProjectId: handoff.seoProjectId, notes: handoff.notes });
  if (handoff.contentType) params.set("contentType", handoff.contentType);
  return `/ai/content-brief/new?${params.toString()}`;
}

/**
 * Read-back guard for the Brief route's own search params. Anything
 * unrecognised is dropped rather than corrected, so a hand-crafted URL can
 * only ever prefill a form field — it can never widen what the user is
 * allowed to generate against, which the server decides independently.
 */
export function parseBriefHandoffParams(params: { seoProjectId?: string; notes?: string; contentType?: string }): {
  seoProjectId: string;
  notes: string;
  contentType: ContentBriefType | null;
} {
  const contentType = params.contentType && (CONTENT_BRIEF_TYPES as readonly string[]).includes(params.contentType) ? (params.contentType as ContentBriefType) : null;
  return {
    seoProjectId: typeof params.seoProjectId === "string" ? params.seoProjectId : "",
    notes: typeof params.notes === "string" ? params.notes : "",
    contentType,
  };
}
