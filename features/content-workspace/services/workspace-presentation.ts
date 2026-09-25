import { datedItems, planTypeLabel, undatedItems, type WorkspaceItem, type WorkspaceItemKind } from "@/features/content-workspace/services/content-calendar-feed";

/**
 * Presentation decisions for the Content Workspace, kept pure so the calendar
 * component renders them rather than deriving them inline.
 *
 * The point of pulling these out is that "what is actually happening on this
 * screen?" is a real decision tree with several honest answers, and getting it
 * wrong means telling the user something untrue — that nothing is scheduled
 * when in fact nothing has a date, or that a filter matched nothing when the
 * client simply has no content. A pure function can be tested against every
 * branch; an inline ternary cannot.
 *
 * No I/O, no React, no database.
 */

// ---------------------------------------------------------------------------
// Filter options, built from what is present
// ---------------------------------------------------------------------------

export type FilterOption = { key: string; label: string; count: number; hint?: string };

/**
 * Content-type options.
 *
 * Only planned items carry a type — the Content model has no type column — so
 * these options come exclusively from them, and the caller labels the group to
 * say so. Offering a type filter that silently applied to one of the two data
 * sources without explanation would be worse than not offering it at all.
 */
export function buildContentTypeOptions(items: readonly WorkspaceItem[]): FilterOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.contentType === null) continue;
    counts.set(item.contentType, (counts.get(item.contentType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: planTypeLabel(key), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** True when any planned item carries a type, i.e. the type filter is worth showing at all. */
export function hasTypedItems(items: readonly WorkspaceItem[]): boolean {
  return items.some((item) => item.contentType !== null);
}

// ---------------------------------------------------------------------------
// Grouping for the views
// ---------------------------------------------------------------------------

export type DayGroup = { date: string; items: WorkspaceItem[] };

/**
 * Items grouped by day, in date order, with empty days omitted.
 *
 * Agenda and Week both want this; Month wants a lookup instead (it renders
 * every cell whether or not it holds anything), which is why `groupByDate` in
 * the feed returns a Map and this returns an ordered list.
 */
export function groupIntoDays(items: readonly WorkspaceItem[]): DayGroup[] {
  const byDate = new Map<string, WorkspaceItem[]>();
  for (const item of items) {
    if (item.date === null) continue;
    const bucket = byDate.get(item.date);
    if (bucket) bucket.push(item);
    else byDate.set(item.date, [item]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayItems]) => ({
      date,
      // Pages before plans, then alphabetical — a stable order, so a re-render
      // never reshuffles the list under the reader.
      items: [...dayItems].sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "CONTENT" ? -1 : 1)),
    }));
}

/**
 * Splits a day's items into published pages and planned entries.
 *
 * Agenda shows these under separate sub-headings, because "this went out" and
 * "we intend to write this" are different statements and a chronological list
 * is exactly where they are easiest to confuse.
 */
export function splitByKind(items: readonly WorkspaceItem[]): Record<WorkspaceItemKind, WorkspaceItem[]> {
  return {
    CONTENT: items.filter((item) => item.kind === "CONTENT"),
    PLAN: items.filter((item) => item.kind === "PLAN"),
  };
}

/** A human date for headings: "Mon 12 Oct 2026". Built from the ISO string, so it needs no locale. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatDayHeading(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "Today" / "Tomorrow" / "Yesterday" where it helps, otherwise null. */
export function relativeDayLabel(iso: string, today: Date): string | null {
  const day = new Date(`${iso}T00:00:00Z`).getTime();
  const diff = Math.round((day - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return null;
}

// ---------------------------------------------------------------------------
// The empty-state decision tree
// ---------------------------------------------------------------------------

export type EmptyStateReason =
  | "NONE"
  | "CLIENT_HAS_NO_PROJECTS"
  | "CONTEXT_HAS_NOTHING"
  | "FILTERS_MATCH_NOTHING"
  | "ALL_ITEMS_UNDATED"
  | "NOTHING_IN_THIS_PERIOD";

export type EmptyState = { reason: EmptyStateReason; title: string; detail: string };

export type EmptyStateInput = {
  /** Every item the server returned for the current client/project context. */
  contextItems: readonly WorkspaceItem[];
  /** Those that survived the rail filters and search. */
  visibleItems: readonly WorkspaceItem[];
  /** Of the visible ones, those with a date that also fall inside the current period. */
  itemsInPeriod: readonly WorkspaceItem[];
  /** True when the resolved client genuinely has no live SEO project. */
  clientHasNoProjects: boolean;
  /** The period label, so the message can name what the user is looking at. */
  periodLabel: string;
  /** How the current client/project context reads, so a message can name it. */
  contextLabel: string;
};

/**
 * Works out what to tell the user when the grid has nothing on it.
 *
 * The order matters, because several of these can be true at once and only the
 * most specific one is useful. In particular `ALL_ITEMS_UNDATED` is checked
 * before `NOTHING_IN_THIS_PERIOD`: if no item has a date, saying "nothing in
 * October" would send the user hunting through months for content that can
 * never appear on any of them.
 */
export function resolveEmptyState(input: EmptyStateInput): EmptyState {
  if (input.itemsInPeriod.length > 0) {
    return { reason: "NONE", title: "", detail: "" };
  }

  if (input.contextItems.length === 0) {
    /*
     * "No SEO project" is no longer a reason to be empty — content belongs to
     * the client, so a projectless client can have plenty. The only honest
     * empty state left is that there genuinely is nothing yet, and it points
     * at what can be created rather than at a project that is not required.
     */
    return {
      reason: "CONTEXT_HAS_NOTHING",
      title: "No content yet",
      detail: input.clientHasNoProjects
        ? `${input.contextLabel} has no content yet. Use "Create content for this day" to write a social post or a blog article.`
        : `${input.contextLabel} has no content or planned items. Draft content in the SEO workspace, or plan some with the Content Calendar Assistant.`,
    };
  }

  if (input.visibleItems.length === 0) {
    return {
      reason: "FILTERS_MATCH_NOTHING",
      title: "Nothing matches these filters",
      detail: `${input.contextItems.length} item${input.contextItems.length === 1 ? "" : "s"} exist in this context. Clear or widen the filters to see them.`,
    };
  }

  const undatedCount = undatedItems(input.visibleItems).length;
  if (datedItems(input.visibleItems).length === 0) {
    return {
      reason: "ALL_ITEMS_UNDATED",
      title: "Nothing has a date yet",
      detail: `${undatedCount} item${undatedCount === 1 ? "" : "s"} ${undatedCount === 1 ? "is" : "are"} listed below. A page only appears on the calendar once it has a publish date, and scheduling arrives in a later phase.`,
    };
  }

  return {
    reason: "NOTHING_IN_THIS_PERIOD",
    title: `Nothing in ${input.periodLabel}`,
    detail: "Other periods have items — use the arrows, the mini calendar, or Agenda to find them.",
  };
}

/**
 * The note shown above the undated list, which changes with the filters so it
 * never claims to be showing more than it is.
 */
export function undatedNote(totalUndatedInContext: number, shownUndated: number): string {
  if (shownUndated === totalUndatedInContext) {
    return "These have no publish date yet, so they cannot be placed on a day.";
  }
  return `Showing ${shownUndated} of ${totalUndatedInContext} undated items — the rest are hidden by the current filters.`;
}
