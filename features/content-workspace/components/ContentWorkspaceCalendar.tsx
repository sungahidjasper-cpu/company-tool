"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, ChevronLeft, ChevronRight, ListFilter, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CALENDAR_VIEWS,
  VIEW_LABELS,
  WEEKDAY_LABELS,
  daysInWindow,
  isInAnchorMonth,
  isSameDay,
  miniMonthRows,
  monthGridRows,
  parseAnchor,
  parseView,
  periodLabel,
  shiftAnchor,
  startOfMonth,
  todayUtc,
  windowForView,
  type CalendarView,
} from "@/features/content-workspace/services/calendar-grid";
import {
  EMPTY_FILTERS,
  KIND_LABELS,
  STATE_LABELS,
  type WorkspaceItemState,
  countBy,
  datedItems,
  filterItems,
  groupByDate,
  CONTENT_TYPE_KEYS,
  contentTypeBadge,
  planTypeLabel,
  statusKey,
  undatedItems,
  type WorkspaceFilters,
  type WorkspaceItem,
  type WorkspaceItemKind,
} from "@/features/content-workspace/services/content-calendar-feed";
import { formatIsoDate, parseIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import CreationFlowDialog from "@/features/content-workspace/components/CreationFlowDialog";
import {
  dayContext,
  isDateSelected,
  resolveDateClick,
} from "@/features/content-workspace/services/date-selection";
import {
  buildContentTypeOptions,
  formatDayHeading,
  groupIntoDays,
  relativeDayLabel,
  resolveEmptyState,
  splitByKind,
  undatedNote,
} from "@/features/content-workspace/services/workspace-presentation";
import {
  ALL_CLIENTS_SELECTION,
  NO_CLIENT_SELECTION,
  buildWorkspaceHref,
  describeSelection,
  projectsForClient,
  selectionHasNoProjects,
  serializeSelection,
  WORKSPACE_COOKIE_MAX_AGE,
  WORKSPACE_COOKIE_NAME,
  type WorkspaceSelection,
} from "@/features/content-workspace/services/workspace-context";

/** How many chips a month cell shows before collapsing the rest behind "+N more". */
export const CHIPS_PER_DAY = 3;

/** Same select styling the AI Workspace pickers use, so the context bar looks native. */
const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type ScopeOption = { id: string; name: string };

type ContentWorkspaceCalendarProps = {
  items: WorkspaceItem[];
  clients: ScopeOption[];
  projects: (ScopeOption & { clientId: string | null })[];
  hasProjectWithoutClient: boolean;
  /** The server-resolved selection. Already validated against this company. */
  selection: WorkspaceSelection;
  /** The view named in the URL, so a shared link opens where it was left. */
  initialView?: string;
  /** The period named in the URL, so switching client keeps the user's place. */
  initialDate?: string;
  /** UTC-midnight "today", resolved on the server so the first paint matches. */
  today: string;
};

/**
 * The status options the filter panel offers, built from the items actually
 * present rather than from the full enums — an option that would match
 * nothing is noise.
 *
 * Keyed by `KIND:STATUS` so a content status and a plan status can never
 * select each other, which matters because both vocabularies contain
 * "Published" and they mean different things.
 */
export function buildStatusOptions(items: readonly WorkspaceItem[]): { key: string; kind: WorkspaceItemKind; label: string; count: number }[] {
  const seen = new Map<string, { kind: WorkspaceItemKind; label: string; count: number }>();
  for (const item of items) {
    const key = statusKey(item.kind, item.status);
    const existing = seen.get(key);
    if (existing) existing.count += 1;
    else seen.set(key, { kind: item.kind, label: item.statusLabel, count: 1 });
  }
  return [...seen.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "CONTENT" ? -1 : 1));
}

/** True when any filter is narrowing the view — drives the "Clear" affordance. */
export function hasActiveFilters(filters: WorkspaceFilters): boolean {
  return (
    filters.clientIds.length > 0 ||
    filters.seoProjectIds.length > 0 ||
    filters.kinds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.search.trim() !== ""
  );
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** A chip's colour carries ONE dimension: whether it is a real page or a plan. */
/*
 * Phase 5 — four visually distinct states, not two.
 *
 * PLANNED keeps its dashed, unfilled treatment because it is not a Content
 * record at all. Among Content, SCHEDULED reads as an intention (outlined),
 * PUBLISHED as something that actually happened (solid), and DRAFT as
 * neither. Colour alone never carries the distinction — every chip also
 * prints its state label.
 */
function chipClasses(state: WorkspaceItemState): string {
  switch (state) {
    case "PLANNED":
      return "border-l-4 border-l-slate-300 border-dashed bg-white hover:bg-slate-50";
    case "SCHEDULED":
      return "border-l-4 border-l-amber-500 bg-amber-50/70 hover:bg-amber-50";
    case "PUBLISHED":
      return "border-l-4 border-l-[#2F4156] bg-slate-50 hover:bg-slate-100";
    default:
      return "border-l-4 border-l-slate-400 bg-white hover:bg-slate-50";
  }
}

/**
 * The rail's mini date-picker.
 *
 * A real top-level component, NOT a function defined inside the calendar's
 * render: it owns `useState`, and a nested definition is a fresh component
 * type on every parent render — which remounts it (losing whichever month the
 * user had navigated to) and is a known hydration hazard. Its own month is
 * local state here; jumping the main calendar is a callback out.
 */
function MiniCalendar({
  initialMonth,
  today,
  markedDates,
  onPick,
}: {
  initialMonth: Date;
  today: Date;
  markedDates: ReadonlySet<string>;
  onPick: (day: Date) => void;
}) {
  const [miniAnchor, setMiniAnchor] = useState<Date>(initialMonth);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">{periodLabel("MONTH", miniAnchor)}</p>
        <div className="flex gap-0.5">
          <button
            type="button"
            onClick={() => setMiniAnchor((c) => shiftAnchor("MONTH", c, -1))}
            className="rounded p-0.5 text-slate-500 hover:bg-slate-100"
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => setMiniAnchor((c) => shiftAnchor("MONTH", c, 1))}
            className="rounded p-0.5 text-slate-500 hover:bg-slate-100"
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="text-[10px] text-slate-400">
            {label.charAt(0)}
          </span>
        ))}
        {miniMonthRows(miniAnchor)
          .flat()
          .map((day) => {
            const key = formatIsoDate(day);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onPick(day)}
                className={cn(
                  "relative rounded py-0.5 text-[11px] hover:bg-slate-100",
                  isSameDay(day, today) && "bg-[#2F4156] font-semibold text-white hover:bg-[#2F4156]",
                  !isInAnchorMonth(day, miniAnchor) && "text-slate-300"
                )}
                aria-label={key}
              >
                {day.getUTCDate()}
                {markedDates.has(key) && <span className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-slate-400" />}
              </button>
            );
          })}
      </div>
    </div>
  );
}

export default function ContentWorkspaceCalendar({ items, clients, projects, hasProjectWithoutClient, selection, initialView, initialDate, today }: ContentWorkspaceCalendarProps) {
  const router = useRouter();
  const [isSwitching, startSwitching] = useTransition();
  const todayDate = parseIsoDate(today) ?? todayUtc();

  const [view, setView] = useState<CalendarView>(parseView(initialView));
  const [anchor, setAnchor] = useState<Date>(parseAnchor(initialDate, todayDate));
  const [filters, setFilters] = useState<WorkspaceFilters>(EMPTY_FILTERS);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<WorkspaceItem | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  /*
   * Phase 5 — the creation workflow. Opening it is navigation state and
   * nothing more: no record exists until the form it hands off to is saved.
   */
  const [creationOpen, setCreationOpen] = useState(false);

  const visible = useMemo(() => filterItems(items, filters), [items, filters]);
  const window = useMemo(() => windowForView(view, anchor), [view, anchor]);

  /** Only the dated items inside the current period reach the grid. */
  const inWindow = useMemo(() => {
    const from = formatIsoDate(window.start);
    const to = formatIsoDate(window.end);
    return datedItems(visible).filter((item) => item.date! >= from && item.date! <= to);
  }, [visible, window]);

  const byDate = useMemo(() => groupByDate(inWindow), [inWindow]);
  const undated = useMemo(() => undatedItems(visible), [visible]);

  const statusOptions = useMemo(() => buildStatusOptions(items), [items]);
  const projectCounts = useMemo(() => countBy(items, (item) => item.seoProjectId), [items]);
  const kindCounts = useMemo(() => countBy(items, (item) => item.kind), [items]);

  /*
   * Phase 2 — the client/project context.
   *
   * Changing it navigates, because the SERVER decides which projects may be
   * read. The current view rides along in the URL so switching client does
   * not silently drop the user back to Month, and the choice is echoed into a
   * cookie so returning to a bare /content lands on the same client.
   */
  const clientProjects = useMemo(() => projectsForClient(projects, selection.clientId), [projects, selection.clientId]);
  const { clientLabel, projectLabel } = useMemo(() => describeSelection(selection, { clients, projects }), [selection, clients, projects]);
  const noProjectsForClient = selectionHasNoProjects(selection, projects);

  function applySelection(next: WorkspaceSelection) {
    // A display preference only — the server re-validates it on every request.
    document.cookie = `${WORKSPACE_COOKIE_NAME}=${serializeSelection(next)}; path=/; max-age=${WORKSPACE_COOKIE_MAX_AGE}; SameSite=Lax`;
    startSwitching(() => router.push(buildWorkspaceHref(next, view, formatIsoDate(anchor))));
  }

  function changeClient(clientId: string) {
    // A project from the previous client must never survive the switch; the
    // server would drop it anyway, but the URL should not carry it.
    applySelection({ clientId, projectId: "" });
  }

  function changeProject(projectId: string) {
    applySelection({ ...selection, projectId });
  }

  /** Days in the current period that hold something, in order — Week and Agenda both read this. */
  const dayGroups = useMemo(() => groupIntoDays(inWindow), [inWindow]);

  const typeOptions = useMemo(
    () => buildContentTypeOptions(items).filter((option) => !CONTENT_TYPE_KEYS.includes(option.key)),
    [items]
  );
  const typeFilterAvailable = useMemo(() => typeOptions.length > 0, [typeOptions]);
  /** Items with no recorded type — what a type selection would hide. */
  const untypedCount = useMemo(() => items.filter((item) => item.contentType === null).length, [items]);

  /** Undated items in this context regardless of filters, so the note can be honest about what it hides. */
  const undatedInContext = useMemo(() => undatedItems(items), [items]);

  /** Dates carrying at least one visible item — computed once, not per mini-calendar cell. */
  const markedDates = useMemo(() => new Set(groupByDate(datedItems(visible)).keys()), [visible]);

  const activeFilters = hasActiveFilters(filters);

  /** What is actually happening when the grid has nothing on it. */
  const emptyState = useMemo(
    () =>
      resolveEmptyState({
        contextItems: items,
        visibleItems: visible,
        itemsInPeriod: inWindow,
        clientHasNoProjects: noProjectsForClient,
        periodLabel: periodLabel(view, anchor),
        contextLabel: clientLabel,
      }),
    [items, visible, inWindow, noProjectsForClient, view, anchor, clientLabel]
  );

  /*
   * Phase 5 (date interaction) — the ONE path a date selection takes.
   *
   * Selecting a date is navigation and context, never scheduling: this
   * function sets the anchor day and echoes it into the URL. It performs no
   * write, creates no Content, no planning entry and no publication date, and
   * resolveDateClick cannot hand it anything that would.
   *
   * The rail's mini calendar already set the anchor this way; the main grid
   * simply never called it. Both now go through here, so there is one date
   * mechanism rather than two.
   *
   * The URL echo uses globalThis.history rather than window.history: this
   * component already has a local `window` (the current date range) which
   * shadows the global one, so `window.history` does not compile. replaceState
   * is what Next supports here and it
   * integrates with its router. A router.push would re-run the server page,
   * and the feed does not depend on the date — it is loaded per project — so
   * a navigation would refetch identical data on every click. replaceState
   * keeps client, project and view in the URL (buildWorkspaceHref builds all
   * of it) so a refresh or a shared link lands on the same day.
   */
  function pickDate(day: Date, options: { openCreation?: boolean } = {}) {
    const next = resolveDateClick(view, formatIsoDate(day), formatIsoDate(anchor));
    const nextAnchor = parseIsoDate(next.anchorIso);
    if (!nextAnchor) return;

    setAnchor(nextAnchor);
    if (next.view !== view) setView(next.view);
    setExpandedDay(null);

    globalThis.history.replaceState(null, "", buildWorkspaceHref(selection, next.view, next.anchorIso));

    if (options.openCreation) setCreationOpen(true);
  }

  function goToday() {
    // Navigation only — moving to today never opens the creation workflow.
    pickDate(todayDate);
  }

  function step(direction: -1 | 1) {
    const next = shiftAnchor(view, anchor, direction);
    setAnchor(next);
    setExpandedDay(null);
    // Same single mechanism: the period the user moved to belongs in the URL.
    globalThis.history.replaceState(null, "", buildWorkspaceHref(selection, view, formatIsoDate(next)));
  }

  function changeView(next: CalendarView) {
    setView(next);
    setExpandedDay(null);
    // The view travels with the date, so switching view then refreshing keeps both.
    globalThis.history.replaceState(null, "", buildWorkspaceHref(selection, next, formatIsoDate(anchor)));
  }

  /* ----------------------------------------------------------------- chips */

  function Chip({ item }: { item: WorkspaceItem }) {
    return (
      <button
        type="button"
        onClick={() => setSelected(item)}
        className={cn("pointer-events-auto w-full min-w-0 rounded-md px-1.5 py-1 text-left text-xs transition-colors", chipClasses(item.state))}
        title={`${contentTypeBadge(item.contentType) ? `[${contentTypeBadge(item.contentType)}] ` : ""}${item.title} — ${item.statusLabel}`}
      >
        <span className="flex min-w-0 items-center gap-1">
          {/*
            The type badge is TEXT, so it survives colour-blindness, greyscale
            and print. An item whose type genuinely is not recorded shows no
            badge rather than a made-up one.
          */}
          {contentTypeBadge(item.contentType) && (
            <span className="shrink-0 rounded bg-slate-200/80 px-1 text-[9px] font-semibold tracking-wide text-slate-600">
              {contentTypeBadge(item.contentType)}
            </span>
          )}
          <span className="min-w-0 truncate font-medium text-slate-800">{item.title}</span>
        </span>
        <span className="block truncate text-[11px] text-slate-500">{item.statusLabel}</span>
      </button>
    );
  }

  function DayCell({ day }: { day: Date }) {
    const key = formatIsoDate(day);
    const dayItems = byDate.get(key) ?? [];
    const isToday = isSameDay(day, todayDate);
    const inMonth = view !== "MONTH" || isInAnchorMonth(day, anchor);
    const expanded = expandedDay === key;
    const shown = expanded ? dayItems : dayItems.slice(0, CHIPS_PER_DAY);
    const hidden = dayItems.length - shown.length;

    const selectedDay = isDateSelected(key, formatIsoDate(anchor));

    /*
     * The date hit area is a real <button> stretched behind the cell, with the
     * chips stacked above it — NOT a click handler on the cell wrapper.
     *
     * Two reasons. A wrapper handler would need the chips to stop propagation,
     * which is the classic nested-interaction bug: one missed handler and
     * opening an item also moves the date. And a div with onClick is not
     * reachable by keyboard, whereas this is tabbable and announces the day.
     * Because the button is a SIBLING of the chips rather than their ancestor,
     * a chip click cannot reach it at all.
     */
    return (
      <div
        className={cn(
          "relative flex min-h-24 min-w-0 flex-col gap-1 border-t border-slate-200 p-1.5",
          !inMonth && "bg-slate-50/60",
          selectedDay && "bg-[#2F4156]/[0.06] ring-1 ring-[#2F4156]/40 ring-inset"
        )}
      >
        <button
          type="button"
          onClick={() => pickDate(day, { openCreation: true })}
          className="absolute inset-0 z-0 cursor-pointer rounded-none focus-visible:ring-2 focus-visible:ring-[#2F4156] focus-visible:ring-inset focus-visible:outline-none"
          aria-label={`Select ${formatDayHeading(key)}`}
          aria-pressed={selectedDay}
        />

        <div className="pointer-events-none relative z-10 flex items-center justify-between">
          <span
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-full text-xs",
              isToday ? "bg-[#2F4156] font-semibold text-white" : selectedDay ? "font-semibold text-[#2F4156]" : inMonth ? "text-slate-700" : "text-slate-400"
            )}
          >
            {day.getUTCDate()}
          </span>
          {dayItems.length > 0 && <span className="text-[11px] text-slate-400">{dayItems.length}</span>}
        </div>

        {/* Same layering rule as the week row: the stack is inert, the chips are not. */}
        <div className="pointer-events-none relative z-10 flex min-w-0 flex-col gap-1">
          {shown.map((item) => (
            <Chip key={item.id} item={item} />
          ))}
          {hidden > 0 && (
            <button type="button" onClick={() => setExpandedDay(key)} className="pointer-events-auto rounded px-1 text-left text-[11px] font-medium text-slate-500 hover:text-slate-800">
              +{hidden} more
            </button>
          )}
          {expanded && dayItems.length > CHIPS_PER_DAY && (
            <button type="button" onClick={() => setExpandedDay(null)} className="pointer-events-auto rounded px-1 text-left text-[11px] font-medium text-slate-500 hover:text-slate-800">
              Show less
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- views */

  function MonthView() {
    return (
      <div className="min-w-0">
        <div className="grid grid-cols-7">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="min-w-0 truncate px-1.5 pb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-slate-200">
          {monthGridRows(anchor).flat().map((day) => (
            <DayCell key={formatIsoDate(day)} day={day} />
          ))}
        </div>
      </div>
    );
  }

  /*
   * Week — a day per ROW.
   *
   * The previous version reused the month cell across seven narrow columns,
   * which left titles unreadable at any width below a wide desktop. Rows give
   * each day the full width, so a title can be read rather than guessed at,
   * and an empty day is visibly empty instead of being an ambiguous gap.
   */
  function WeekView() {
    const days = daysInWindow(window);
    return (
      <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200">
        {days.map((day) => {
          const key = formatIsoDate(day);
          const dayItems = byDate.get(key) ?? [];
          const isToday = isSameDay(day, todayDate);
          const selectedDay = isDateSelected(key, formatIsoDate(anchor));
          /*
           * Same stacked-sibling pattern as the month cell: the day's own
           * date column is the selection target, and the item rows sit in
           * their own column above it, so selecting a day and opening an item
           * are separate targets rather than one handler guessing which was
           * meant.
           */
          return (
            <div
              key={key}
              className={cn(
                "relative flex min-w-0 flex-col gap-2 border-slate-200 p-2.5 not-last:border-b sm:flex-row sm:gap-3",
                selectedDay && "bg-[#2F4156]/[0.06] ring-1 ring-[#2F4156]/40 ring-inset"
              )}
            >
              <button
                type="button"
                onClick={() => pickDate(day, { openCreation: true })}
                className="absolute inset-0 z-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#2F4156] focus-visible:ring-inset focus-visible:outline-none"
                aria-label={`Select ${formatDayHeading(key)}`}
                aria-pressed={selectedDay}
              />
              <div className="pointer-events-none relative z-10 flex shrink-0 items-center gap-2 sm:w-32 sm:flex-col sm:items-start sm:gap-0.5">
                <span className={cn("text-xs font-semibold", isToday || selectedDay ? "text-[#2F4156]" : "text-slate-600")}>
                  {WEEKDAY_LABELS[day.getUTCDay()]} {day.getUTCDate()}
                  {isToday && " · Today"}
                </span>
                <span className="text-[11px] text-slate-400">
                  {dayItems.length === 0 ? "—" : `${dayItems.length} item${dayItems.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {/*
                pointer-events-none on the CONTAINER, auto on each item.
                The column is flex-1, so it spans the whole row: without this
                its empty space covers the date button behind it and the day
                becomes unselectable wherever an item does not sit. Only the
                items themselves take clicks.
              */}
              <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 flex-col gap-1.5">
                {dayItems.length === 0 ? (
                  <p className="text-xs text-slate-400">Nothing on this day.</p>
                ) : (
                  dayItems.map((item) => <ItemRow key={item.id} item={item} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* Day — a single day with a real heading and a count, then its items. */
  function DayView() {
    const key = formatIsoDate(anchor);
    const dayItems = byDate.get(key) ?? [];
    const relative = relativeDayLabel(key, todayDate);
    const split = splitByKind(dayItems);

    return (
      <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          {/*
            Siblings, not a nested span: inside one <p> the date and the badge
            run together in the text content ("Tue 8 Sep 2026Today"), which a
            screen reader reads as one word and a copy-paste reproduces. The
            margin only fixed the appearance.
          */}
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-sm font-semibold text-slate-800">{formatDayHeading(key)}</p>
            {relative && <span className="text-xs font-medium text-[#2F4156]">{relative}</span>}
          </div>
          <p className="text-xs text-slate-500">
            {dayItems.length === 0
              ? "Nothing on this day"
              : `${split.CONTENT.length} content · ${split.PLAN.length} planned`}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 p-3">
          {dayItems.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing is dated on this day. Use the arrows or the mini calendar to look at another day, or switch to Agenda to see what is coming.
            </p>
          ) : (
            dayItems.map((item) => <ItemRow key={item.id} item={item} />)
          )}
        </div>
      </div>
    );
  }

  /*
   * Agenda — the clearest chronological reading, and the only view where the
   * two data sources are separated under their own sub-headings.
   *
   * A flat chronological list is exactly where "this was published" and "we
   * intend to write this" are easiest to conflate, so here they are split
   * rather than merely coloured differently.
   */
  function AgendaView() {
    if (dayGroups.length === 0) return null;

    return (
      <div className="flex min-w-0 flex-col gap-4">
        {dayGroups.map((group) => {
          const relative = relativeDayLabel(group.date, todayDate);
          const split = splitByKind(group.items);
          return (
            <div key={group.date} className="flex min-w-0 flex-col gap-2">
              {/*
                The heading is the selection target here. Agenda already shows
                every day at once, so selecting a date without moving anywhere
                would look like nothing happened — resolveDateClick therefore
                sends Agenda to the Day view for the date that was chosen.
              */}
              <div className="flex flex-wrap items-baseline gap-2 border-b border-slate-200 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    const day = parseIsoDate(group.date);
                    if (day) pickDate(day);
                  }}
                  className="rounded text-left text-sm font-semibold text-slate-800 hover:underline focus-visible:ring-2 focus-visible:ring-[#2F4156] focus-visible:outline-none"
                  title={`Open ${formatDayHeading(group.date)}`}
                >
                  {formatDayHeading(group.date)}
                </button>
                {relative && <span className="text-xs font-medium text-[#2F4156]">{relative}</span>}
                <span className="ml-auto text-xs text-slate-400">
                  {group.items.length} item{group.items.length === 1 ? "" : "s"}
                </span>
              </div>

              {split.CONTENT.length > 0 && (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Content published</p>
                  {split.CONTENT.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </div>
              )}

              {split.PLAN.length > 0 && (
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Planned</p>
                  {split.PLAN.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /*
   * The selected day's context.
   *
   * This is what makes a date click useful rather than decorative: it names
   * the day, says what is on it, and links to the records that are already
   * there. It creates nothing. The scheduling block below it is deliberately
   * control-free — see SCHEDULING_FROM_DATE_UNAVAILABLE for why there is
   * nothing a button could write yet.
   *
   * In DAY view the items are already listed by the view itself, so the panel
   * shows the summary and the scheduling path without repeating the list.
   */
  function SelectedDayPanel() {
    const context = dayContext(formatIsoDate(anchor), visible, todayDate);

    return (
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Selected date</p>
          <p className="text-sm font-semibold text-slate-800">{context.heading}</p>
          {context.relativeLabel && <span className="text-xs font-medium text-[#2F4156]">{context.relativeLabel}</span>}
          <span className="ml-auto text-xs text-slate-500">
            {context.isEmpty ? context.emptyNote : `${context.contentCount} content · ${context.planCount} planned`}
          </span>
        </div>

        {!context.isEmpty && view !== "DAY" && (
          <div className="flex min-w-0 flex-col gap-1.5">
            {context.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {view !== "DAY" && (
            <Button type="button" variant="outline" size="sm" onClick={() => changeView("DAY")}>
              Open this day
            </Button>
          )}
          {!isSameDay(anchor, todayDate) && (
            <Button type="button" variant="outline" size="sm" onClick={goToday}>
              Back to today
            </Button>
          )}
        </div>

        {/*
          Phase 5 — the real entry into creation for this day. Every view
          reaches it here, so Day view has the same clear action as a cell
          click gives Month and Week.
        */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <Button type="button" size="sm" onClick={() => setCreationOpen(true)}>
            <Plus size={15} /> Create content for this day
          </Button>
          <p className="text-xs text-slate-500">Choose a time, then what to create. Nothing is saved until you finish.</p>
        </div>
      </div>
    );
  }

  /** The small "Content" / "Planned" marker that keeps the two sources distinct everywhere. */
  function KindBadge({ item }: { item: WorkspaceItem }) {
    const state = item.state;
    return (
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
          state === "PLANNED"
            ? "border border-dashed border-slate-300 bg-white text-slate-500"
            : state === "SCHEDULED"
              ? "border border-amber-300 bg-amber-100 text-amber-800"
              : state === "PUBLISHED"
                ? "bg-[#2F4156] text-white"
                : "border border-slate-300 bg-white text-slate-600"
        )}
      >
        {STATE_LABELS[state]}
      </span>
    );
  }

  function ItemRow({ item }: { item: WorkspaceItem }) {
    return (
      <button
        type="button"
        onClick={() => setSelected(item)}
        className={cn("pointer-events-auto flex w-full min-w-0 items-start gap-2.5 rounded-lg p-2.5 text-left transition-colors", chipClasses(item.state))}
      >
        <KindBadge item={item} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-slate-800">{item.title}</span>
          <span className="block truncate text-xs text-slate-500">
            {item.statusLabel} · {item.seoProjectName}
            {item.contentType ? ` · ${planTypeLabel(item.contentType)}` : ""}
            {item.detail.keywordTerm ? ` · ${item.detail.keywordTerm}` : ""}
          </span>
        </span>
        {item.date && <span className="shrink-0 text-xs whitespace-nowrap text-slate-400">{item.date.slice(5)}</span>}
      </button>
    );
  }

  /* --------------------------------------------------------------- filters */

  function FilterGroup({
    title,
    options,
    selectedValues,
    onToggle,
  }: {
    title: string;
    options: { key: string; label: string; count: number; hint?: string }[];
    selectedValues: string[];
    onToggle: (value: string) => void;
  }) {
    if (options.length === 0) return null;
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
        <div className="flex flex-col gap-1">
          {options.map((option) => (
            <label key={option.key} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 shrink-0 rounded border-input accent-[#2F4156] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                checked={selectedValues.includes(option.key)}
                onChange={() => onToggle(option.key)}
              />
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {option.label}
                {option.hint && <span className="text-slate-400"> {option.hint}</span>}
              </span>
              <span className="text-xs text-slate-400">{option.count}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }


  function FilterPanel() {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Refine</p>
          <p className="text-[11px] leading-snug text-slate-400">
            Narrows the {clientLabel === "All clients" ? "workspace" : clientLabel} view chosen above. It never shows content from outside it.
          </p>
        </div>

        <div className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input
            id="workspaceSearch"
            value={filters.search}
            onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
            placeholder="Search titles, projects, keywords, notes"
            className="pl-8"
            aria-label="Search content"
          />
        </div>

        <FilterGroup
          title="Type"
          options={[
            { key: "CONTENT", label: "Content pages", count: kindCounts.get("CONTENT") ?? 0 },
            { key: "PLAN", label: "Planned items", count: kindCounts.get("PLAN") ?? 0 },
          ]}
          selectedValues={filters.kinds}
          onToggle={(value) => setFilters((c) => ({ ...c, kinds: toggle(c.kinds, value) as WorkspaceItemKind[] }))}
        />

        {/*
          The rail NARROWS whatever the context bar has already chosen; it never
          widens it. Saying so explicitly is what keeps the two project controls
          from reading as duplicates of one another.
        */}
        <FilterGroup
          title="Narrow by project"
          options={clientProjects.map((project) => ({ key: project.id, label: project.name, count: projectCounts.get(project.id) ?? 0 }))}
          selectedValues={filters.seoProjectIds}
          onToggle={(value) => setFilters((c) => ({ ...c, seoProjectIds: toggle(c.seoProjectIds, value) }))}
        />

        {/*
          Content type is a real field on Content now, so this filter applies
          to social posts, blog articles and SEO content — not just planned
          items. It NARROWS only: an item whose type was never recorded cannot
          satisfy a type restriction and drops out, which is why the note below
          says so instead of leaving that to be discovered.
        */}
        {typeFilterAvailable && (
          <div className="flex flex-col gap-1">
            {/*
              PLANNED item types only (Article, Guide, Landing page…). Real
              content types moved to the context bar above; this group used to
              mix both vocabularies in one list, so "Social post" sat beside
              "Guide" as though they were the same kind of thing.
            */}
            <FilterGroup
              title="Planned item type"
              options={typeOptions}
              selectedValues={filters.contentTypes}
              onToggle={(value) => setFilters((c) => ({ ...c, contentTypes: toggle(c.contentTypes, value) }))}
            />
            {untypedCount > 0 && (
              <p className="text-[11px] leading-snug text-slate-400">
                {untypedCount} older {untypedCount === 1 ? "item has" : "items have"} no recorded type and are hidden while a type is
                selected.
              </p>
            )}
          </div>
        )}

        <FilterGroup
          title="Status"
          options={statusOptions.map((option) => ({
            key: option.key,
            label: option.label,
            count: option.count,
            hint: option.kind === "PLAN" ? "(plan)" : "(page)",
          }))}
          selectedValues={filters.statuses}
          onToggle={(value) => setFilters((c) => ({ ...c, statuses: toggle(c.statuses, value) }))}
        />

        {activeFilters && (
          <Button type="button" variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------------ page */

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/*
        Client/workspace context. Kept above the calendar toolbar so the
        question "whose content am I looking at?" is answered before anything
        else on the page.
      */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="workspaceClient" className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <Building2 size={13} /> Client
          </label>
          <select id="workspaceClient" className={selectClassName} value={selection.clientId} disabled={isSwitching} onChange={(e) => changeClient(e.target.value)}>
            <option value={ALL_CLIENTS_SELECTION}>All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
            {hasProjectWithoutClient && <option value={NO_CLIENT_SELECTION}>No client assigned</option>}
          </select>
        </div>

        {/*
          CONTENT TYPE sits between the client and the optional project,
          because that is the hierarchy: whose content, what kind, and only
          then which project. It drives the SAME filters.contentTypes state
          the panel used to own — one control per question, not two.
        */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="workspaceContentType" className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Content type
          </label>
          <select
            id="workspaceContentType"
            className={selectClassName}
            value={filters.contentTypes.find((value) => CONTENT_TYPE_KEYS.includes(value)) ?? ""}
            disabled={isSwitching}
            onChange={(event) => {
              const chosen = event.target.value;
              setFilters((current) => ({
                ...current,
                // Replace any content-type selection; leave plan-type ones alone.
                contentTypes: [
                  ...current.contentTypes.filter((value) => !CONTENT_TYPE_KEYS.includes(value)),
                  ...(chosen === "" ? [] : [chosen]),
                ],
              }));
            }}
          >
            <option value="">All content</option>
            {CONTENT_TYPE_KEYS.map((key) => (
              <option key={key} value={key}>
                {planTypeLabel(key)}
              </option>
            ))}
          </select>
        </div>

        {/*
          The SEO project NARROWS the client's content — it is not the thing
          that makes content visible. With no projects there is nothing to
          narrow by, so the control is replaced by a plain sentence rather
          than a dropdown whose only option says "none".
        */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="workspaceProject" className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            SEO project <span className="font-normal normal-case">(optional filter)</span>
          </label>
          {clientProjects.length === 0 ? (
            <p id="workspaceProject" className="px-2.5 py-1.5 text-sm text-slate-500">
              No SEO projects — social and blog content is unaffected.
            </p>
          ) : (
            <select
              id="workspaceProject"
              className={selectClassName}
              value={selection.projectId}
              disabled={isSwitching}
              onChange={(e) => changeProject(e.target.value)}
            >
              <option value="">{`All projects (${clientProjects.length})`}</option>
              {clientProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <p className="min-w-0 text-xs text-slate-500 sm:max-w-56 sm:text-right">
          Showing <span className="font-medium text-slate-700">{clientLabel}</span>
          {" · "}
          <span className="font-medium text-slate-700">{projectLabel}</span>
        </p>
      </div>

      {/*
        Having no SEO project is a perfectly valid state for a client: social
        and blog content never needed one. This used to be an amber warning
        saying "there is nothing to show here", which was both alarming and
        untrue — the client can have plenty of content. It is now a quiet
        statement of fact about what the project filter can do.
      */}
      {noProjectsForClient && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          {clientLabel} has no SEO projects. Social and blog content can still be created and shown here — an SEO project is only needed for
          keyword-driven work.
        </p>
      )}

      {/* Toolbar: period + navigation on the left, views + filters on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <div className="flex">
            <Button type="button" variant="outline" size="icon" className="rounded-r-none" onClick={() => step(-1)} aria-label="Previous period">
              <ChevronLeft size={16} />
            </Button>
            <Button type="button" variant="outline" size="icon" className="-ml-px rounded-l-none" onClick={() => step(1)} aria-label="Next period">
              <ChevronRight size={16} />
            </Button>
          </div>
          <p className="truncate text-sm font-semibold text-slate-800">{periodLabel(view, anchor)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex" role="group" aria-label="Calendar view">
            {CALENDAR_VIEWS.map((option, index) => (
              <Button
                key={option}
                type="button"
                variant={view === option ? "default" : "outline"}
                size="sm"
                aria-pressed={view === option}
                className={cn(index > 0 && "-ml-px", index === 0 && "rounded-r-none", index === CALENDAR_VIEWS.length - 1 && "rounded-l-none", index > 0 && index < CALENDAR_VIEWS.length - 1 && "rounded-none")}
                onClick={() => changeView(option)}
              >
                {VIEW_LABELS[option]}
              </Button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="xl:hidden" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <ListFilter size={16} /> Filters{activeFilters ? " ·" : ""}
          </Button>
        </div>
      </div>

      {/* Calendar + right rail. The rail collapses under the calendar below xl. */}
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          {/*
            Month and Week always render their grid — an empty week is
            meaningful in itself. Day and Agenda carry their own emptiness, so
            the resolved message below covers the rest.
          */}
          {view === "MONTH" && <MonthView />}
          {view === "WEEK" && <WeekView />}
          {view === "DAY" && <DayView />}
          {view === "AGENDA" && <AgendaView />}

          {/*
            One resolved message, rather than a chain of inline conditions —
            several of these can be true at once and only the most specific is
            useful. Suppressed in Day view, which states its own emptiness in
            place, and when the message would merely repeat the client notice
            already shown above the toolbar.
          */}
          {emptyState.reason !== "NONE" && view !== "DAY" && emptyState.reason !== "CLIENT_HAS_NO_PROJECTS" && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-800">{emptyState.title}</p>
              <p className="mt-1 text-sm text-slate-600">{emptyState.detail}</p>
              {emptyState.reason === "FILTERS_MATCH_NOTHING" && (
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </Button>
              )}
              {emptyState.reason === "NOTHING_IN_THIS_PERIOD" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={goToday}>
                    Go to today
                  </Button>
                  {view !== "AGENDA" && (
                    <Button type="button" variant="outline" size="sm" onClick={() => changeView("AGENDA")}>
                      Show agenda
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/*
            Content with no publish date has no honest place on the grid, so it
            is listed here instead of being dropped or placed on a guessed day.
          */}
          <SelectedDayPanel />

          {undated.length > 0 && (
            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">Not on the calendar ({undated.length})</p>
                <p className="text-xs text-slate-500">{undatedNote(undatedInContext.length, undated.length)}</p>
              </div>
              <div className="flex flex-col gap-2">
                {undated.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}


        </div>

        <aside className={cn("w-full shrink-0 flex-col gap-5 xl:flex xl:w-72", showFilters ? "flex" : "hidden xl:flex")}>
          <div className="rounded-xl border border-slate-200 p-3">
            <MiniCalendar
              initialMonth={startOfMonth(todayDate)}
              today={todayDate}
              markedDates={markedDates}
              onPick={(day) => {
                setAnchor(day);
                setExpandedDay(null);
              }}
            />
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <FilterPanel />
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Planning</p>
            <p className="mt-1 text-xs text-slate-500">Planned items come from saved content calendars.</p>
            <Link href="/ai/content-calendar" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">
              Open Content Calendar Assistant →
            </Link>
          </div>
        </aside>
      </div>

      {/* Read-only detail panel. Every action here is navigation. */}
      <CreationFlowDialog
        key={`${creationOpen}-${formatIsoDate(anchor)}`}
        open={creationOpen}
        dateIso={formatIsoDate(anchor)}
        projects={clientProjects.map((project) => ({ id: project.id, name: project.name }))}
        selectedProjectId={selection.projectId}
        clientId={selection.clientId}
        onClose={() => setCreationOpen(false)}
      />

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/20" role="dialog" aria-modal="true" aria-label="Item details">
          <div className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{KIND_LABELS[selected.kind]}</p>
                <p className="font-semibold break-words text-slate-900">{selected.title}</p>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => setSelected(null)} aria-label="Close details">
                <X size={16} />
              </Button>
            </div>

            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Status</dt>
                <dd className="text-right font-medium text-slate-800">{selected.statusLabel}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{selected.dateLabel ?? "Date"}</dt>
                <dd className="text-right font-medium text-slate-800">{selected.date ?? "No date yet"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">SEO project</dt>
                <dd className="text-right font-medium text-slate-800">{selected.seoProjectName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Client</dt>
                <dd className="text-right font-medium text-slate-800">{selected.clientName ?? "No client"}</dd>
              </div>
              {selected.contentType && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Content type</dt>
                  <dd className="text-right font-medium text-slate-800">{planTypeLabel(selected.contentType)}</dd>
                </div>
              )}
              {selected.detail.role && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Planned role</dt>
                  <dd className="text-right font-medium text-slate-800">{selected.detail.role}</dd>
                </div>
              )}
              {selected.detail.keywordTerm && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Target keyword</dt>
                  <dd className="text-right font-medium text-slate-800">{selected.detail.keywordTerm}</dd>
                </div>
              )}
              {selected.detail.calendarName && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">From calendar</dt>
                  <dd className="text-right font-medium text-slate-800">{selected.detail.calendarName}</dd>
                </div>
              )}
              {selected.detail.lastModified && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Last modified</dt>
                  <dd className="text-right font-medium text-slate-800">{selected.detail.lastModified}</dd>
                </div>
              )}
              {selected.detail.url && (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Live URL</dt>
                  <dd className="min-w-0 text-right">
                    <span className="break-all text-slate-800">{selected.detail.url}</span>
                  </dd>
                </div>
              )}
            </dl>

            {selected.detail.notes && (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Planning notes</p>
                <p className="text-sm text-slate-600">{selected.detail.notes}</p>
              </div>
            )}

            <p className="text-xs text-slate-400">
              This workspace is read-only for now. Scheduling, editing and creating content arrive in a later phase.
            </p>

            <div className="mt-auto flex flex-col gap-2">
              <Link href={selected.href} className="w-full">
                <Button type="button" className="w-full">
                  {selected.kind === "CONTENT" ? "Open content" : selected.href.includes("/content/") ? "Open linked content" : "Open saved calendar"}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small helper re-exported for the page's empty state. */
export function WorkspaceEmptyIcon() {
  return <CalendarDays size={20} />;
}
