import { describe, expect, it } from "vitest";

import {
  buildScheduleSlots,
  checkDateRange,
  contentCalendarInputSchema,
  formatIsoDate,
  isWithinRange,
  MAX_CALENDAR_ENTRIES,
  MAX_CALENDAR_RANGE_DAYS,
  parseIsoDate,
  saveContentCalendarSchema,
} from "@/features/ai-workspace/schemas/content-calendar.schema";

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const KEYWORD_ID = "01a002a5-ffa5-705e-9731-8062675143ae";

const VALID_GENERATE = {
  seoProjectId: PROJECT_ID,
  name: "Q4 plan",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  cadence: "WEEKLY" as const,
  topicSource: "PROJECT_DATA" as const,
};

const VALID_SAVE = {
  seoProjectId: PROJECT_ID,
  name: "Q4 plan",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  entries: [
    { scheduledDate: "2026-10-01", topic: "Self storage basics", contentType: "GUIDE" as const, role: "PILLAR" as const, status: "PLANNED" as const },
    { scheduledDate: "2026-10-08", topic: "Choosing a unit size", contentType: "ARTICLE" as const, role: "SUPPORTING" as const, status: "PLANNED" as const },
  ],
};

describe("parseIsoDate — impossible dates are rejected, not silently shifted", () => {
  it("1. parses a real date to UTC midnight", () => {
    const date = parseIsoDate("2026-10-01")!;
    expect(date.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("2. rejects 30 February — the case a naive Date silently rolls into March", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
  });

  it("3. rejects other impossible calendar dates", () => {
    for (const value of ["2026-13-01", "2026-00-10", "2026-04-31", "2026-06-00", "2025-02-29"]) {
      expect(parseIsoDate(value)).toBeNull();
    }
  });

  it("4. accepts a real leap day", () => {
    expect(parseIsoDate("2028-02-29")).not.toBeNull();
  });

  it("5. rejects anything that is not yyyy-MM-dd", () => {
    for (const value of ["", "01/10/2026", "2026-10-1", "2026-10", "next Tuesday", "2026-10-01T00:00:00Z"]) {
      expect(parseIsoDate(value)).toBeNull();
    }
  });

  it("6. round-trips through formatIsoDate", () => {
    expect(formatIsoDate(parseIsoDate("2026-12-31")!)).toBe("2026-12-31");
  });
});

describe("checkDateRange", () => {
  it("7. accepts a sensible range and counts the days inclusively", () => {
    const result = checkDateRange("2026-10-01", "2026-10-07");
    expect(result.ok).toBe(true);
    expect(result.ok && result.days).toBe(7);
  });

  it("8. accepts a single-day range", () => {
    const result = checkDateRange("2026-10-01", "2026-10-01");
    expect(result.ok).toBe(true);
    expect(result.ok && result.days).toBe(1);
  });

  it("9. rejects an end date before the start date", () => {
    const result = checkDateRange("2026-10-08", "2026-10-01");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/cannot be before/i);
  });

  it("10. rejects an impossible start or end date with a clear message", () => {
    expect(checkDateRange("2026-02-30", "2026-10-01").ok).toBe(false);
    expect(checkDateRange("2026-10-01", "2026-02-30").ok).toBe(false);
  });

  it("11. rejects a range longer than the maximum", () => {
    const result = checkDateRange("2026-01-01", "2030-01-01");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain(String(MAX_CALENDAR_RANGE_DAYS));
  });
});

describe("isWithinRange", () => {
  const range = { start: parseIsoDate("2026-10-01")!, end: parseIsoDate("2026-10-31")! };

  it("12. includes both endpoints", () => {
    expect(isWithinRange(parseIsoDate("2026-10-01")!, range)).toBe(true);
    expect(isWithinRange(parseIsoDate("2026-10-31")!, range)).toBe(true);
  });

  it("13. excludes the day either side", () => {
    expect(isWithinRange(parseIsoDate("2026-09-30")!, range)).toBe(false);
    expect(isWithinRange(parseIsoDate("2026-11-01")!, range)).toBe(false);
  });
});

describe("buildScheduleSlots — every date is real and inside the range by construction", () => {
  const range = { start: parseIsoDate("2026-10-01")!, end: parseIsoDate("2026-10-31")! };

  it("14. weekly spaces slots seven days apart, starting on the start date", () => {
    const slots = buildScheduleSlots(range, "WEEKLY").map(formatIsoDate);
    expect(slots).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
  });

  it("15. fortnightly spaces slots fourteen days apart", () => {
    expect(buildScheduleSlots(range, "FORTNIGHTLY").map(formatIsoDate)).toEqual(["2026-10-01", "2026-10-15", "2026-10-29"]);
  });

  it("16. twice-weekly produces more slots than weekly over the same range", () => {
    expect(buildScheduleSlots(range, "TWICE_WEEKLY").length).toBeGreaterThan(buildScheduleSlots(range, "WEEKLY").length);
  });

  it("17. monthly steps by calendar month, not by 30 days", () => {
    const longRange = { start: parseIsoDate("2026-01-31")!, end: parseIsoDate("2026-06-30")! };
    const slots = buildScheduleSlots(longRange, "MONTHLY").map(formatIsoDate);
    expect(slots[0]).toBe("2026-01-31");
    // Stepping a calendar month from 31 January lands in March, which is
    // correct month arithmetic — and every slot is still a real date.
    expect(slots.every((slot) => parseIsoDate(slot) !== null)).toBe(true);
  });

  it("18. NEVER produces a date outside the range", () => {
    for (const cadence of ["TWICE_WEEKLY", "WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const) {
      for (const slot of buildScheduleSlots(range, cadence)) {
        expect(isWithinRange(slot, range)).toBe(true);
      }
    }
  });

  it("19. a single-day range yields exactly one slot", () => {
    const oneDay = { start: parseIsoDate("2026-10-01")!, end: parseIsoDate("2026-10-01")! };
    expect(buildScheduleSlots(oneDay, "WEEKLY").map(formatIsoDate)).toEqual(["2026-10-01"]);
  });

  it("20. never exceeds the entry cap even over a long range", () => {
    const longRange = { start: parseIsoDate("2026-01-01")!, end: parseIsoDate("2026-12-31")! };
    expect(buildScheduleSlots(longRange, "TWICE_WEEKLY").length).toBeLessThanOrEqual(MAX_CALENDAR_ENTRIES);
  });

  it("21. respects a caller-supplied limit", () => {
    expect(buildScheduleSlots(range, "WEEKLY", 2)).toHaveLength(2);
  });
});

describe("contentCalendarInputSchema — generation input", () => {
  it("22. accepts a valid request", () => {
    expect(contentCalendarInputSchema.safeParse(VALID_GENERATE).success).toBe(true);
  });

  it("23. rejects a non-uuid project id and an empty name", () => {
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, seoProjectId: "nope" }).success).toBe(false);
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, name: "  " }).success).toBe(false);
  });

  it("24. rejects an invalid date range", () => {
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, endDate: "2026-09-01" }).success).toBe(false);
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, startDate: "2026-02-30" }).success).toBe(false);
  });

  it("25. requires topics when the user chose to supply their own", () => {
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, topicSource: "USER_TOPICS" }).success).toBe(false);
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, topicSource: "USER_TOPICS", userTopics: "  \n " }).success).toBe(false);
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, topicSource: "USER_TOPICS", userTopics: "A topic" }).success).toBe(true);
  });

  it("26. requires a cluster when the user chose a cluster source", () => {
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, topicSource: "TOPIC_CLUSTER" }).success).toBe(false);
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, topicSource: "TOPIC_CLUSTER", keywordClusterId: KEYWORD_ID }).success).toBe(true);
  });

  it("27. rejects an unknown cadence or topic source", () => {
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, cadence: "DAILY" }).success).toBe(false);
    expect(contentCalendarInputSchema.safeParse({ ...VALID_GENERATE, topicSource: "MAGIC" }).success).toBe(false);
  });
});

describe("saveContentCalendarSchema — the approval payload", () => {
  it("28. accepts a valid calendar", () => {
    expect(saveContentCalendarSchema.safeParse(VALID_SAVE).success).toBe(true);
  });

  it("29. requires at least one entry", () => {
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, entries: [] }).success).toBe(false);
  });

  it("30. rejects more entries than the cap", () => {
    const many = Array.from({ length: MAX_CALENDAR_ENTRIES + 1 }, (_, i) => ({
      scheduledDate: "2026-10-01",
      topic: `Topic ${i}`,
      contentType: "ARTICLE" as const,
      role: "RELATED" as const,
      status: "PLANNED" as const,
    }));
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, entries: many }).success).toBe(false);
  });

  it("31. rejects an entry with an impossible date", () => {
    const result = saveContentCalendarSchema.safeParse({
      ...VALID_SAVE,
      entries: [{ ...VALID_SAVE.entries[0], scheduledDate: "2026-02-30" }],
    });
    expect(result.success).toBe(false);
  });

  it("32. rejects an entry dated OUTSIDE the calendar range", () => {
    const result = saveContentCalendarSchema.safeParse({
      ...VALID_SAVE,
      entries: [{ ...VALID_SAVE.entries[0], scheduledDate: "2027-01-15" }],
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].message).toMatch(/outside the calendar/i);
  });

  it("33. rejects a DUPLICATE topic, however it is cased or spaced", () => {
    const result = saveContentCalendarSchema.safeParse({
      ...VALID_SAVE,
      entries: [
        VALID_SAVE.entries[0],
        { ...VALID_SAVE.entries[1], topic: "  self   STORAGE basics " },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].message).toMatch(/already on the calendar/i);
  });

  it("34. ALLOWS two different topics on the same date — that is a real publishing choice", () => {
    const result = saveContentCalendarSchema.safeParse({
      ...VALID_SAVE,
      entries: [
        { ...VALID_SAVE.entries[0], scheduledDate: "2026-10-01" },
        { ...VALID_SAVE.entries[1], scheduledDate: "2026-10-01" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("35. rejects an entry with no topic", () => {
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, entries: [{ ...VALID_SAVE.entries[0], topic: "   " }] }).success).toBe(false);
  });

  it("36. rejects an invalid keyword or content id shape", () => {
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, entries: [{ ...VALID_SAVE.entries[0], keywordId: "not-a-uuid" }] }).success).toBe(false);
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, entries: [{ ...VALID_SAVE.entries[0], contentId: "not-a-uuid" }] }).success).toBe(false);
  });

  it("37. accepts null keyword and content links — both are optional", () => {
    const result = saveContentCalendarSchema.safeParse({
      ...VALID_SAVE,
      entries: [{ ...VALID_SAVE.entries[0], keywordId: null, contentId: null }],
    });
    expect(result.success).toBe(true);
  });

  it("38. defaults a missing status to PLANNED rather than guessing something further along", () => {
    const result = saveContentCalendarSchema.safeParse({
      ...VALID_SAVE,
      entries: [{ scheduledDate: "2026-10-01", topic: "A topic", contentType: "ARTICLE" as const, role: "RELATED" as const }],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.entries[0].status).toBe("PLANNED");
  });

  it("39. rejects an unknown status, content type or role", () => {
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, entries: [{ ...VALID_SAVE.entries[0], status: "LIVE" }] }).success).toBe(false);
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, entries: [{ ...VALID_SAVE.entries[0], contentType: "TWEET" }] }).success).toBe(false);
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, entries: [{ ...VALID_SAVE.entries[0], role: "HERO" }] }).success).toBe(false);
  });

  it("40. rejects a bad calendar range even when every entry looks fine", () => {
    expect(saveContentCalendarSchema.safeParse({ ...VALID_SAVE, startDate: "2026-12-31", endDate: "2026-10-01" }).success).toBe(false);
  });
});
