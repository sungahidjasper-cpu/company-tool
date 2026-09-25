import type { ContentBriefType } from "@/features/ai-workspace/schemas/content-brief.schema";
import type { CompetitorContentFormat, CompetitorOpportunity } from "@/features/ai-workspace/schemas/competitor-content-analysis.schema";
import type { BriefHandoff } from "@/features/ai-workspace/services/content-gap-to-brief";

/**
 * Competitor Content Analysis → Content Brief.
 *
 * Reuses `BriefHandoff` and `buildBriefHandoffHref` from content-gap-to-brief.ts
 * for the same reason topic-cluster-to-brief.ts does: the Brief route already
 * reads exactly those query params, and a third hand-off contract would be a
 * third thing to keep correct.
 *
 * Pure functions only — no state, no I/O, no AI. The values carry NO authority.
 * They are form prefills; the Brief's own action re-derives the company from
 * the authenticated actor and re-verifies the project id, so a hand-crafted URL
 * can only ever prefill fields the user could have typed themselves.
 */

/**
 * Maps this tool's format vocabulary onto the Brief's existing enum.
 *
 * PRODUCT_PAGE has no honest Brief equivalent and OTHER is already a deliberate
 * "unclassified" value, so both map to OTHER rather than being forced into a
 * shape that misdescribes them — the same conservative choice the other two
 * hand-offs made. Null means "no prefill; let the user choose", never a guess.
 */
const COMPETITOR_FORMAT_TO_BRIEF_TYPE: Record<CompetitorContentFormat, ContentBriefType> = {
  ARTICLE: "BLOG_POST",
  GUIDE: "PILLAR_PAGE",
  LANDING_PAGE: "LANDING_PAGE",
  FAQ_PAGE: "OTHER",
  CASE_STUDY: "OTHER",
  COMPARISON: "OTHER",
  PRODUCT_PAGE: "OTHER",
  OTHER: "OTHER",
};

export function mapCompetitorFormatToBriefType(suggested: string | null | undefined): ContentBriefType | null {
  if (!suggested) return null;
  return COMPETITOR_FORMAT_TO_BRIEF_TYPE[suggested as CompetitorContentFormat] ?? null;
}

/**
 * Composes one opportunity into the Brief's existing free-text `notes` field.
 *
 * `notes` is the right carrier because contentBriefInputSchema has no dedicated
 * topic field, and notes is already free text, already fed to the prompt, and —
 * most importantly — already visible and editable, so the user reviews this
 * context before it influences anything.
 *
 * The observation/recommendation boundary is preserved in the wording: the
 * competitor origins are labelled as pages that were actually read, while the
 * opportunity itself is labelled a recommendation. Existing coverage stays
 * hedged as a title match, because that is all `computeExistingCoverage`
 * actually establishes. No metric is ever synthesised — Compass holds no
 * ranking, traffic or backlink data for any site, so none is written here.
 */
export function buildBriefNotesFromCompetitorOpportunity(opportunity: CompetitorOpportunity, competitorOrigins: readonly string[] = []): string {
  const lines: string[] = [`Content opportunity identified from competitor analysis: ${opportunity.topic.trim()}`];

  if (competitorOrigins.length > 0) {
    lines.push(`Competitor sites reviewed (a sample of pages was read from each): ${competitorOrigins.join(", ")}`);
  }
  if (opportunity.whyItMatters.trim()) lines.push(`Why it matters: ${opportunity.whyItMatters.trim()}`);
  if (opportunity.recommendedAction.trim()) lines.push(`Recommended action: ${opportunity.recommendedAction.trim()}`);
  if (opportunity.relatedKeywords.length > 0) {
    lines.push(`Related existing keywords in this project: ${opportunity.relatedKeywords.join(", ")}`);
  }
  if (opportunity.existingCoverage.status === "POSSIBLE_MATCH" && opportunity.existingCoverage.matchedTitle) {
    lines.push(`Potential existing coverage: "${opportunity.existingCoverage.matchedTitle}" (title match only — review before writing).`);
  }

  lines.push("This opportunity is an AI recommendation based on pages read from the competitor sites named above, not a ranking or traffic measurement.");

  return lines.join("\n\n");
}

/**
 * Builds the hand-off for ONE opportunity. Returns null when the opportunity
 * has no usable topic or no project, so the caller can decline to render the
 * action rather than starting a brief from nothing.
 *
 * One brief per opportunity is deliberate: a Content Brief describes a single
 * page, and the existing Brief → Content → Long-Form workflow creates one
 * Content record from one brief.
 */
export function buildCompetitorOpportunityBriefHandoff(
  seoProjectId: string,
  opportunity: CompetitorOpportunity,
  competitorOrigins: readonly string[] = []
): BriefHandoff | null {
  if (!seoProjectId.trim() || !opportunity.topic.trim()) return null;

  const contentType = mapCompetitorFormatToBriefType(opportunity.suggestedContentType);
  return {
    seoProjectId,
    notes: buildBriefNotesFromCompetitorOpportunity(opportunity, competitorOrigins),
    ...(contentType ? { contentType } : {}),
  };
}
