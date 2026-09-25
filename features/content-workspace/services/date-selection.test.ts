import { describe, expect, it } from "vitest";

import { formatIsoDate, parseIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { CALENDAR_VIEWS, windowForView } from "@/features/content-workspace/services/calendar-grid";
import { toContentItem, toPlanItem, type ContentRow, type PlanRow, type WorkspaceItem } from "@/features/content-workspace/services/content-calendar-feed";
import {
  DAY_PANEL_ACTIONS,
  SCHEDULING_FROM_DATE_UNAVAILABLE,
  dayContext,
  isDateSelected,
  resolveDateClick,
} from "@/features/content-workspace/services/date-selection";
import { ALL_CLIENTS_SELECTION, buildWorkspaceHref } from "@/features/content-workspace/services/workspace-context";

const PROJECT = { id: "project-a", name: "Storage Moguls", clientId: "client-1", client: { name: "Acme Plumbing" } };
const TODAY = parseIsoDate("2026-09-09")!;

const content = (over: Partial<ContentRow> = {}): WorkspaceItem =>
  toContentItem({
    id: "c1",
    title: "Emergency Plumbing FAQ",
    url: "https://example.com/faq",
    status: "PUBLISHED",
    publishedAt: parseIsoDate("2026-09-20"),
    updatedAt: parseIsoDate("2026-09-20")!,
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
    scheduledDate: parseIsoDate("2026-09-20")!,
    status: "PLANNED",
    contentType: "GUIDE",
    role: "SUPPORTING",
    notes: null,
    contentId: null,
    keyword: null,
    calendar: { id: "cal-1", name: "Q3 plan", seoProject: PROJECT },
    ...over,
  });

describe("resolveDateClick — a date click is navigation, never a write", () => {
  it("1. Month keeps Month and selects the clicked day", () => {
    expect(resolveDateClick("MONTH", "2026-09-20", "2026-09-01")).toEqual({ anchorIso: "2026-09-20", view: "MONTH" });
  });

  it("2. Week keeps Week and selects the clicked day", () => {
    expect(resolveDateClick("WEEK", "2026-09-20", "2026-09-16")).toEqual({ anchorIso: "2026-09-20", view: "WEEK" });
  });

  it("3. Agenda moves to the Day view for the chosen date, rather than appearing to do nothing", () => {
    expect(resolveDateClick("AGENDA", "2026-09-20", "2026-09-01")).toEqual({ anchorIso: "2026-09-20", view: "DAY" });
  });

  it("4. Day stays on Day — a date interaction there must not move the user somewhere else", () => {
    expect(resolveDateClick("DAY", "2026-09-20", "2026-09-19")).toEqual({ anchorIso: "2026-09-20", view: "DAY" });
  });

  it("5. returns navigation ONLY — no field exists that could create, schedule or publish anything", () => {
    for (const view of CALENDAR_VIEWS) {
      const result = resolveDateClick(view, "2026-09-20", "2026-09-01");
      expect(Object.keys(result).sort()).toEqual(["anchorIso", "view"]);
      expect(JSON.stringify(result)).not.toMatch(/schedul|creat|publish|status/i);
    }
  });

  it("6. a malformed date changes nothing at all", () => {
    for (const bad of ["", "  ", "not-a-date", "2026-13-45", "20/09/2026"]) {
      expect(resolveDateClick("MONTH", bad, "2026-09-01")).toEqual({ anchorIso: "2026-09-01", view: "MONTH" });
    }
  });

  it("7. every view resolves to a real view, never undefined", () => {
    for (const view of CALENDAR_VIEWS) {
      expect(CALENDAR_VIEWS).toContain(resolveDateClick(view, "2026-09-20", "2026-09-01").view);
    }
  });

  it("8. selecting a date the user is already on is idempotent", () => {
    const once = resolveDateClick("MONTH", "2026-09-20", "2026-09-20");
    const twice = resolveDateClick(once.view, once.anchorIso, once.anchorIso);
    expect(twice).toEqual(once);
  });
});

describe("the selected date stays consistent across views", () => {
  it("9. the chosen day is inside the period every view then shows", () => {
    const picked = "2026-09-20";
    for (const view of CALENDAR_VIEWS) {
      const { anchorIso, view: nextView } = resolveDateClick(view, picked, "2026-09-01");
      const period = windowForView(nextView, parseIsoDate(anchorIso)!);
      expect(formatIsoDate(period.start) <= picked).toBe(true);
      expect(formatIsoDate(period.end) >= picked).toBe(true);
    }
  });

  it("10. switching view after selecting keeps the same day selected", () => {
    const selected = resolveDateClick("MONTH", "2026-09-20", "2026-09-01").anchorIso;
    for (const view of CALENDAR_VIEWS) {
      // Switching view never re-resolves the date, so the anchor is unchanged.
      expect(isDateSelected(selected, resolveDateClick(view, selected, selected).anchorIso)).toBe(true);
    }
  });

  it("11. isDateSelected marks exactly one day", () => {
    expect(isDateSelected("2026-09-20", "2026-09-20")).toBe(true);
    expect(isDateSelected("2026-09-21", "2026-09-20")).toBe(false);
    expect(isDateSelected("2026-09-19", "2026-09-20")).toBe(false);
  });
});

describe("URL date state — the same single mechanism, not a second one", () => {
  const selection = { clientId: "client-1", projectId: "project-a" };

  it("12. a selected date is carried in the URL alongside client and project", () => {
    const href = buildWorkspaceHref(selection, "MONTH", "2026-09-20");
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("date")).toBe("2026-09-20");
    expect(params.get("client")).toBe("client-1");
    expect(params.get("project")).toBe("project-a");
  });

  it("13. the view travels with the date", () => {
    const params = new URL(buildWorkspaceHref(selection, "WEEK", "2026-09-20"), "https://example.test").searchParams;
    expect(params.get("view")).toBe("week");
    expect(params.get("date")).toBe("2026-09-20");
  });

  it("14. selecting a date never drops the client/project context", () => {
    for (const view of CALENDAR_VIEWS) {
      const { anchorIso, view: nextView } = resolveDateClick(view, "2026-09-20", "2026-09-01");
      const params = new URL(buildWorkspaceHref(selection, nextView, anchorIso), "https://example.test").searchParams;
      expect(params.get("client")).toBe("client-1");
      expect(params.get("project")).toBe("project-a");
      expect(params.get("date")).toBe("2026-09-20");
    }
  });

  it("15. an all-clients context stays all-clients — the date does not invent a client", () => {
    const href = buildWorkspaceHref({ clientId: ALL_CLIENTS_SELECTION, projectId: "" }, "MONTH", "2026-09-20");
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("client")).toBeNull();
    expect(params.get("project")).toBeNull();
    expect(params.get("date")).toBe("2026-09-20");
  });

  it("16. the date in the URL round-trips back to the same selected day", () => {
    const href = buildWorkspaceHref(selection, "MONTH", "2026-09-20");
    const back = new URL(href, "https://example.test").searchParams.get("date")!;
    expect(isDateSelected("2026-09-20", back)).toBe(true);
  });

  it("17. the URL carries no scheduling instruction of any kind", () => {
    expect(buildWorkspaceHref(selection, "MONTH", "2026-09-20")).not.toMatch(/schedul|status|create|publish/i);
  });
});

describe("dayContext — a populated day", () => {
  const items = [content(), plan(), content({ id: "c2", title: "Water Heater Costs", publishedAt: parseIsoDate("2026-09-21") })];

  it("18. reports what is on the day, counting content and plans separately", () => {
    const ctx = dayContext("2026-09-20", items, TODAY);
    expect(ctx.items).toHaveLength(2);
    expect(ctx.contentCount).toBe(1);
    expect(ctx.planCount).toBe(1);
    expect(ctx.isEmpty).toBe(false);
  });

  it("19. never mixes in another day's items", () => {
    expect(dayContext("2026-09-21", items, TODAY).items.map((i) => i.title)).toEqual(["Water Heater Costs"]);
  });

  it("20. names the day and labels today/tomorrow/yesterday", () => {
    expect(dayContext("2026-09-20", items, TODAY).heading).toBe("Sun 20 Sep 2026");
    expect(dayContext("2026-09-09", items, TODAY).relativeLabel).toBe("Today");
    expect(dayContext("2026-09-10", items, TODAY).relativeLabel).toBe("Tomorrow");
    expect(dayContext("2026-09-20", items, TODAY).relativeLabel).toBeNull();
  });

  it("21. ignores undated content entirely — it belongs to no day", () => {
    const ctx = dayContext("2026-09-20", [content({ id: "c9", publishedAt: null }), ...items], TODAY);
    expect(ctx.items.map((i) => i.id)).not.toContain("c9");
    expect(ctx.contentCount).toBe(1);
  });
});

describe("dayContext — an EMPTY day is useful but fabricates nothing", () => {
  it("22. an empty day still resolves to real context", () => {
    const ctx = dayContext("2026-09-25", [content(), plan()], TODAY);
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.items).toEqual([]);
    expect(ctx.date).toBe("2026-09-25");
    expect(ctx.heading).toBe("Fri 25 Sep 2026");
  });

  it("23. an empty day invents no content, no plan and no publication date", () => {
    const ctx = dayContext("2026-09-25", [], TODAY);
    expect(ctx.contentCount).toBe(0);
    expect(ctx.planCount).toBe(0);
    expect(ctx.emptyNote).toBe("Nothing is dated on this day.");
  });

  it("24. the empty note does not invite creating anything", () => {
    const ctx = dayContext("2026-09-25", [], TODAY);
    expect(ctx.emptyNote).not.toMatch(/add|create|new|schedul|\+/i);
  });

  it("25. selecting an empty day is still a plain navigation result", () => {
    expect(resolveDateClick("MONTH", "2026-09-25", "2026-09-01")).toEqual({ anchorIso: "2026-09-25", view: "MONTH" });
  });
});

describe("scheduling stays an explicit, separate action", () => {
  it("26. the unavailable reason states the real model gap, without promising a date", () => {
    expect(SCHEDULING_FROM_DATE_UNAVAILABLE).toMatch(/not available yet/i);
    expect(SCHEDULING_FROM_DATE_UNAVAILABLE).toMatch(/no scheduled date/i);
    expect(SCHEDULING_FROM_DATE_UNAVAILABLE).not.toMatch(/coming soon|shortly|next release|Q[1-4]/i);
  });

  it("27. it is honest that a publish date only exists once content is published", () => {
    expect(SCHEDULING_FROM_DATE_UNAVAILABLE).toMatch(/only once content is actually published/i);
  });

  it("28. the day panel may only open records that already exist", () => {
    expect(DAY_PANEL_ACTIONS).toEqual(["OPEN_EXISTING_ITEM"]);
    for (const action of DAY_PANEL_ACTIONS) {
      expect(action).not.toMatch(/CREATE|SCHEDULE|PUBLISH|DELETE|UPDATE/);
    }
  });

  it("29. no exported helper can report a content status — selection cannot change one", () => {
    const ctx = dayContext("2026-09-20", [content({ status: "DRAFT", publishedAt: parseIsoDate("2026-09-20") })], TODAY);
    // The day's items are read models carrying their EXISTING status; nothing
    // in this module returns a status to write, or a transition to apply.
    expect(ctx.items[0].statusLabel).toBe("Draft");
    expect(Object.keys(resolveDateClick("MONTH", "2026-09-20", "2026-09-01"))).not.toContain("status");
  });
});

describe("clicking an item versus clicking its day", () => {
  it("30. an item carries its own destination, which is not a date at all", () => {
    const item = content();
    expect(item.href).toBe("/seo/project-a/content/c1");
    expect(item.href).not.toMatch(/date=|view=/);
  });

  it("31. a day's context and its items are independent — reading one never rewrites the other", () => {
    const items = [content(), plan()];
    const before = JSON.stringify(items);
    dayContext("2026-09-20", items, TODAY);
    resolveDateClick("MONTH", "2026-09-20", "2026-09-01");
    expect(JSON.stringify(items)).toBe(before);
  });
});
