import { describe, expect, it } from "vitest";

import { parseIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { matchesSearch, searchableText, toContentItem, toPlanItem, type ContentRow, type PlanRow, type WorkspaceItem } from "@/features/content-workspace/services/content-calendar-feed";
import {
  buildContentTypeOptions,
  formatDayHeading,
  groupIntoDays,
  hasTypedItems,
  relativeDayLabel,
  resolveEmptyState,
  splitByKind,
  undatedNote,
  type EmptyStateInput,
} from "@/features/content-workspace/services/workspace-presentation";

const PROJECT = { id: "project-a", name: "Storage Moguls", clientId: "client-1", client: { name: "Acme Plumbing" } };

const content = (over: Partial<ContentRow> = {}): WorkspaceItem =>
  toContentItem({
    id: "c1",
    title: "Emergency Plumbing FAQ",
    url: "https://example.com/faq",
    status: "PUBLISHED",
    publishedAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-02T00:00:00Z"),
    generatedByAi: false,
    clientId: PROJECT.clientId,
    client: PROJECT.client ? { id: PROJECT.clientId as string, name: PROJECT.client.name } : null,
    contentType: null,
    seoProjectId: PROJECT.id,
    seoProject: PROJECT,    ...over,
  });

const plan = (over: Partial<PlanRow> = {}): WorkspaceItem =>
  toPlanItem({
    id: "e1",
    topic: "Choosing a unit size",
    scheduledDate: new Date("2026-06-01T00:00:00Z"),
    status: "PLANNED",
    contentType: "GUIDE",
    role: "SUPPORTING",
    notes: "Include a sizing table",
    contentId: null,
    keyword: { term: "storage unit sizes" },
    calendar: { id: "cal-1", name: "Q2 plan", seoProject: PROJECT },
    ...over,
  });

describe("search — the fields an item is findable by", () => {
  it("1. finds a page by title, project, client and status label", () => {
    const item = content();
    for (const needle of ["emergency plumbing", "storage moguls", "acme", "published"]) {
      expect(matchesSearch(item, needle)).toBe(true);
    }
  });

  it("2. finds a planned item by topic, keyword, planning notes and its calendar", () => {
    const item = plan();
    for (const needle of ["unit size", "storage unit sizes", "sizing table", "Q2 plan"]) {
      expect(matchesSearch(item, needle)).toBe(true);
    }
  });

  it("3. finds a planned item by its content type label, not just the raw enum", () => {
    expect(matchesSearch(plan(), "guide")).toBe(true);
  });

  it("4. finds a page by its live URL", () => {
    expect(matchesSearch(content(), "example.com/faq")).toBe(true);
  });

  it("5. is case- and whitespace-insensitive, and an empty search matches everything", () => {
    expect(matchesSearch(content(), "  EMERGENCY  ")).toBe(true);
    expect(matchesSearch(content(), "")).toBe(true);
    expect(matchesSearch(content(), "   ")).toBe(true);
  });

  it("6. does not match something absent", () => {
    expect(matchesSearch(content(), "zzz nothing zzz")).toBe(false);
  });

  it("7. never searches a field the record does not have", () => {
    const bare = plan({ keyword: null, notes: null });
    expect(searchableText(bare)).not.toContain("null");
    expect(searchableText(bare)).not.toContain("undefined");
  });
});

describe("buildContentTypeOptions — only planned items carry a type", () => {
  it("8. builds options from planned items, with counts", () => {
    const options = buildContentTypeOptions([plan({ id: "p1" }), plan({ id: "p2" }), plan({ id: "p3", contentType: "ARTICLE" })]);
    expect(options).toEqual([
      { key: "ARTICLE", label: "Article", count: 1 },
      { key: "GUIDE", label: "Guide", count: 2 },
    ]);
  });

  it("9. ignores content pages entirely — they have no type column", () => {
    expect(buildContentTypeOptions([content(), content({ id: "c2" })])).toEqual([]);
  });

  it("10. reports whether the filter is worth offering at all", () => {
    expect(hasTypedItems([content()])).toBe(false);
    expect(hasTypedItems([content(), plan()])).toBe(true);
    expect(hasTypedItems([])).toBe(false);
  });

  it("11. sorts by human label rather than by enum value", () => {
    const options = buildContentTypeOptions([plan({ id: "a", contentType: "OTHER" }), plan({ id: "b", contentType: "ARTICLE" }), plan({ id: "c", contentType: "FAQ_PAGE" })]);
    expect(options.map((o) => o.label)).toEqual(["Article", "FAQ page", "Other"]);
  });
});

describe("groupIntoDays", () => {
  it("12. groups by day, in date order, omitting empty days", () => {
    const groups = groupIntoDays([
      plan({ id: "p2", scheduledDate: new Date("2026-06-10T00:00:00Z") }),
      content({ id: "c1", publishedAt: new Date("2026-06-01T00:00:00Z") }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-06-01", "2026-06-10"]);
  });

  it("13. skips undated items rather than bucketing them anywhere", () => {
    expect(groupIntoDays([content({ publishedAt: null })])).toEqual([]);
  });

  it("14. puts pages before plans within a day, then orders by title", () => {
    const groups = groupIntoDays([
      plan({ id: "p2", topic: "Zebra" }),
      plan({ id: "p1", topic: "Alpha" }),
      content(),
    ]);
    expect(groups[0].items.map((i) => i.title)).toEqual(["Emergency Plumbing FAQ", "Alpha", "Zebra"]);
  });

  it("15. is stable — grouping twice gives the same order", () => {
    const items = [plan({ id: "p2", topic: "Zebra" }), plan({ id: "p1", topic: "Alpha" }), content()];
    expect(JSON.stringify(groupIntoDays(items))).toBe(JSON.stringify(groupIntoDays(items)));
  });
});

describe("splitByKind — Agenda keeps the two sources apart", () => {
  it("16. separates pages from planned items", () => {
    const split = splitByKind([content(), plan(), plan({ id: "p2" })]);
    expect(split.CONTENT).toHaveLength(1);
    expect(split.PLAN).toHaveLength(2);
  });

  it("17. a plan marked PUBLISHED still sorts as a plan, never as a page", () => {
    const split = splitByKind([plan({ status: "PUBLISHED" })]);
    expect(split.CONTENT).toHaveLength(0);
    expect(split.PLAN).toHaveLength(1);
  });

  it("18. handles an empty list", () => {
    expect(splitByKind([])).toEqual({ CONTENT: [], PLAN: [] });
  });
});

describe("date headings", () => {
  it("19. formats a readable heading without needing a locale", () => {
    expect(formatDayHeading("2026-06-01")).toBe("Mon 1 Jun 2026");
    expect(formatDayHeading("2026-12-31")).toBe("Thu 31 Dec 2026");
  });

  it("20. falls back to the raw value for something unparseable", () => {
    expect(formatDayHeading("not-a-date")).toBe("not-a-date");
  });

  it("21. labels today, tomorrow and yesterday, and nothing else", () => {
    const today = parseIsoDate("2026-06-10")!;
    expect(relativeDayLabel("2026-06-10", today)).toBe("Today");
    expect(relativeDayLabel("2026-06-11", today)).toBe("Tomorrow");
    expect(relativeDayLabel("2026-06-09", today)).toBe("Yesterday");
    expect(relativeDayLabel("2026-06-12", today)).toBeNull();
    expect(relativeDayLabel("2026-06-01", today)).toBeNull();
  });

  it("22. relative labels work across a month boundary", () => {
    const today = parseIsoDate("2026-07-01")!;
    expect(relativeDayLabel("2026-06-30", today)).toBe("Yesterday");
  });
});

describe("resolveEmptyState — the most specific honest answer", () => {
  const base: EmptyStateInput = {
    contextItems: [],
    visibleItems: [],
    itemsInPeriod: [],
    clientHasNoProjects: false,
    periodLabel: "June 2026",
    contextLabel: "Acme Plumbing",
  };

  it("23. NONE when the period actually has something", () => {
    expect(resolveEmptyState({ ...base, itemsInPeriod: [content()] }).reason).toBe("NONE");
  });

  it("24. a client with no SEO projects but WITH content is not an empty state at all", () => {
    // Content belongs to the client now, so having no project says nothing
    // about whether there is content to show.
    const state = resolveEmptyState({ ...base, clientHasNoProjects: true, contextItems: [content()], visibleItems: [content()] });
    expect(state.reason).not.toBe("CLIENT_HAS_NO_PROJECTS");
  });

  it("24b. a client with no SEO projects AND no content is pointed at what it CAN create", () => {
    const state = resolveEmptyState({ ...base, clientHasNoProjects: true, contextItems: [], visibleItems: [] });
    expect(state.reason).toBe("CONTEXT_HAS_NOTHING");
    expect(state.detail).toMatch(/social post or a blog article/i);
    // It must NOT tell the user to go and create an SEO project.
    expect(state.detail).not.toMatch(/create (an )?SEO project/i);
  });

  it("25. an empty context says there is nothing yet, and names the context", () => {
    const state = resolveEmptyState(base);
    expect(state.reason).toBe("CONTEXT_HAS_NOTHING");
    expect(state.detail).toContain("Acme Plumbing");
  });

  it("26. filters excluding everything says so, and says how much is hidden", () => {
    const state = resolveEmptyState({ ...base, contextItems: [content(), plan()], visibleItems: [] });
    expect(state.reason).toBe("FILTERS_MATCH_NOTHING");
    expect(state.detail).toContain("2 items");
  });

  it("27. everything undated is reported as such — NOT as 'nothing this period'", () => {
    // The important branch: telling someone "nothing in June" would send them
    // hunting through months for content that can never appear on any of them.
    const undated = [content({ publishedAt: null }), content({ id: "c2", publishedAt: null })];
    const state = resolveEmptyState({ ...base, contextItems: undated, visibleItems: undated });
    expect(state.reason).toBe("ALL_ITEMS_UNDATED");
    expect(state.title).toBe("Nothing has a date yet");
    expect(state.detail).toContain("2 items");
    expect(state.detail).not.toContain("June 2026");
  });

  it("28. singular wording when exactly one item is undated", () => {
    const state = resolveEmptyState({ ...base, contextItems: [content({ publishedAt: null })], visibleItems: [content({ publishedAt: null })] });
    expect(state.detail).toContain("1 item is");
  });

  it("29. dated items elsewhere gives 'nothing in this period', naming the period", () => {
    const dated = [content()];
    const state = resolveEmptyState({ ...base, contextItems: dated, visibleItems: dated, itemsInPeriod: [] });
    expect(state.reason).toBe("NOTHING_IN_THIS_PERIOD");
    expect(state.title).toBe("Nothing in June 2026");
  });

  it("30. never claims anything is scheduled", () => {
    for (const input of [
      base,
      { ...base, clientHasNoProjects: true },
      { ...base, contextItems: [content(), plan()], visibleItems: [] },
      { ...base, contextItems: [content({ publishedAt: null })], visibleItems: [content({ publishedAt: null })] },
      { ...base, contextItems: [content()], visibleItems: [content()] },
    ]) {
      const state = resolveEmptyState(input);
      expect(`${state.title} ${state.detail}`).not.toMatch(/\bscheduled\b/i);
    }
  });

  it("31. every reason produces a non-empty message except NONE", () => {
    for (const input of [
      base,
      { ...base, clientHasNoProjects: true },
      { ...base, contextItems: [content(), plan()], visibleItems: [] },
      { ...base, contextItems: [content({ publishedAt: null })], visibleItems: [content({ publishedAt: null })] },
      { ...base, contextItems: [content()], visibleItems: [content()] },
    ]) {
      const state = resolveEmptyState(input);
      expect(state.reason).not.toBe("NONE");
      expect(state.title.length).toBeGreaterThan(0);
      expect(state.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("undatedNote — honest about what the filters hide", () => {
  it("32. plain explanation when nothing is hidden", () => {
    expect(undatedNote(3, 3)).toBe("These have no publish date yet, so they cannot be placed on a day.");
  });

  it("33. reports the shortfall when filters hide some", () => {
    expect(undatedNote(7, 2)).toBe("Showing 2 of 7 undated items — the rest are hidden by the current filters.");
  });
});
