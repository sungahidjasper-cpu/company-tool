import { describe, expect, it } from "vitest";

import { CHIPS_PER_DAY, buildStatusOptions, hasActiveFilters } from "@/features/content-workspace/components/ContentWorkspaceCalendar";
import { EMPTY_FILTERS, NO_CLIENT, toContentItem, toPlanItem, type ContentRow, type PlanRow } from "@/features/content-workspace/services/content-calendar-feed";

/**
 * This repository has no React rendering test setup (vitest runs
 * `environment: "node"`), so the calendar's real logic is tested as pure
 * functions — the same approach every AI Workspace picker uses.
 */

const PROJECT = { id: "project-a", name: "Storage Moguls", clientId: "client-1", client: { name: "Acme" } };

const contentRow = (over: Partial<ContentRow> = {}): ContentRow => ({
  id: "c1",
  title: "A page",
  url: null,
  status: "DRAFT",
  publishedAt: null,
  updatedAt: new Date("2026-05-01T00:00:00Z"),
  generatedByAi: false,
  clientId: PROJECT.clientId,
  client: PROJECT.client ? { id: PROJECT.clientId as string, name: PROJECT.client.name } : null,
  contentType: null,
  seoProjectId: PROJECT.id,
  seoProject: PROJECT,  ...over,
});

const planRow = (over: Partial<PlanRow> = {}): PlanRow => ({
  id: "e1",
  topic: "A plan",
  scheduledDate: new Date("2026-10-01T00:00:00Z"),
  status: "PLANNED",
  contentType: "ARTICLE",
  role: "RELATED",
  notes: null,
  contentId: null,
  keyword: null,
  calendar: { id: "cal-1", name: "Q4", seoProject: PROJECT },
  ...over,
});

describe("buildStatusOptions — built from what is present, not from the enums", () => {
  it("1. offers only statuses that actually occur", () => {
    const options = buildStatusOptions([toContentItem(contentRow({ status: "DRAFT" })), toPlanItem(planRow())]);
    expect(options.map((option) => option.key)).toEqual(["CONTENT:DRAFT", "PLAN:PLANNED"]);
  });

  it("2. counts occurrences per status", () => {
    const options = buildStatusOptions([
      toContentItem(contentRow({ id: "c1", status: "DRAFT" })),
      toContentItem(contentRow({ id: "c2", status: "DRAFT" })),
      toContentItem(contentRow({ id: "c3", status: "PUBLISHED", publishedAt: new Date("2026-06-01T00:00:00Z") })),
    ]);
    expect(options.find((o) => o.key === "CONTENT:DRAFT")?.count).toBe(2);
    expect(options.find((o) => o.key === "CONTENT:PUBLISHED")?.count).toBe(1);
  });

  it("3. keeps the two lifecycles as separate options even when the word matches", () => {
    const options = buildStatusOptions([
      toContentItem(contentRow({ status: "PUBLISHED", publishedAt: new Date("2026-06-01T00:00:00Z") })),
      toPlanItem(planRow({ status: "PUBLISHED" })),
    ]);
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.key)).toEqual(["CONTENT:PUBLISHED", "PLAN:PUBLISHED"]);
    expect(options.every((o) => o.label === "Published")).toBe(true);
  });

  it("4. lists page statuses before plan statuses", () => {
    const options = buildStatusOptions([toPlanItem(planRow()), toContentItem(contentRow())]);
    expect(options[0].kind).toBe("CONTENT");
    expect(options[1].kind).toBe("PLAN");
  });

  it("5. is empty when there is nothing to filter", () => {
    expect(buildStatusOptions([])).toEqual([]);
  });
});

describe("hasActiveFilters", () => {
  it("6. false for untouched filters", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("7. true for any single active dimension", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, kinds: ["PLAN"] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, clientIds: [NO_CLIENT] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, seoProjectIds: ["project-a"] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, statuses: ["CONTENT:DRAFT"] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: "abc" })).toBe(true);
  });

  it("8. a whitespace-only search is not an active filter", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: "   " })).toBe(false);
  });
});

describe("density", () => {
  it("9. a day shows a small fixed number of chips before collapsing the rest", () => {
    expect(CHIPS_PER_DAY).toBeGreaterThan(0);
    expect(CHIPS_PER_DAY).toBeLessThanOrEqual(4);
  });
});
