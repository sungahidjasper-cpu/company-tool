import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    content: { findMany: vi.fn() },
    contentCalendarEntry: { findMany: vi.fn() },
    sEOProject: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  EMPTY_FILTERS,
  NO_CLIENT,
  countBy,
  datedItems,
  filterItems,
  groupByDate,
  statusKey,
  toContentItem,
  toPlanItem,
  undatedItems,
  type ContentRow,
  CONTENT_TYPE_KEYS,
  contentTypeBadge,
  planTypeLabel,
  type PlanRow,
  type WorkspaceItem,
} from "@/features/content-workspace/services/content-calendar-feed";
import { loadWorkspaceFeed, loadWorkspaceScope } from "@/features/content-workspace/services/content-workspace.queries";

const PROJECT_A = { id: "project-a", name: "Storage Moguls", clientId: "client-1", client: { name: "Acme Plumbing" } };
const PROJECT_B = { id: "project-b", name: "Side Project", clientId: null, client: null };

const PUBLISHED: ContentRow = {
  id: "content-1",
  title: "Emergency Plumbing FAQ",
  url: "https://example.com/faq",
  status: "PUBLISHED",
  publishedAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-02T09:00:00Z"),
  generatedByAi: false,
  clientId: PROJECT_A.clientId,
  client: { id: PROJECT_A.clientId, name: PROJECT_A.client.name },
  contentType: null,
  seoProjectId: PROJECT_A.id,
  seoProject: PROJECT_A,};

const UNDATED_DRAFT: ContentRow = {
  id: "content-2",
  title: "Water Heater Costs",
  url: null,
  status: "DRAFT",
  publishedAt: null,
  updatedAt: new Date("2026-05-20T09:00:00Z"),
  generatedByAi: true,
  clientId: null,
  client: null,
  contentType: null,
  seoProjectId: PROJECT_B.id,
  seoProject: PROJECT_B,};

const PLAN: PlanRow = {
  id: "entry-1",
  topic: "Choosing a unit size",
  scheduledDate: new Date("2026-10-08T00:00:00Z"),
  status: "PLANNED",
  contentType: "GUIDE",
  role: "SUPPORTING",
  notes: "Include a table.",
  contentId: null,
  keyword: { term: "storage unit sizes" },
  calendar: { id: "cal-1", name: "Q4 plan", seoProject: PROJECT_A },
};

describe("toContentItem — a page's only calendar date is its publish date", () => {
  it("1. places published content on its publish date and labels it honestly", () => {
    const item = toContentItem(PUBLISHED);
    expect(item.date).toBe("2026-06-01");
    expect(item.dateLabel).toBe("Published");
    expect(item.kind).toBe("CONTENT");
  });

  it("2. leaves content with no publish date UNDATED, rather than using created/updated", () => {
    const item = toContentItem(UNDATED_DRAFT);
    expect(item.date).toBeNull();
    expect(item.dateLabel).toBeNull();
    // The updatedAt value exists but is never used as the calendar date.
    expect(item.detail.lastModified).toBe("2026-05-20");
  });

  it("3. claims NO content type — the Content model has no such column", () => {
    expect(toContentItem(PUBLISHED).contentType).toBeNull();
    expect(toContentItem(UNDATED_DRAFT).contentType).toBeNull();
  });

  it("4. carries the project and client through from the server-resolved relation", () => {
    const item = toContentItem(PUBLISHED);
    expect(item.seoProjectId).toBe("project-a");
    expect(item.seoProjectName).toBe("Storage Moguls");
    expect(item.clientId).toBe("client-1");
    expect(item.clientName).toBe("Acme Plumbing");
  });

  it("5. reports no client rather than inventing one", () => {
    const item = toContentItem(UNDATED_DRAFT);
    expect(item.clientId).toBeNull();
    expect(item.clientName).toBeNull();
  });

  it("6. links to the EXISTING content detail route", () => {
    expect(toContentItem(PUBLISHED).href).toBe("/seo/project-a/content/content-1");
  });

  it("7. uses the content lifecycle's own status labels", () => {
    expect(toContentItem(PUBLISHED).statusLabel).toBe("Published");
    expect(toContentItem(UNDATED_DRAFT).statusLabel).toBe("Draft");
    expect(toContentItem({ ...PUBLISHED, status: "IN_REVIEW" }).statusLabel).toBe("In review");
  });
});

describe("toPlanItem — a plan is an intention, never a page", () => {
  it("8. places a plan entry on its planned date and labels it as planned", () => {
    const item = toPlanItem(PLAN);
    expect(item.date).toBe("2026-10-08");
    expect(item.dateLabel).toBe("Planned for");
    expect(item.kind).toBe("PLAN");
  });

  it("9. carries the plan's own type, role, keyword and calendar", () => {
    const item = toPlanItem(PLAN);
    expect(item.contentType).toBe("GUIDE");
    expect(item.detail.role).toBe("Supporting");
    expect(item.detail.keywordTerm).toBe("storage unit sizes");
    expect(item.detail.calendarName).toBe("Q4 plan");
  });

  it("10. opens the saved calendar when it links to no page", () => {
    expect(toPlanItem(PLAN).href).toBe("/ai/content-calendar/cal-1");
  });

  it("11. opens the LINKED PAGE when there is one — a plan is not a second content record", () => {
    expect(toPlanItem({ ...PLAN, contentId: "content-9" }).href).toBe("/seo/project-a/content/content-9");
  });

  it("12. uses the plan lifecycle's own status labels", () => {
    expect(toPlanItem(PLAN).statusLabel).toBe("Planned");
    expect(toPlanItem({ ...PLAN, status: "BRIEF_CREATED" }).statusLabel).toBe("Brief created");
    expect(toPlanItem({ ...PLAN, status: "IN_PROGRESS" }).statusLabel).toBe("In progress");
  });
});

describe("the two lifecycles stay separate", () => {
  it("13. a plan marked PUBLISHED is still a PLAN, never shown as a page", () => {
    const item = toPlanItem({ ...PLAN, status: "PUBLISHED" });
    expect(item.kind).toBe("PLAN");
    expect(item.dateLabel).toBe("Planned for");
  });

  it("14. status keys are namespaced, so one lifecycle cannot select the other", () => {
    const plan = toPlanItem({ ...PLAN, status: "PUBLISHED" });
    const page = toContentItem(PUBLISHED);
    expect(statusKey(plan.kind, plan.status)).not.toBe(statusKey(page.kind, page.status));
  });

  it("15. item ids are namespaced, so a plan and a page can never collide", () => {
    expect(toContentItem(PUBLISHED).id).toBe("content-content-1");
    expect(toPlanItem(PLAN).id).toBe("plan-entry-1");
  });
});

describe("dated / undated separation", () => {
  const items = [toContentItem(PUBLISHED), toContentItem(UNDATED_DRAFT), toPlanItem(PLAN)];

  it("16. only items with a real date can reach the grid", () => {
    expect(datedItems(items).map((item) => item.title)).toEqual(["Emergency Plumbing FAQ", "Choosing a unit size"]);
  });

  it("17. undated items are kept, not dropped", () => {
    expect(undatedItems(items).map((item) => item.title)).toEqual(["Water Heater Costs"]);
  });

  it("18. every item is in exactly one of the two groups", () => {
    expect(datedItems(items).length + undatedItems(items).length).toBe(items.length);
  });
});

describe("groupByDate", () => {
  it("19. buckets items by their day", () => {
    const grouped = groupByDate([toContentItem(PUBLISHED), toPlanItem(PLAN)]);
    expect([...grouped.keys()].sort()).toEqual(["2026-06-01", "2026-10-08"]);
  });

  it("20. ignores undated items rather than bucketing them under a guessed key", () => {
    const grouped = groupByDate([toContentItem(UNDATED_DRAFT)]);
    expect(grouped.size).toBe(0);
  });

  it("21. puts pages before plans within a day, then orders by title", () => {
    const sameDay = groupByDate([
      toPlanItem({ ...PLAN, id: "p2", topic: "Zebra plan", scheduledDate: new Date("2026-06-01T00:00:00Z") }),
      toPlanItem({ ...PLAN, id: "p1", topic: "Alpha plan", scheduledDate: new Date("2026-06-01T00:00:00Z") }),
      toContentItem(PUBLISHED),
    ]).get("2026-06-01")!;
    expect(sameDay.map((item) => item.title)).toEqual(["Emergency Plumbing FAQ", "Alpha plan", "Zebra plan"]);
  });
});

describe("filterItems — display only", () => {
  const items: WorkspaceItem[] = [toContentItem(PUBLISHED), toContentItem(UNDATED_DRAFT), toPlanItem(PLAN)];

  it("22. no filters shows everything", () => {
    expect(filterItems(items, EMPTY_FILTERS)).toHaveLength(3);
  });

  it("23. filters by item kind", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, kinds: ["PLAN"] }).map((i) => i.title)).toEqual(["Choosing a unit size"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, kinds: ["CONTENT"] })).toHaveLength(2);
  });

  it("24. filters by SEO project", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, seoProjectIds: ["project-b"] }).map((i) => i.title)).toEqual(["Water Heater Costs"]);
  });

  it("25. filters by client, including the no-client group", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, clientIds: ["client-1"] })).toHaveLength(2);
    expect(filterItems(items, { ...EMPTY_FILTERS, clientIds: [NO_CLIENT] }).map((i) => i.title)).toEqual(["Water Heater Costs"]);
  });

  it("26. filters by status within the correct lifecycle only", () => {
    const pagePublished = filterItems(items, { ...EMPTY_FILTERS, statuses: ["CONTENT:PUBLISHED"] });
    expect(pagePublished.map((i) => i.title)).toEqual(["Emergency Plumbing FAQ"]);

    // A plan whose status is also PUBLISHED must NOT be selected by the page filter.
    const withPublishedPlan = [...items, toPlanItem({ ...PLAN, id: "p9", status: "PUBLISHED" })];
    expect(filterItems(withPublishedPlan, { ...EMPTY_FILTERS, statuses: ["CONTENT:PUBLISHED"] })).toHaveLength(1);
    expect(filterItems(withPublishedPlan, { ...EMPTY_FILTERS, statuses: ["PLAN:PUBLISHED"] })).toHaveLength(1);
  });

  it("27. searches titles, projects, clients and keywords", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "water heater" }).map((i) => i.title)).toEqual(["Water Heater Costs"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "storage moguls" })).toHaveLength(2);
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "acme" })).toHaveLength(2);
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "unit sizes" }).map((i) => i.title)).toEqual(["Choosing a unit size"]);
  });

  it("28. search is case- and whitespace-tolerant, and empty search does not filter", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "  EMERGENCY  " })).toHaveLength(1);
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "   " })).toHaveLength(3);
  });

  it("29. combines dimensions as AND", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, kinds: ["CONTENT"], clientIds: [NO_CLIENT] }).map((i) => i.title)).toEqual(["Water Heater Costs"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, kinds: ["PLAN"], clientIds: [NO_CLIENT] })).toHaveLength(0);
  });

  it("30. a search matching nothing yields an empty list rather than everything", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "nothing matches this" })).toHaveLength(0);
  });
});

describe("countBy", () => {
  it("31. counts per dimension and skips nulls", () => {
    const items = [toContentItem(PUBLISHED), toContentItem(UNDATED_DRAFT), toPlanItem(PLAN)];
    expect(countBy(items, (i) => i.kind).get("CONTENT")).toBe(2);
    expect(countBy(items, (i) => i.clientId).get("client-1")).toBe(2);
    expect(countBy(items, (i) => i.clientId).has(NO_CLIENT)).toBe(false);
    expect(countBy(items, (i) => i.clientId ?? NO_CLIENT).get(NO_CLIENT)).toBe(1);
  });
});

describe("loadWorkspaceFeed — ownership and soft-delete scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.content.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.contentCalendarEntry.findMany).mockResolvedValue([] as never);
  });

  it("32. scopes content to the company directly — content is company-owned now", async () => {
    await loadWorkspaceFeed("company-1");
    expect(prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, companyId: "company-1" } })
    );
  });

  it("33. scopes plan entries through their calendar to the company and a LIVE project", async () => {
    await loadWorkspaceFeed("company-1");
    expect(prisma.contentCalendarEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          calendar: { deletedAt: null, seoProject: { companyId: "company-1", deletedAt: null } },
        },
      })
    );
  });

  it("34. never selects a content body or brief JSON — the calendar does not need them", async () => {
    await loadWorkspaceFeed("company-1");
    const select = vi.mocked(prisma.content.findMany).mock.calls[0][0]!.select as Record<string, unknown>;
    expect(select.body).toBeUndefined();
    expect(select.aiBriefDetails).toBeUndefined();
  });

  it("35. performs reads only — no write method is even reachable on the mock", async () => {
    await loadWorkspaceFeed("company-1");
    const contentModel = prisma.content as unknown as Record<string, unknown>;
    const entryModel = prisma.contentCalendarEntry as unknown as Record<string, unknown>;
    for (const model of [contentModel, entryModel]) {
      expect(model.create).toBeUndefined();
      expect(model.update).toBeUndefined();
      expect(model.delete).toBeUndefined();
      expect(model.upsert).toBeUndefined();
    }
  });

  it("36. returns both sources combined", async () => {
    vi.mocked(prisma.content.findMany).mockResolvedValue([PUBLISHED] as never);
    vi.mocked(prisma.contentCalendarEntry.findMany).mockResolvedValue([PLAN] as never);

    const items = await loadWorkspaceFeed("company-1");

    expect(items.map((item) => item.kind)).toEqual(["CONTENT", "PLAN"]);
  });

  it("37. a different company id produces a differently scoped query", async () => {
    await loadWorkspaceFeed("company-OTHER");
    expect(prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-OTHER" }) })
    );
  });
});

describe("loadWorkspaceScope — Phase 2 contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.sEOProject.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.client.findMany).mockResolvedValue([] as never);
  });

  it("38. lists only the company's LIVE projects", async () => {
    await loadWorkspaceScope("company-1");
    expect(prisma.sEOProject.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "company-1", deletedAt: null } }));
  });

  it("39. lists the company's LIVE clients from the shared client helper", async () => {
    // Phase 2 changed this deliberately: clients no longer come from whichever
    // projects happen to have one, so a client with no project is still
    // selectable and can be told plainly that it has nothing.
    await loadWorkspaceScope("company-1");
    expect(prisma.client.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "company-1", deletedAt: null } }));
  });

  it("40. returns clients even when NO project references them", async () => {
    vi.mocked(prisma.sEOProject.findMany).mockResolvedValue([{ id: "p1", name: "House project", clientId: null }] as never);
    vi.mocked(prisma.client.findMany).mockResolvedValue([{ id: "c1", name: "Acme" }] as never);

    const scope = await loadWorkspaceScope("company-1");

    expect(scope.clients).toEqual([{ id: "c1", name: "Acme" }]);
    expect(scope.projects).toEqual([{ id: "p1", name: "House project", clientId: null }]);
    expect(scope.hasProjectWithoutClient).toBe(true);
  });

  it("41. reports no unassigned group when every project has a client", async () => {
    vi.mocked(prisma.sEOProject.findMany).mockResolvedValue([{ id: "p1", name: "Acme SEO", clientId: "c1" }] as never);
    vi.mocked(prisma.client.findMany).mockResolvedValue([{ id: "c1", name: "Acme" }] as never);

    expect((await loadWorkspaceScope("company-1")).hasProjectWithoutClient).toBe(false);
  });
});

describe("loadWorkspaceFeed — Phase 2 project scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.content.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.contentCalendarEntry.findMany).mockResolvedValue([] as never);
  });

  it("42. with no restriction, scopes to the company — NOT through a project", async () => {
    await loadWorkspaceFeed("company-1");
    expect(prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, companyId: "company-1" } })
    );
  });

  it("42b. CLIENT-FIRST: a client scope queries the content's own clientId", async () => {
    await loadWorkspaceFeed("company-1", { clientId: "client-1" });
    expect(prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, companyId: "company-1", clientId: "client-1" } })
    );
  });

  it("42c. a client with NO SEO project is still a real query, not an empty result", async () => {
    const items = await loadWorkspaceFeed("company-1", { clientId: "client-with-no-projects" });
    expect(prisma.content.findMany).toHaveBeenCalled();
    expect(Array.isArray(items)).toBe(true);
  });

  it("42d. 'no client' is a scope of its own, not the whole company", async () => {
    await loadWorkspaceFeed("company-1", { clientId: null });
    expect(prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, companyId: "company-1", clientId: null } })
    );
  });

  it("43. a project restriction NARROWS the company clause, never replaces it", async () => {
    await loadWorkspaceFeed("company-1", { projectIds: ["project-a", "project-b"] });
    expect(prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, companyId: "company-1", seoProjectId: { in: ["project-a", "project-b"] } },
      })
    );
  });

  it("43b. a project filter applies ON TOP of the client scope", async () => {
    await loadWorkspaceFeed("company-1", { clientId: "client-1", projectIds: ["project-a"] });
    expect(prisma.content.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, companyId: "company-1", clientId: "client-1", seoProjectId: { in: ["project-a"] } },
      })
    );
  });

  it("44. plan entries are restricted through their calendar the same way", async () => {
    await loadWorkspaceFeed("company-1", { projectIds: ["project-a"] });
    expect(prisma.contentCalendarEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          calendar: { deletedAt: null, seoProject: { companyId: "company-1", deletedAt: null, id: { in: ["project-a"] } } },
        },
      })
    );
  });

  it("45. an EMPTY project restriction returns nothing — it must not widen back to the client", async () => {
    const items = await loadWorkspaceFeed("company-1", { projectIds: [] });
    expect(items).toEqual([]);
    expect(prisma.content.findMany).not.toHaveBeenCalled();
    expect(prisma.contentCalendarEntry.findMany).not.toHaveBeenCalled();
  });

  it("46. still performs reads only", async () => {
    await loadWorkspaceFeed("company-1", { projectIds: ["project-a"] });
    for (const model of [prisma.content, prisma.contentCalendarEntry] as unknown as Record<string, unknown>[]) {
      expect(model.create).toBeUndefined();
      expect(model.update).toBeUndefined();
      expect(model.delete).toBeUndefined();
    }
  });
});

describe("Phase 3 — content-type filtering and view consistency", () => {
  const page = toContentItem(PUBLISHED);
  const undatedPage = toContentItem(UNDATED_DRAFT);
  const guide = toPlanItem(PLAN);
  const article = toPlanItem({ ...PLAN, id: "e2", topic: "A short article", contentType: "ARTICLE", notes: "Keep it brief" });
  const items = [page, undatedPage, guide, article];

  it("47. filters by content type", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, contentTypes: ["GUIDE"] }).map((i) => i.title)).toEqual(["Choosing a unit size"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, contentTypes: ["GUIDE", "ARTICLE"] })).toHaveLength(2);
  });

  it("48. a type restriction necessarily excludes pages, because pages carry no type", () => {
    const result = filterItems(items, { ...EMPTY_FILTERS, contentTypes: ["GUIDE"] });
    expect(result.every((i) => i.kind === "PLAN")).toBe(true);
  });

  it("49. an unknown type matches nothing rather than everything", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, contentTypes: ["TIKTOK"] })).toEqual([]);
  });

  it("50. no type restriction leaves pages visible", () => {
    expect(filterItems(items, EMPTY_FILTERS)).toHaveLength(4);
  });

  it("51. type combines with the other dimensions as AND", () => {
    expect(filterItems(items, { ...EMPTY_FILTERS, contentTypes: ["GUIDE"], statuses: ["PLAN:PLANNED"] })).toHaveLength(1);
    expect(filterItems(items, { ...EMPTY_FILTERS, contentTypes: ["GUIDE"], kinds: ["CONTENT"] })).toHaveLength(0);
  });

  it("52. search now reaches planning notes and the source calendar", () => {
    // Notes are per-entry, so each matches only its own item...
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "include a table" }).map((i) => i.title)).toEqual(["Choosing a unit size"]);
    expect(filterItems(items, { ...EMPTY_FILTERS, search: "keep it brief" }).map((i) => i.title)).toEqual(["A short article"]);
    // ...while the calendar name is shared, so it matches both plans and no page.
    const byCalendar = filterItems(items, { ...EMPTY_FILTERS, search: "Q4 plan" });
    expect(byCalendar).toHaveLength(2);
    expect(byCalendar.every((i) => i.kind === "PLAN")).toBe(true);
  });

  it("53. filtering is view-independent — it runs before any date windowing", () => {
    // Every view narrows the SAME filtered set by date, so a filter cannot
    // behave differently in Month than in Agenda.
    const filtered = filterItems(items, { ...EMPTY_FILTERS, kinds: ["PLAN"] });
    expect(datedItems(filtered)).toHaveLength(2);
    expect(undatedItems(filtered)).toHaveLength(0);
    expect(filtered.every((i) => i.kind === "PLAN")).toBe(true);
  });

  it("54. undated items survive filtering and stay out of the dated set", () => {
    const filtered = filterItems(items, { ...EMPTY_FILTERS, kinds: ["CONTENT"] });
    expect(undatedItems(filtered).map((i) => i.title)).toEqual(["Water Heater Costs"]);
    expect(datedItems(filtered).map((i) => i.title)).toEqual(["Emergency Plumbing FAQ"]);
  });
});

/* ------------------- client-first content in the calendar feed ---------- */

describe("a content row with NO SEO project is a first-class calendar item", () => {
  const CLIENT_ONLY: ContentRow = {
    id: "content-client-only",
    title: "Instagram launch post",
    url: null,
    status: "DRAFT",
    publishedAt: null,
    updatedAt: new Date("2026-09-11T09:00:00Z"),
    generatedByAi: false,
    clientId: "client-9",
    client: { id: "client-9", name: "Catawba Yaupon" },
    contentType: null,
    seoProjectId: null,
    seoProject: null,
  };

  it("47. it maps without throwing, which the old shape could not do", () => {
    const item = toContentItem(CLIENT_ONLY);
    expect(item.title).toBe("Instagram launch post");
  });

  it("48. its client comes from the record itself, not from a project", () => {
    const item = toContentItem(CLIENT_ONLY);
    expect(item.clientId).toBe("client-9");
    expect(item.clientName).toBe("Catawba Yaupon");
  });

  it("49. it reports no project rather than a fabricated one", () => {
    const item = toContentItem(CLIENT_ONLY);
    expect(item.seoProjectId).toBeNull();
    expect(item.seoProjectName).toBeNull();
  });

  it("50. it links to the client-first address, since it has no project address", () => {
    expect(toContentItem(CLIENT_ONLY).href).toBe("/content/content-client-only");
  });

  it("51. project content still links to its EXISTING SEO address", () => {
    expect(toContentItem(PUBLISHED).href).toBe(`/seo/${PROJECT_A.id}/content/${PUBLISHED.id}`);
  });

  it("52. a project FILTER excludes it — a filter narrows and never widens", () => {
    const items = [toContentItem(CLIENT_ONLY), toContentItem(PUBLISHED)];
    const filtered = filterItems(items, { ...EMPTY_FILTERS, seoProjectIds: [PROJECT_A.id] });
    expect(filtered.map((item) => item.id)).toEqual([`content-${PUBLISHED.id}`]);
  });

  it("53. with no project filter it is included, alongside project content", () => {
    const items = [toContentItem(CLIENT_ONLY), toContentItem(PUBLISHED)];
    expect(filterItems(items, EMPTY_FILTERS)).toHaveLength(2);
  });

  it("54. a CLIENT filter includes it — the client is what it belongs to", () => {
    const items = [toContentItem(CLIENT_ONLY), toContentItem(PUBLISHED)];
    const filtered = filterItems(items, { ...EMPTY_FILTERS, clientIds: ["client-9"] });
    expect(filtered.map((item) => item.id)).toEqual(["content-content-client-only"]);
  });
});

/* --------------------------- content type as a real field --------------- */

describe("a content record states its own type", () => {
  const typed = (contentType: string | null, over: Partial<ContentRow> = {}): ContentRow => ({
    id: `c-${contentType ?? "none"}`,
    title: `${contentType ?? "untyped"} item`,
    url: null,
    status: "DRAFT",
    publishedAt: null,
    updatedAt: new Date("2026-09-10T09:00:00Z"),
    generatedByAi: false,
    clientId: "client-1",
    client: { id: "client-1", name: "Catawba Yaupon" },
    contentType,
    seoProjectId: null,
    seoProject: null,
    ...over,
  });

  it("55. a social post reports SOCIAL_POST from its own column", () => {
    expect(toContentItem(typed("SOCIAL_POST")).contentType).toBe("SOCIAL_POST");
  });

  it("56. a blog post reports BLOG_POST — previously indistinguishable from SEO content", () => {
    expect(toContentItem(typed("BLOG_POST")).contentType).toBe("BLOG_POST");
  });

  it("57. SEO content reports SEO_CONTENT", () => {
    expect(toContentItem(typed("SEO_CONTENT")).contentType).toBe("SEO_CONTENT");
  });

  it("58. an unclassified record reports NOTHING rather than a guess", () => {
    expect(toContentItem(typed(null)).contentType).toBeNull();
  });

  it("59. a social half still proves SOCIAL_POST if the column was never written", () => {
    expect(toContentItem(typed(null, { socialPost: { id: "sp-1" } })).contentType).toBe("SOCIAL_POST");
  });

  it("60. each type has a readable label", () => {
    expect(planTypeLabel("SOCIAL_POST")).toBe("Social post");
    expect(planTypeLabel("BLOG_POST")).toBe("Blog post");
    expect(planTypeLabel("SEO_CONTENT")).toBe("SEO content");
    expect(planTypeLabel("NEWSLETTER")).toBe("Newsletter");
    expect(planTypeLabel("PRESS_RELEASE")).toBe("Press release");
  });

  it("61. each type has a short TEXT badge — never colour alone", () => {
    expect(contentTypeBadge("SOCIAL_POST")).toBe("SOCIAL");
    expect(contentTypeBadge("BLOG_POST")).toBe("BLOG");
    expect(contentTypeBadge("SEO_CONTENT")).toBe("SEO");
    expect(contentTypeBadge("NEWSLETTER")).toBe("NEWSLETTER");
    expect(contentTypeBadge("PRESS_RELEASE")).toBe("PRESS RELEASE");
  });

  it("60b. a Newsletter/Press Release record reports its own recorded type, same as every other content type", () => {
    expect(toContentItem(typed("NEWSLETTER")).contentType).toBe("NEWSLETTER");
    expect(toContentItem(typed("PRESS_RELEASE")).contentType).toBe("PRESS_RELEASE");
  });

  it("62. an unrecorded type gets no badge, and a plan type gets none either", () => {
    expect(contentTypeBadge(null)).toBeNull();
    expect(contentTypeBadge("ARTICLE")).toBeNull();
  });
});

describe("the content type filter narrows and never widens", () => {
  const item = (contentType: string | null, id: string) =>
    toContentItem({
      id, title: `${contentType ?? "untyped"} ${id}`, url: null, status: "DRAFT", publishedAt: null,
      updatedAt: new Date("2026-09-10T09:00:00Z"), generatedByAi: false,
      clientId: "client-1", client: { id: "client-1", name: "Catawba Yaupon" },
      contentType, seoProjectId: null, seoProject: null,
    });

  const all = [item("SOCIAL_POST", "a"), item("BLOG_POST", "b"), item("SEO_CONTENT", "c"), item(null, "d")];

  it("63. no type selected shows everything, including unclassified records", () => {
    expect(filterItems(all, EMPTY_FILTERS)).toHaveLength(4);
  });

  it("64. selecting Social shows only social posts", () => {
    const got = filterItems(all, { ...EMPTY_FILTERS, contentTypes: ["SOCIAL_POST"] });
    expect(got.map((i) => i.contentType)).toEqual(["SOCIAL_POST"]);
  });

  it("65. selecting Blog shows only blog posts", () => {
    const got = filterItems(all, { ...EMPTY_FILTERS, contentTypes: ["BLOG_POST"] });
    expect(got.map((i) => i.contentType)).toEqual(["BLOG_POST"]);
  });

  it("65b. selecting Newsletter or Press Release filters the same way as every other content type", () => {
    const withNewComers = [...all, item("NEWSLETTER", "e"), item("PRESS_RELEASE", "f")];
    expect(filterItems(withNewComers, { ...EMPTY_FILTERS, contentTypes: ["NEWSLETTER"] }).map((i) => i.contentType)).toEqual(["NEWSLETTER"]);
    expect(filterItems(withNewComers, { ...EMPTY_FILTERS, contentTypes: ["PRESS_RELEASE"] }).map((i) => i.contentType)).toEqual(["PRESS_RELEASE"]);
  });

  it("66. selecting several types unions them, and still excludes the unclassified", () => {
    const got = filterItems(all, { ...EMPTY_FILTERS, contentTypes: ["SOCIAL_POST", "BLOG_POST"] });
    expect(got).toHaveLength(2);
    expect(got.every((i) => i.contentType !== null)).toBe(true);
  });

  it("67. a type filter NEVER widens — it cannot add an item the client scope excluded", () => {
    const otherClient = filterItems(all, { ...EMPTY_FILTERS, clientIds: ["client-other"] });
    expect(otherClient).toHaveLength(0);
    const withType = filterItems(all, { ...EMPTY_FILTERS, clientIds: ["client-other"], contentTypes: ["SOCIAL_POST"] });
    expect(withType).toHaveLength(0);
  });

  it("68. the type filter composes with the project filter, narrowing both ways", () => {
    const projectItem = toContentItem({
      id: "e", title: "in a project", url: null, status: "DRAFT", publishedAt: null,
      updatedAt: new Date("2026-09-10T09:00:00Z"), generatedByAi: false,
      clientId: "client-1", client: { id: "client-1", name: "Catawba Yaupon" },
      contentType: "SEO_CONTENT", seoProjectId: "project-1",
      seoProject: { id: "project-1", name: "P", clientId: "client-1", client: { name: "Catawba Yaupon" } },
    });
    const got = filterItems([...all, projectItem], { ...EMPTY_FILTERS, seoProjectIds: ["project-1"], contentTypes: ["SEO_CONTENT"] });
    expect(got.map((i) => i.id)).toEqual(["content-e"]);
  });
});

/* ------------------- the two type vocabularies stay apart --------------- */

describe("real content types are distinguishable from planned-item types", () => {
  it("69. only the five real content types are listed as content types", () => {
    expect([...CONTENT_TYPE_KEYS].sort()).toEqual(["BLOG_POST", "NEWSLETTER", "PRESS_RELEASE", "SEO_CONTENT", "SOCIAL_POST"]);
  });

  it("70. planned-item types are NOT content types — they belong to their own control", () => {
    for (const planType of ["ARTICLE", "GUIDE", "LANDING_PAGE", "FAQ_PAGE", "CASE_STUDY", "COMPARISON", "OTHER"]) {
      expect(CONTENT_TYPE_KEYS.includes(planType)).toBe(false);
    }
  });

  it("71. every content type still has a badge, and no plan type does", () => {
    for (const key of CONTENT_TYPE_KEYS) expect(contentTypeBadge(key)).not.toBeNull();
    for (const planType of ["ARTICLE", "GUIDE", "OTHER"]) expect(contentTypeBadge(planType)).toBeNull();
  });

  it("72. both vocabularies still read correctly from the shared label map", () => {
    expect(planTypeLabel("SOCIAL_POST")).toBe("Social post");
    expect(planTypeLabel("GUIDE")).toBe("Guide");
  });
});
