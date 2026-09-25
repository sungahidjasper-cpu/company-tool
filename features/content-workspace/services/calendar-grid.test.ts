import { describe, expect, it } from "vitest";

import { formatIsoDate, parseIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import {
  AGENDA_DAYS,
  addDays,
  addMonths,
  daysInWindow,
  endOfMonth,
  isInAnchorMonth,
  isSameDay,
  monthGridRows,
  parseAnchor,
  parseView,
  periodLabel,
  serializeAnchor,
  shiftAnchor,
  startOfMonth,
  startOfWeek,
  todayUtc,
  windowForView,
} from "@/features/content-workspace/services/calendar-grid";

const d = (iso: string) => parseIsoDate(iso)!;

describe("todayUtc", () => {
  it("1. normalises to UTC midnight so a grid day never shifts by timezone", () => {
    expect(todayUtc(new Date("2026-03-15T23:45:00Z")).toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(todayUtc(new Date("2026-03-15T00:10:00Z")).toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });
});

describe("addMonths — the classic month-arithmetic trap", () => {
  it("2. 31 January + 1 month is the end of February, never March", () => {
    expect(formatIsoDate(addMonths(d("2026-01-31"), 1))).toBe("2026-02-28");
  });

  it("3. clamps into a leap February correctly", () => {
    expect(formatIsoDate(addMonths(d("2028-01-31"), 1))).toBe("2028-02-29");
  });

  it("4. steps backwards with the same clamping", () => {
    expect(formatIsoDate(addMonths(d("2026-03-31"), -1))).toBe("2026-02-28");
  });

  it("5. crosses a year boundary in both directions", () => {
    expect(formatIsoDate(addMonths(d("2026-12-15"), 1))).toBe("2027-01-15");
    expect(formatIsoDate(addMonths(d("2026-01-15"), -1))).toBe("2025-12-15");
  });

  it("6. an ordinary day is unaffected by the clamping", () => {
    expect(formatIsoDate(addMonths(d("2026-05-10"), 3))).toBe("2026-08-10");
  });
});

describe("week and month boundaries", () => {
  it("7. startOfWeek lands on the Sunday, and is a no-op on a Sunday", () => {
    expect(formatIsoDate(startOfWeek(d("2026-03-18")))).toBe("2026-03-15");
    expect(formatIsoDate(startOfWeek(d("2026-03-15")))).toBe("2026-03-15");
  });

  it("8. startOfMonth and endOfMonth bracket the month", () => {
    expect(formatIsoDate(startOfMonth(d("2026-02-17")))).toBe("2026-02-01");
    expect(formatIsoDate(endOfMonth(d("2026-02-17")))).toBe("2026-02-28");
    expect(formatIsoDate(endOfMonth(d("2028-02-01")))).toBe("2028-02-29");
  });

  it("9. addDays crosses month and year boundaries", () => {
    expect(formatIsoDate(addDays(d("2026-12-31"), 1))).toBe("2027-01-01");
    expect(formatIsoDate(addDays(d("2026-03-01"), -1))).toBe("2026-02-28");
  });

  it("10. isSameDay compares the day, not the object", () => {
    expect(isSameDay(d("2026-03-15"), d("2026-03-15"))).toBe(true);
    expect(isSameDay(d("2026-03-15"), d("2026-03-16"))).toBe(false);
  });
});

describe("windowForView", () => {
  it("11. DAY covers exactly the anchor", () => {
    const w = windowForView("DAY", d("2026-03-18"));
    expect([formatIsoDate(w.start), formatIsoDate(w.end)]).toEqual(["2026-03-18", "2026-03-18"]);
  });

  it("12. WEEK covers Sunday to Saturday around the anchor", () => {
    const w = windowForView("WEEK", d("2026-03-18"));
    expect([formatIsoDate(w.start), formatIsoDate(w.end)]).toEqual(["2026-03-15", "2026-03-21"]);
    expect(daysInWindow(w)).toHaveLength(7);
  });

  it("13. MONTH extends to whole weeks, so the grid is always a full rectangle", () => {
    const w = windowForView("MONTH", d("2026-03-18"));
    expect(formatIsoDate(w.start)).toBe("2026-03-01"); // 1 March 2026 is a Sunday
    expect(formatIsoDate(w.end)).toBe("2026-04-04");
    expect(daysInWindow(w).length % 7).toBe(0);
  });

  it("14. MONTH pads the leading days when the 1st is mid-week", () => {
    const w = windowForView("MONTH", d("2026-05-10")); // 1 May 2026 is a Friday
    expect(formatIsoDate(w.start)).toBe("2026-04-26");
    expect(daysInWindow(w).length % 7).toBe(0);
  });

  it("15. AGENDA looks forward across a rolling window", () => {
    const w = windowForView("AGENDA", d("2026-03-18"));
    expect(formatIsoDate(w.start)).toBe("2026-03-15");
    expect(daysInWindow(w)).toHaveLength(AGENDA_DAYS);
  });

  it("16. every window is ordered and contiguous", () => {
    for (const view of ["DAY", "WEEK", "MONTH", "AGENDA"] as const) {
      const days = daysInWindow(windowForView(view, d("2026-07-04")));
      expect(days.length).toBeGreaterThan(0);
      for (let i = 1; i < days.length; i++) {
        expect(days[i].getTime() - days[i - 1].getTime()).toBe(86_400_000);
      }
    }
  });
});

describe("monthGridRows", () => {
  it("17. returns rows of exactly seven days", () => {
    const rows = monthGridRows(d("2026-03-18"));
    expect(rows.every((row) => row.length === 7)).toBe(true);
  });

  it("18. starts every row on a Sunday", () => {
    for (const row of monthGridRows(d("2026-05-10"))) {
      expect(row[0].getUTCDay()).toBe(0);
    }
  });

  it("19. contains every day of the anchor month exactly once", () => {
    const days = monthGridRows(d("2026-02-15")).flat().map(formatIsoDate);
    for (let day = 1; day <= 28; day++) {
      const iso = `2026-02-${String(day).padStart(2, "0")}`;
      expect(days.filter((value) => value === iso)).toHaveLength(1);
    }
  });

  it("20. handles a February that starts on a Sunday without an empty trailing row", () => {
    const rows = monthGridRows(d("2026-02-15")); // 1 Feb 2026 is a Sunday
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.flat().some((day) => isInAnchorMonth(day, d("2026-02-15")))).toBe(true);
  });
});

describe("isInAnchorMonth — dimming adjacent-month cells", () => {
  it("21. is true only for the anchor's own month and year", () => {
    expect(isInAnchorMonth(d("2026-03-31"), d("2026-03-01"))).toBe(true);
    expect(isInAnchorMonth(d("2026-04-01"), d("2026-03-01"))).toBe(false);
    expect(isInAnchorMonth(d("2025-03-15"), d("2026-03-01"))).toBe(false);
  });
});

describe("shiftAnchor", () => {
  it("22. steps by the right period for each view", () => {
    expect(formatIsoDate(shiftAnchor("DAY", d("2026-03-18"), 1))).toBe("2026-03-19");
    expect(formatIsoDate(shiftAnchor("WEEK", d("2026-03-18"), 1))).toBe("2026-03-25");
    expect(formatIsoDate(shiftAnchor("MONTH", d("2026-03-18"), 1))).toBe("2026-04-18");
    expect(formatIsoDate(shiftAnchor("DAY", d("2026-03-18"), -1))).toBe("2026-03-17");
  });

  it("23. month steps keep the clamping behaviour", () => {
    expect(formatIsoDate(shiftAnchor("MONTH", d("2026-01-31"), 1))).toBe("2026-02-28");
  });

  it("24. stepping forwards then back returns to the start for day and week", () => {
    for (const view of ["DAY", "WEEK", "AGENDA"] as const) {
      const start = d("2026-06-10");
      expect(formatIsoDate(shiftAnchor(view, shiftAnchor(view, start, 1), -1))).toBe("2026-06-10");
    }
  });
});

describe("periodLabel", () => {
  it("25. MONTH shows the month and year", () => {
    expect(periodLabel("MONTH", d("2026-03-18"))).toBe("March 2026");
  });

  it("26. DAY shows the full date", () => {
    expect(periodLabel("DAY", d("2026-03-18"))).toBe("March 18, 2026");
  });

  it("27. WEEK inside one month shows a day range", () => {
    expect(periodLabel("WEEK", d("2026-03-18"))).toBe("March 15 – 21, 2026");
  });

  it("28. WEEK spanning two months names both", () => {
    expect(periodLabel("WEEK", d("2026-03-31"))).toBe("March 29 – April 4, 2026");
  });

  it("29. a window spanning two years names both years", () => {
    expect(periodLabel("WEEK", d("2026-12-31"))).toContain("2027");
  });
});

describe("URL round-tripping", () => {
  it("30. serialises and re-parses an anchor unchanged", () => {
    expect(formatIsoDate(parseAnchor(serializeAnchor(d("2026-03-18")), d("2000-01-01")))).toBe("2026-03-18");
  });

  it("31. falls back for a missing or impossible anchor rather than throwing", () => {
    const fallback = d("2026-01-01");
    expect(parseAnchor(undefined, fallback)).toBe(fallback);
    expect(parseAnchor("2026-02-30", fallback)).toBe(fallback);
    expect(parseAnchor("garbage", fallback)).toBe(fallback);
  });

  it("32. parseView accepts the real views, case-insensitively, and defaults to Month", () => {
    expect(parseView("week")).toBe("WEEK");
    expect(parseView("AGENDA")).toBe("AGENDA");
    expect(parseView(undefined)).toBe("MONTH");
    expect(parseView("timeline")).toBe("MONTH");
  });
});
