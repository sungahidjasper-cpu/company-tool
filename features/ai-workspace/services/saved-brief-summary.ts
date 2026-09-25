/**
 * Phase C3 — a defensive read of the brief a Content row already carries in
 * its `aiBriefDetails` JSON column.
 *
 * Pure and read-only: no I/O, no state, no writes, no AI, and no new model.
 * `aiBriefDetails` is an untyped Json column written by
 * saveContentBriefAction/saveLongFormAsNewContentAction, so every field is
 * checked rather than trusted — the same discipline buildBriefFromContentRow
 * already applies when it reconstructs a brief for the long-form route.
 *
 * This exists because the saved brief was previously invisible once the user
 * left the Brief screen: only the long-form route ever read it. Surfacing it
 * on the Content record is what lets a user return later and see what the
 * content is meant to be — which is also the honest answer to "where did this
 * come from", since the opportunity text itself is generation input and is
 * deliberately not persisted (see the C1 spec's provenance note).
 */

export type SavedBriefSummary = {
  outline: string[];
  suggestedHeadings: string[];
  seoRecommendations: string[];
  keyTakeaways: string[];
  suggestedSearchIntent: string;
};

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

/**
 * Returns null when the row carries no usable brief — a manually-authored
 * row, a pre-Phase-15 row, or a malformed column. Callers render nothing in
 * that case rather than an empty shell.
 */
export function readSavedBriefSummary(aiBriefDetails: unknown): SavedBriefSummary | null {
  if (!aiBriefDetails || typeof aiBriefDetails !== "object" || Array.isArray(aiBriefDetails)) return null;
  const raw = aiBriefDetails as Record<string, unknown>;

  const summary: SavedBriefSummary = {
    outline: readStringArray(raw, "outline"),
    suggestedHeadings: readStringArray(raw, "suggestedHeadings"),
    seoRecommendations: readStringArray(raw, "seoRecommendations"),
    keyTakeaways: readStringArray(raw, "keyTakeaways"),
    suggestedSearchIntent: typeof raw.suggestedSearchIntent === "string" ? raw.suggestedSearchIntent.trim() : "",
  };

  const hasAnything =
    summary.outline.length > 0 ||
    summary.suggestedHeadings.length > 0 ||
    summary.seoRecommendations.length > 0 ||
    summary.keyTakeaways.length > 0 ||
    summary.suggestedSearchIntent.length > 0;

  return hasAnything ? summary : null;
}

/**
 * The workflow state a Content row is in, derived entirely from columns the
 * row already has — no workflow table, no stored status, nothing to keep in
 * sync. Used to label the record and to decide which next action is honest to
 * offer: an action is never shown when its required input does not exist.
 */
export type ContentWorkflowStage = "BRIEF_ONLY" | "HAS_ARTICLE" | "MANUAL";

export function deriveContentWorkflowStage(content: { generatedByAi: boolean; body: string | null; aiBriefDetails: unknown }): ContentWorkflowStage {
  const hasBody = typeof content.body === "string" && content.body.trim().length > 0;
  if (hasBody) return "HAS_ARTICLE";
  if (content.generatedByAi && readSavedBriefSummary(content.aiBriefDetails) !== null) return "BRIEF_ONLY";
  return "MANUAL";
}
