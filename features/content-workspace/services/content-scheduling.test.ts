import { describe, expect, it } from "vitest";

import {
  CLEARED_SCHEDULE,
  STATUS_AFTER_SCHEDULE_CANCELLED,
  describeSchedulingState,
  formatScheduledFor,
  instantToZonedParts,
  isConsistentlyScheduled,
  isValidTimeZone,
  validateScheduleRequest,
  zonedWallTimeToInstant,
  type SchedulableContent,
} from "@/features/content-workspace/services/content-scheduling";

const NOW = new Date("2026-09-08T09:00:00.000Z");

const scheduled = (over: Partial<SchedulableContent> = {}): SchedulableContent => ({
  status: "SCHEDULED",
  scheduledAt: new Date("2026-09-20T09:00:00.000Z"),
  scheduledTimezone: "Europe/London",
  publishedAt: null,
  ...over,
});

describe("timezone conversion — the chosen instant, not a reinterpretation", () => {
  it("1. converts a wall time in a zone to the instant it names (BST, UTC+1)", () => {
    expect(zonedWallTimeToInstant("2026-09-08", "10:00", "Europe/London")!.toISOString()).toBe("2026-09-08T09:00:00.000Z");
  });

  it("2. converts the same wall time in winter correctly (GMT, UTC+0)", () => {
    expect(zonedWallTimeToInstant("2026-01-08", "10:00", "Europe/London")!.toISOString()).toBe("2026-01-08T10:00:00.000Z");
  });

  it("3. handles a zone behind UTC", () => {
    // 2026-09-08 is inside US daylight time, so New York is UTC-4.
    expect(zonedWallTimeToInstant("2026-09-08", "10:00", "America/New_York")!.toISOString()).toBe("2026-09-08T14:00:00.000Z");
  });

  it("4. handles a zone ahead of UTC with a half-hour offset", () => {
    expect(zonedWallTimeToInstant("2026-09-08", "10:00", "Asia/Kolkata")!.toISOString()).toBe("2026-09-08T04:30:00.000Z");
  });

  it("5. UTC is the identity case", () => {
    expect(zonedWallTimeToInstant("2026-09-08", "10:00", "UTC")!.toISOString()).toBe("2026-09-08T10:00:00.000Z");
  });

  it("6. is correct on both sides of a DST transition — the case a single-pass conversion gets an hour wrong", () => {
    // UK clocks go back on 2026-10-25 at 02:00 BST.
    expect(zonedWallTimeToInstant("2026-10-24", "12:00", "Europe/London")!.toISOString()).toBe("2026-10-24T11:00:00.000Z");
    expect(zonedWallTimeToInstant("2026-10-26", "12:00", "Europe/London")!.toISOString()).toBe("2026-10-26T12:00:00.000Z");
  });

  it("7. round-trips: an instant read back in its own zone gives the wall time that was chosen", () => {
    for (const [date, time, zone] of [
      ["2026-09-08", "10:00", "Europe/London"],
      ["2026-01-08", "23:45", "America/New_York"],
      ["2026-06-30", "00:00", "Asia/Kolkata"],
      ["2026-12-25", "17:30", "Australia/Sydney"],
    ] as [string, string, string][]) {
      const instant = zonedWallTimeToInstant(date, time, zone)!;
      expect(instantToZonedParts(instant, zone)).toEqual({ dateIso: date, time });
    }
  });

  it("8. the SAME instant reads as different wall times in different zones — which is why the zone is stored", () => {
    const instant = zonedWallTimeToInstant("2026-09-08", "10:00", "Europe/London")!;
    expect(instantToZonedParts(instant, "Europe/London")!.time).toBe("10:00");
    expect(instantToZonedParts(instant, "America/New_York")!.time).toBe("05:00");
    expect(instantToZonedParts(instant, "UTC")!.time).toBe("09:00");
  });

  it("9. refuses malformed input rather than guessing a moment", () => {
    for (const [date, time, zone] of [
      ["", "10:00", "UTC"],
      ["2026-09-08", "", "UTC"],
      ["2026-09-08", "10:00", ""],
      ["08/09/2026", "10:00", "UTC"],
      ["2026-09-08", "25:00", "UTC"],
      ["2026-09-08", "10:60", "UTC"],
      ["2026-09-08", "10:00", "Mars/Olympus"],
      ["2026-02-31", "10:00", "UTC"],
      ["2026-13-01", "10:00", "UTC"],
    ] as [string, string, string][]) {
      expect(zonedWallTimeToInstant(date, time, zone)).toBeNull();
    }
  });

  it("10. accepts midnight and one minute to midnight", () => {
    expect(instantToZonedParts(zonedWallTimeToInstant("2026-09-08", "00:00", "Europe/London")!, "Europe/London")!.time).toBe("00:00");
    expect(instantToZonedParts(zonedWallTimeToInstant("2026-09-08", "23:59", "Europe/London")!, "Europe/London")!.time).toBe("23:59");
  });

  it("11. validates timezones against the runtime, not a hard-coded list", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Pacific/Auckland")).toBe(true);
    expect(isValidTimeZone("Nowhere/Nothing")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
  });

  it("12. formats a schedule with its zone named, so the reader knows which clock it is", () => {
    const instant = zonedWallTimeToInstant("2026-09-20", "10:00", "Europe/London")!;
    // Asserted structurally: the month abbreviation ("Sep" vs "Sept") is an
    // ICU-version detail, and pinning it would make this test fail on a
    // Node upgrade for no product reason.
    expect(formatScheduledFor(instant, "Europe/London")).toMatch(/^20 Sep\w* 2026 at 10:00 \(Europe\/London\)$/);
  });
});

describe("scheduling state — PUBLISHED is never inferred from a schedule", () => {
  it("13. a scheduled row reports SCHEDULED with its intended local time", () => {
    const state = describeSchedulingState(scheduled());
    expect(state.kind).toBe("SCHEDULED");
    expect(state.detail).toMatch(/^Scheduled for 20 Sep\w* 2026 at 10:00 \(Europe\/London\)$/);
  });

  it("14. a published row reports PUBLISHED from publishedAt", () => {
    const state = describeSchedulingState({ status: "PUBLISHED", scheduledAt: null, scheduledTimezone: null, publishedAt: new Date("2026-06-01T00:00:00Z") });
    expect(state.kind).toBe("PUBLISHED");
    expect(state.detail).toBe("Published 1 Jun 2026");
  });

  it("15. a schedule whose moment has PASSED is still not published", () => {
    const past = describeSchedulingState(scheduled({ scheduledAt: new Date("2020-01-01T00:00:00Z") }));
    expect(past.kind).toBe("SCHEDULED");
    expect(past.kind).not.toBe("PUBLISHED");
    expect(past.detail).not.toMatch(/published/i);
  });

  it("16. a draft reports as unscheduled", () => {
    const state = describeSchedulingState({ status: "DRAFT", scheduledAt: null, scheduledTimezone: null, publishedAt: null });
    expect(state.kind).toBe("UNSCHEDULED");
    expect(state.detail).toMatch(/no publication date or time/i);
  });

  it("17. a row claiming SCHEDULED without both fields is not believed", () => {
    expect(isConsistentlyScheduled(scheduled({ scheduledAt: null }))).toBe(false);
    expect(isConsistentlyScheduled(scheduled({ scheduledTimezone: null }))).toBe(false);
    expect(isConsistentlyScheduled(scheduled({ scheduledTimezone: "Nowhere/Nothing" }))).toBe(false);
    expect(describeSchedulingState(scheduled({ scheduledAt: null })).kind).toBe("UNSCHEDULED");
  });

  it("18. schedule fields on a NON-scheduled row do not make it scheduled", () => {
    for (const status of ["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"] as const) {
      expect(isConsistentlyScheduled(scheduled({ status }))).toBe(false);
    }
  });

  it("19. never reports a publish date that came from a schedule", () => {
    const state = describeSchedulingState(scheduled());
    expect(state.detail).not.toMatch(/^Published/);
  });
});

describe("validateScheduleRequest — nothing is written on an invalid request", () => {
  const base = {
    request: { dateIso: "2026-09-20", time: "10:00", timeZone: "Europe/London" },
    status: "DRAFT" as const,
    contentDeletedAt: null,
    projectDeletedAt: null,
    now: NOW,
  };

  it("20. accepts a valid future schedule and returns the exact instant", () => {
    const result = validateScheduleRequest(base);
    expect(result.ok).toBe(true);
    expect(result.ok && result.instant.toISOString()).toBe("2026-09-20T09:00:00.000Z");
  });

  it("21. refuses a schedule in the past", () => {
    const result = validateScheduleRequest({ ...base, request: { ...base.request, dateIso: "2026-09-01" } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/in the future/i);
  });

  it("22. refuses the current instant itself — a schedule must be ahead of now", () => {
    const result = validateScheduleRequest({ ...base, request: { dateIso: "2026-09-08", time: "10:00", timeZone: "Europe/London" }, now: new Date("2026-09-08T09:00:00.000Z") });
    expect(result.ok).toBe(false);
  });

  it("23. refuses trashed content and trashed projects, naming which", () => {
    const trashedContent = validateScheduleRequest({ ...base, contentDeletedAt: new Date("2026-01-01") });
    expect(!trashedContent.ok && trashedContent.error).toMatch(/content is in the trash/i);
    const trashedProject = validateScheduleRequest({ ...base, projectDeletedAt: new Date("2026-01-01") });
    expect(!trashedProject.ok && trashedProject.error).toMatch(/SEO project .* in the trash/i);
  });

  it("24. refuses already-published and archived content, with a reason", () => {
    for (const status of ["PUBLISHED", "ARCHIVED"] as const) {
      const result = validateScheduleRequest({ ...base, status });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.length).toBeGreaterThan(0);
    }
  });

  it("25. allows re-scheduling something already scheduled", () => {
    expect(validateScheduleRequest({ ...base, status: "SCHEDULED" }).ok).toBe(true);
  });

  it("26. allows scheduling from any working status", () => {
    for (const status of ["DRAFT", "IN_REVIEW", "APPROVED"] as const) {
      expect(validateScheduleRequest({ ...base, status }).ok).toBe(true);
    }
  });

  it("27. refuses every malformed date, time and zone with a usable message", () => {
    for (const request of [
      { dateIso: "nope", time: "10:00", timeZone: "UTC" },
      { dateIso: "2026-09-20", time: "10", timeZone: "UTC" },
      { dateIso: "2026-09-20", time: "10:00", timeZone: "Mars/Olympus" },
      { dateIso: "2026-02-31", time: "10:00", timeZone: "UTC" },
    ]) {
      const result = validateScheduleRequest({ ...base, request });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.length).toBeGreaterThan(0);
    }
  });

  it("28. an invalid request never yields an instant to write", () => {
    const result = validateScheduleRequest({ ...base, request: { dateIso: "2026-02-31", time: "10:00", timeZone: "UTC" } });
    expect(result).not.toHaveProperty("instant");
  });
});

describe("cancelling a schedule", () => {
  it("29. returns the content to DRAFT", () => {
    expect(STATUS_AFTER_SCHEDULE_CANCELLED).toBe("DRAFT");
  });

  it("30. clears BOTH schedule fields, leaving nothing stale", () => {
    expect(CLEARED_SCHEDULE).toEqual({ scheduledAt: null, scheduledTimezone: null });
  });

  it("31. a cancelled row then reports as unscheduled", () => {
    const cancelled = describeSchedulingState({ status: STATUS_AFTER_SCHEDULE_CANCELLED, ...CLEARED_SCHEDULE, publishedAt: null });
    expect(cancelled.kind).toBe("UNSCHEDULED");
  });

  it("32. cancelling never touches publishedAt", () => {
    expect(Object.keys(CLEARED_SCHEDULE)).not.toContain("publishedAt");
    expect(Object.keys(CLEARED_SCHEDULE)).not.toContain("status");
  });
});
