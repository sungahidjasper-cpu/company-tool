import { describe, expect, it } from "vitest";

import { parseAiUsageFilters } from "@/features/ai-usage/schemas/ai-usage-filters";

describe("parseAiUsageFilters", () => {
  it("parses dateFrom as the start of that calendar day", () => {
    const filters = parseAiUsageFilters({ dateFrom: "2026-08-14" });
    expect(filters.dateFrom?.getHours()).toBe(0);
    expect(filters.dateFrom?.getMinutes()).toBe(0);
    expect(filters.dateFrom?.getSeconds()).toBe(0);
  });

  it("parses dateTo as the END of that calendar day, not midnight-start — a call logged late on the selected day must be included", () => {
    const filters = parseAiUsageFilters({ dateTo: "2026-08-14" });
    expect(filters.dateTo?.getHours()).toBe(23);
    expect(filters.dateTo?.getMinutes()).toBe(59);
    expect(filters.dateTo?.getSeconds()).toBe(59);

    // A row created at 23:00 on the selected day must be <= dateTo.
    const lateInDay = new Date("2026-08-14T23:00:00");
    expect(lateInDay.getTime()).toBeLessThanOrEqual(filters.dateTo!.getTime());
  });

  it("ignores an invalid/malformed date string rather than producing an Invalid Date", () => {
    const filters = parseAiUsageFilters({ dateFrom: "not-a-date" });
    expect(filters.dateFrom).toBeUndefined();
  });

  it("only accepts a provider/taskType from the known static lists", () => {
    expect(parseAiUsageFilters({ provider: "gemini" }).provider).toBe("gemini");
    expect(parseAiUsageFilters({ provider: "not-a-real-provider" }).provider).toBeUndefined();
    expect(parseAiUsageFilters({ taskType: "SCORES" }).taskType).toBe("SCORES");
    expect(parseAiUsageFilters({ taskType: "NOT_A_TASK" }).taskType).toBeUndefined();
  });

  it("defaults page to 1 and clamps a non-positive page", () => {
    expect(parseAiUsageFilters({}).page).toBe(1);
    expect(parseAiUsageFilters({ page: "0" }).page).toBe(1);
    expect(parseAiUsageFilters({ page: "-3" }).page).toBe(1);
    expect(parseAiUsageFilters({ page: "3" }).page).toBe(3);
  });
});
