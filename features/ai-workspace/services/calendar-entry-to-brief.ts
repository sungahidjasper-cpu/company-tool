import type { ContentBriefType } from "@/features/ai-workspace/schemas/content-brief.schema";
import type { CalendarContentTypeValue } from "@/features/ai-workspace/schemas/content-calendar.schema";
import type { BriefHandoff } from "@/features/ai-workspace/services/content-gap-to-brief";

/**
 * Calendar entry → Content Brief.
 *
 * Reuses `BriefHandoff` and `buildBriefHandoffHref` for the same reason the
 * Content Gap, Topic Cluster and Competitor hand-offs do: the Brief route
 * already reads exactly those query params, and a fourth mechanism would be a
 * fourth thing to keep correct.
 *
 * Pure functions only. The values carry NO authority — they are form prefills,
 * and the Brief's own action re-derives the company from the authenticated
 * actor and re-verifies the project, so a hand-crafted URL can only prefill a
 * field the user could have typed. Opening a hand-off creates nothing.
 */

/**
 * Maps the calendar's content-type vocabulary onto the Brief's enum.
 *
 * Types with no honest Brief equivalent map to OTHER rather than being forced
 * into a shape that misdescribes them — the same conservative choice the other
 * three hand-offs already made.
 */
const CALENDAR_TYPE_TO_BRIEF_TYPE: Record<CalendarContentTypeValue, ContentBriefType> = {
  ARTICLE: "BLOG_POST",
  GUIDE: "PILLAR_PAGE",
  LANDING_PAGE: "LANDING_PAGE",
  FAQ_PAGE: "OTHER",
  CASE_STUDY: "OTHER",
  COMPARISON: "OTHER",
  OTHER: "OTHER",
};

export function mapCalendarTypeToBriefType(contentType: string | null | undefined): ContentBriefType | null {
  if (!contentType) return null;
  return CALENDAR_TYPE_TO_BRIEF_TYPE[contentType as CalendarContentTypeValue] ?? null;
}

/** The parts of a saved entry a brief can legitimately be started from. */
export type CalendarEntryForBrief = {
  scheduledDate: string;
  topic: string;
  contentType: string;
  role: string;
  status?: string;
  keywordTerm: string | null;
  notes: string | null;
};

const ROLE_SENTENCE: Record<string, string> = {
  PILLAR: "This is planned as a pillar page — a broad, foundational piece that supporting pages will link back to.",
  SUPPORTING: "This is planned as a supporting page — it should cover one part of its pillar's subject in depth rather than repeating the pillar.",
  RELATED: "This is planned as a related piece that stands on its own.",
};

/**
 * Composes one calendar entry into the Brief's existing free-text `notes`
 * field.
 *
 * `notes` is the right carrier because contentBriefInputSchema has no
 * dedicated topic field, and notes is already free text, already fed to the
 * prompt, and — most importantly — already visible and editable, so the user
 * reviews this context before it influences anything.
 *
 * The planned role is included because it is the whole point of a cluster-aware
 * calendar: a brief written without knowing a page is meant to support a
 * pillar will tend to duplicate the pillar. No metric is ever synthesised.
 */
export function buildBriefNotesFromCalendarEntry(entry: CalendarEntryForBrief): string {
  const lines: string[] = [`Planned content from a content calendar: ${entry.topic.trim()}`, `Scheduled for: ${entry.scheduledDate}`];

  const roleSentence = ROLE_SENTENCE[entry.role];
  if (roleSentence) lines.push(roleSentence);

  if (entry.keywordTerm?.trim()) lines.push(`Target keyword for this page: ${entry.keywordTerm.trim()}`);
  if (entry.notes?.trim()) lines.push(`Planning notes: ${entry.notes.trim()}`);

  lines.push("The schedule this came from is a plan, not a measurement — it carries no ranking, traffic or search-volume data.");

  return lines.join("\n\n");
}

/**
 * Builds the hand-off for ONE calendar entry. Returns null when the entry has
 * no usable topic or no project, so the caller can decline to render the action
 * rather than starting a brief from nothing.
 */
export function buildCalendarEntryBriefHandoff(seoProjectId: string, entry: CalendarEntryForBrief): BriefHandoff | null {
  if (!seoProjectId.trim() || !entry.topic.trim()) return null;

  const contentType = mapCalendarTypeToBriefType(entry.contentType);
  return {
    seoProjectId,
    notes: buildBriefNotesFromCalendarEntry(entry),
    ...(contentType ? { contentType } : {}),
  };
}
