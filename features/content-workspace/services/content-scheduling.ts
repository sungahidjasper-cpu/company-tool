/**
 * Phase 5 — the scheduling foundation.
 *
 * Pure and read-only: no I/O, no state, no writes. Everything that decides
 * whether a schedule is valid, what instant it means, and how it should read
 * back to a human lives here, so the server action and the UI cannot disagree
 * about any of it.
 *
 * TIMEZONE STRATEGY
 * -----------------
 * The user picks a WALL TIME ("8 September 2026, 10:00") and a ZONE
 * ("Europe/London"). Two things are then stored:
 *
 *   scheduledAt        the exact instant, in UTC
 *   scheduledTimezone  the IANA zone that was chosen
 *
 * Storing both is the point. The instant alone would be redisplayed in
 * whatever zone the reader happens to be in, silently reinterpreting the
 * time the user chose; the wall time alone would not identify a real moment.
 * Keeping the zone means the intended local time can always be shown exactly
 * as it was chosen, to anyone, anywhere.
 *
 * Conversion uses Intl rather than a date library, because no timezone
 * package is installed and adding a dependency for two functions is not
 * warranted. Intl's zone database is the platform's own.
 */

import type { ContentStatus } from "@/lib/generated/prisma/enums";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Whether a string is a timezone this runtime actually knows. Never trusts the caller. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The offset, in milliseconds, of `timeZone` at a given instant.
 *
 * Derived by asking Intl what the wall clock reads in that zone at that
 * instant and comparing it with UTC — which is how the offset is discovered
 * without shipping a zone database.
 */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));

  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  // en-US with hour12:false can report midnight as hour 24.
  const hour = read("hour") % 24;
  const asIfUtc = Date.UTC(read("year"), read("month") - 1, read("day"), hour, read("minute"), read("second"));
  return asIfUtc - instantMs;
}

/**
 * A wall time in a zone → the instant it names.
 *
 * Two passes: the first offset is looked up by treating the wall time as if
 * it were UTC, the second re-checks the offset at the instant that produced.
 * They differ only across a DST transition, which is exactly when a single
 * pass would be an hour wrong.
 *
 * Returns null for anything malformed, so a hand-edited value cannot become
 * a real schedule.
 */
export function zonedWallTimeToInstant(dateIso: string, time: string, timeZone: string): Date | null {
  if (!DATE_PATTERN.test(dateIso) || !TIME_PATTERN.test(time) || !isValidTimeZone(timeZone)) return null;

  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  // Reject a date the calendar does not have (e.g. 2026-02-31).
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const wall = new Date(wallMs);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) return null;

  const firstOffset = zoneOffsetMs(wallMs, timeZone);
  let instantMs = wallMs - firstOffset;
  const secondOffset = zoneOffsetMs(instantMs, timeZone);
  if (secondOffset !== firstOffset) instantMs = wallMs - secondOffset;

  return new Date(instantMs);
}

/** The wall-clock parts an instant reads as in a given zone — the inverse of the above. */
export function instantToZonedParts(instant: Date, timeZone: string): { dateIso: string; time: string } | null {
  if (Number.isNaN(instant.getTime()) || !isValidTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = read("hour") === "24" ? "00" : read("hour");
  return { dateIso: `${read("year")}-${read("month")}-${read("day")}`, time: `${hour}:${read("minute")}` };
}

/**
 * How a scheduled instant reads to a human, in the zone it was scheduled in.
 * e.g. "8 Sep 2026 at 10:00 (Europe/London)".
 */
export function formatScheduledFor(instant: Date, timeZone: string): string {
  const parts = instantToZonedParts(instant, timeZone);
  if (!parts) return "";
  const readable = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(instant);
  return `${readable} at ${parts.time} (${timeZone})`;
}

/* ------------------------------------------------------------------ state */

export type SchedulingStateKind = "PUBLISHED" | "SCHEDULED" | "UNSCHEDULED";

export type SchedulingState = {
  kind: SchedulingStateKind;
  label: string;
  detail: string;
  /** The instant, only when genuinely scheduled. */
  scheduledInstant: Date | null;
};

export type SchedulableContent = {
  status: ContentStatus;
  scheduledAt: Date | null;
  scheduledTimezone: string | null;
  publishedAt: Date | null;
};

/**
 * What a Content row's publication state actually is.
 *
 * PUBLISHED is reported only from publishedAt — never from a schedule,
 * however far in the past that schedule is. A scheduled instant that has
 * elapsed without a publication having happened is still not a publication,
 * and saying otherwise would be the exact fabrication this phase forbids.
 */
export function describeSchedulingState(content: SchedulableContent): SchedulingState {
  if (content.status === "PUBLISHED" && content.publishedAt) {
    return {
      kind: "PUBLISHED",
      label: "Published",
      detail: `Published ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(content.publishedAt)}`,
      scheduledInstant: null,
    };
  }

  if (isConsistentlyScheduled(content)) {
    return {
      kind: "SCHEDULED",
      label: "Scheduled",
      detail: `Scheduled for ${formatScheduledFor(content.scheduledAt!, content.scheduledTimezone!)}`,
      scheduledInstant: content.scheduledAt,
    };
  }

  return {
    kind: "UNSCHEDULED",
    label: content.status === "PUBLISHED" ? "Published" : "Not scheduled",
    detail: content.status === "PUBLISHED" ? "Published, with no recorded date." : "This content has no publication date or time set.",
    scheduledInstant: null,
  };
}

/**
 * The invariant: SCHEDULED means BOTH fields are present, and the fields are
 * present only when SCHEDULED. Anything else is a row that lies about its own
 * state, so it is reported as unscheduled rather than half-believed.
 */
export function isConsistentlyScheduled(content: SchedulableContent): boolean {
  return content.status === "SCHEDULED" && content.scheduledAt !== null && content.scheduledTimezone !== null && isValidTimeZone(content.scheduledTimezone);
}

/* -------------------------------------------------------------- validation */

export type ScheduleRequest = {
  dateIso: string;
  time: string;
  timeZone: string;
};

export type ScheduleValidation = { ok: true; instant: Date } | { ok: false; error: string };

/** Statuses a schedule can never be applied to, with the reason a human needs. */
const UNSCHEDULABLE: Partial<Record<ContentStatus, string>> = {
  PUBLISHED: "This content is already published, so it cannot be scheduled.",
  ARCHIVED: "This content is archived. Restore it before scheduling.",
};

/**
 * Whether a schedule request may be applied, and to what instant.
 *
 * A visibility rule AND a real precondition: the server action calls this
 * before writing, so the same sentence the user saw is the one that blocks
 * the write. Ownership is checked separately and is never decided here.
 */
export function validateScheduleRequest(input: {
  request: ScheduleRequest;
  status: ContentStatus;
  contentDeletedAt: Date | null;
  projectDeletedAt: Date | null;
  now: Date;
}): ScheduleValidation {
  if (input.contentDeletedAt !== null) return { ok: false, error: "This content is in the trash. Restore it before scheduling." };
  if (input.projectDeletedAt !== null) return { ok: false, error: "The SEO project this content belongs to is in the trash. Restore the project before scheduling." };

  const blocked = UNSCHEDULABLE[input.status];
  if (blocked) return { ok: false, error: blocked };

  if (!DATE_PATTERN.test(input.request.dateIso)) return { ok: false, error: "Choose a valid date." };
  if (!TIME_PATTERN.test(input.request.time)) return { ok: false, error: "Choose a valid time, as HH:MM." };
  if (!isValidTimeZone(input.request.timeZone)) return { ok: false, error: "Choose a valid timezone." };

  const instant = zonedWallTimeToInstant(input.request.dateIso, input.request.time, input.request.timeZone);
  if (!instant) return { ok: false, error: "That date and time do not form a real moment." };

  /*
   * A schedule in the past cannot be honoured, and silently accepting one
   * would leave a row claiming a publication moment that has already gone.
   */
  if (instant.getTime() <= input.now.getTime()) return { ok: false, error: "Choose a time in the future — a schedule cannot be set in the past." };

  return { ok: true, instant };
}

/* ------------------------------------------------------------ transitions */

/**
 * The state a Content row moves to when its schedule is cancelled.
 *
 * DRAFT, deliberately and always: a cancelled schedule leaves content that
 * exists but has no publication intent, which is precisely what DRAFT means
 * here. Restoring a pre-schedule status (APPROVED, say) would need a history
 * this model does not keep, and guessing one would be worse than the plain,
 * predictable answer.
 */
export const STATUS_AFTER_SCHEDULE_CANCELLED: ContentStatus = "DRAFT";

/** The fields written when a schedule is cancelled — both cleared, never left stale. */
export const CLEARED_SCHEDULE = { scheduledAt: null, scheduledTimezone: null } as const;
