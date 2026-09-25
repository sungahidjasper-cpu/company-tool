/**
 * Phase 5 (date interaction slice) — what clicking a calendar date MEANS.
 *
 * Pure and read-only: no I/O, no state, no writes, no AI. Every function here
 * returns navigation/context only. That is the point of the module: date
 * selection is navigation, scheduling is an explicit separate action, and
 * keeping the two apart in code is what guarantees that clicking 20 September
 * can never turn a draft into something scheduled.
 *
 * There is deliberately NO second date-state mechanism. The workspace already
 * has exactly one — the `anchor` day, echoed into the `date=` URL parameter by
 * buildWorkspaceHref (Phase 3) and already set by the rail's mini calendar.
 * These helpers describe how the main grid joins that same mechanism.
 */

import { formatIsoDate, parseIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { type CalendarView } from "@/features/content-workspace/services/calendar-grid";
import { groupByDate, type WorkspaceItem } from "@/features/content-workspace/services/content-calendar-feed";
import { formatDayHeading, relativeDayLabel, splitByKind } from "@/features/content-workspace/services/workspace-presentation";

/**
 * The complete result of a date click. Navigation only — an anchor day and
 * the view to show it in.
 *
 * The shape is the guard: there is no field here for creating, scheduling or
 * publishing anything, so a caller cannot accidentally be handed one.
 */
export type DateClickResult = {
  anchorIso: string;
  view: CalendarView;
};

/**
 * Clicking a date in each view.
 *
 * - MONTH and WEEK keep their view: the user is scanning a period and has
 *   picked a day inside it, not asked to leave.
 * - AGENDA moves to DAY. An agenda heading that selected a date and stayed put
 *   would appear to do nothing, since Agenda shows every day at once.
 * - DAY keeps DAY. The day is already the view, so a date interaction there
 *   must not surprise the user by moving somewhere else.
 *
 * An unparseable date is refused by returning the current anchor unchanged,
 * so a malformed value can never blank the calendar.
 */
export function resolveDateClick(view: CalendarView, dayIso: string, currentAnchorIso: string): DateClickResult {
  const day = parseIsoDate(dayIso);
  if (!day) return { anchorIso: currentAnchorIso, view };
  return { anchorIso: formatIsoDate(day), view: view === "AGENDA" ? "DAY" : view };
}

/** Whether a grid cell is the selected day. Compared as ISO strings, so no timezone can shift it. */
export function isDateSelected(dayIso: string, anchorIso: string): boolean {
  return dayIso === anchorIso;
}

/**
 * What is actually on the selected day.
 *
 * Content and planned items stay counted separately, for the same reason they
 * are separated everywhere else in this workspace: "this was published" and
 * "we intend to write this" must never read as one number.
 */
export type DayContext = {
  date: string;
  heading: string;
  /** "Today" / "Tomorrow" / "Yesterday", or null. */
  relativeLabel: string | null;
  items: WorkspaceItem[];
  contentCount: number;
  planCount: number;
  isEmpty: boolean;
  /** Honest one-liner for the panel when the day holds nothing. */
  emptyNote: string;
};

export function dayContext(dayIso: string, items: readonly WorkspaceItem[], today: Date): DayContext {
  const onDay = groupByDate(items.filter((item) => item.date !== null)).get(dayIso) ?? [];
  const split = splitByKind(onDay);
  return {
    date: dayIso,
    heading: formatDayHeading(dayIso),
    relativeLabel: relativeDayLabel(dayIso, today),
    items: onDay,
    contentCount: split.CONTENT.length,
    planCount: split.PLAN.length,
    isEmpty: onDay.length === 0,
    /*
     * Deliberately does NOT invite creating anything. An empty day in this
     * workspace is a fact about the data, not a prompt — offering "add content
     * here" would be the fabrication this phase exists to avoid.
     */
    emptyNote: "Nothing is dated on this day.",
  };
}

/**
 * Why scheduling cannot be offered from a selected date yet.
 *
 * Stated rather than hidden, following the Content Detail page's "Not
 * available yet" precedent: a user who selects a date and finds no way to
 * schedule needs to know whether that is a missing feature or a missing
 * permission. This is the former, and it is a *model* gap: Content has no
 * scheduled date and ContentStatus has no SCHEDULED value, so there is
 * nothing for a control to write.
 *
 * When that foundation exists, this is the one place the copy changes.
 */
export const SCHEDULING_FROM_DATE_UNAVAILABLE =
  "Scheduling is not available yet. Content records have no scheduled date, so a date can be selected for context but nothing can be scheduled onto it. A publish date is recorded only once content is actually published.";

/**
 * What the day panel may legitimately offer today.
 *
 * Only navigation into records that already exist. No creation, no
 * scheduling, no publishing — so the panel cannot grow a control that writes
 * without this list changing first.
 */
export const DAY_PANEL_ACTIONS = ["OPEN_EXISTING_ITEM"] as const;
export type DayPanelAction = (typeof DAY_PANEL_ACTIONS)[number];
