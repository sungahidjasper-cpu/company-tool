import { formatIsoDate, parseIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";

/**
 * Pure calendar geometry for the Content Workspace.
 *
 * Every date here is UTC midnight, reusing `parseIsoDate` / `formatIsoDate`
 * from the Content Calendar Assistant's schema rather than introducing a
 * second date convention — the two features must agree on what a day is.
 *
 * No I/O, no React, no database. All of it is directly unit-testable, which
 * matters because the grid is where an off-by-one day would be invisible in
 * review but obvious to a user.
 */

export const CALENDAR_VIEWS = ["MONTH", "WEEK", "DAY", "AGENDA"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const VIEW_LABELS: Record<CalendarView, string> = {
  MONTH: "Month",
  WEEK: "Week",
  DAY: "Day",
  AGENDA: "Agenda",
};

/** Sunday-first, matching the calendar conventions already used in this app's US-oriented data. */
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const MS_PER_DAY = 86_400_000;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** UTC midnight for "today", so the grid never shifts a day by timezone. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function addMonths(date: Date, months: number): Date {
  const shifted = new Date(date.getTime());
  const targetDay = shifted.getUTCDate();
  // Move to the 1st before shifting so 31 January + 1 month cannot roll into
  // March; the day is re-applied afterwards, clamped to the month's length.
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(targetDay, lastDay));
  return shifted;
}

export function startOfWeek(date: Date): Date {
  return addDays(date, -date.getUTCDay());
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export type DateWindow = { start: Date; end: Date };

/**
 * The inclusive date window a view covers.
 *
 * MONTH deliberately extends to whole weeks, so the grid is always a complete
 * rectangle and the leading/trailing days of adjacent months are real dates
 * rather than blanks. AGENDA looks forward from the anchor across a rolling
 * window, which is what makes it useful as a "what's coming" list rather than
 * a second month view.
 */
export const AGENDA_DAYS = 60;

export function windowForView(view: CalendarView, anchor: Date): DateWindow {
  if (view === "DAY") return { start: anchor, end: anchor };
  if (view === "WEEK") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 6) };
  }
  if (view === "AGENDA") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, AGENDA_DAYS - 1) };
  }
  const gridStart = startOfWeek(startOfMonth(anchor));
  const monthEnd = endOfMonth(anchor);
  const gridEnd = addDays(startOfWeek(monthEnd), 6);
  return { start: gridStart, end: gridEnd };
}

/** Every day in the window, in order. */
export function daysInWindow(window: DateWindow): Date[] {
  const days: Date[] = [];
  for (let cursor = window.start; cursor.getTime() <= window.end.getTime(); cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

/** The month grid as rows of seven days. */
export function monthGridRows(anchor: Date): Date[][] {
  const days = daysInWindow(windowForView("MONTH", anchor));
  const rows: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return rows;
}

/** Moving the anchor by one period in either direction. */
export function shiftAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === "DAY") return addDays(anchor, direction);
  if (view === "WEEK") return addDays(anchor, direction * 7);
  if (view === "AGENDA") return addDays(anchor, direction * AGENDA_DAYS);
  return addMonths(anchor, direction);
}

/** The label shown in the toolbar for the current period. */
export function periodLabel(view: CalendarView, anchor: Date): string {
  const month = MONTH_NAMES[anchor.getUTCMonth()];
  const year = anchor.getUTCFullYear();

  if (view === "MONTH") return `${month} ${year}`;
  if (view === "DAY") return `${month} ${anchor.getUTCDate()}, ${year}`;

  const window = windowForView(view, anchor);
  const startMonth = MONTH_NAMES[window.start.getUTCMonth()];
  const endMonth = MONTH_NAMES[window.end.getUTCMonth()];

  if (window.start.getUTCFullYear() !== window.end.getUTCFullYear()) {
    return `${startMonth} ${window.start.getUTCDate()}, ${window.start.getUTCFullYear()} – ${endMonth} ${window.end.getUTCDate()}, ${window.end.getUTCFullYear()}`;
  }
  if (startMonth === endMonth) {
    return `${startMonth} ${window.start.getUTCDate()} – ${window.end.getUTCDate()}, ${year}`;
  }
  return `${startMonth} ${window.start.getUTCDate()} – ${endMonth} ${window.end.getUTCDate()}, ${window.end.getUTCFullYear()}`;
}

/** True when the day belongs to the anchor's own month — used to dim adjacent-month cells. */
export function isInAnchorMonth(day: Date, anchor: Date): boolean {
  return day.getUTCMonth() === anchor.getUTCMonth() && day.getUTCFullYear() === anchor.getUTCFullYear();
}

/** The mini date-picker's own grid: always exactly the anchor month's weeks. */
export function miniMonthRows(anchor: Date): Date[][] {
  return monthGridRows(anchor);
}

/** Round-trips an anchor through the URL as a plain `yyyy-MM-dd` string, falling back to today. */
export function parseAnchor(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  return parseIsoDate(raw) ?? fallback;
}

export function serializeAnchor(anchor: Date): string {
  return formatIsoDate(anchor);
}

/** Validates a view coming from the URL; anything unrecognised falls back to Month. */
export function parseView(raw: string | undefined): CalendarView {
  if (!raw) return "MONTH";
  const upper = raw.toUpperCase();
  return (CALENDAR_VIEWS as readonly string[]).includes(upper) ? (upper as CalendarView) : "MONTH";
}
