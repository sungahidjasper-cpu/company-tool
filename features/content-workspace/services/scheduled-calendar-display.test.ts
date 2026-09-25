import { describe, expect, it } from "vitest";

import { parseIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { STATE_LABELS, WORKSPACE_ITEM_STATES, datedItems, groupByDate, toContentItem, toPlanItem, undatedItems, type ContentRow, type PlanRow } from "@/features/content-workspace/services/content-calendar-feed";
import { zonedWallTimeToInstant } from "@/features/content-workspace/services/content-scheduling";
import { BLOG_WORKFLOW_STEPS, SOCIAL_WORKFLOW_STEPS, resolveSocialAvailability, supportedSocialProviderTypes } from "@/features/content-workspace/services/social-availability";
import { groupIntoDays, splitByKind } from "@/features/content-workspace/services/workspace-presentation";

const PROJECT = { id: "project-a", name: "Storage Moguls", clientId: "client-1", client: { name: "Acme Plumbing" } };

const content = (over: Partial<ContentRow> = {}): ContentRow => ({
  id: "c1",
  title: "Unlocking Self Storage Investments",
  url: null,
  status: "DRAFT",
  publishedAt: null,
  scheduledAt: null,
  scheduledTimezone: null,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  generatedByAi: false,
  clientId: PROJECT.clientId,
  client: PROJECT.client ? { id: PROJECT.clientId as string, name: PROJECT.client.name } : null,
  contentType: null,
  seoProjectId: PROJECT.id,
  seoProject: PROJECT,  ...over,
});

const plan = (over: Partial<PlanRow> = {}): PlanRow => ({
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

const scheduledRow = (dateIso: string, time: string, zone: string) =>
  content({ status: "SCHEDULED", scheduledAt: zonedWallTimeToInstant(dateIso, time, zone)!, scheduledTimezone: zone });

describe("scheduled Content appears on the calendar", () => {
  it("1. a scheduled page is placed on its scheduled day", () => {
    const item = toContentItem(scheduledRow("2026-09-20", "10:00", "Europe/London"));
    expect(item.date).toBe("2026-09-20");
    expect(item.state).toBe("SCHEDULED");
    expect(item.dateLabel).toBe("Scheduled");
  });

  it("2. it is placed on the day the USER intended, not the UTC day", () => {
    // 23:00 in New York is 03:00 the NEXT day in UTC. The user picked the 20th.
    const item = toContentItem(scheduledRow("2026-09-20", "23:00", "America/New_York"));
    expect(item.date).toBe("2026-09-20");
  });

  it("3. and the mirror case: an early-morning schedule east of UTC keeps its own day", () => {
    const item = toContentItem(scheduledRow("2026-09-20", "01:00", "Australia/Sydney"));
    expect(item.date).toBe("2026-09-20");
  });

  it("4. a published page still shows on its published day", () => {
    const item = toContentItem(content({ status: "PUBLISHED", publishedAt: parseIsoDate("2026-06-01") }));
    expect(item.date).toBe("2026-06-01");
    expect(item.state).toBe("PUBLISHED");
    expect(item.dateLabel).toBe("Published");
  });

  it("5. a draft with neither date stays undated rather than being placed anywhere", () => {
    const item = toContentItem(content());
    expect(item.date).toBeNull();
    expect(item.state).toBe("DRAFT");
    expect(undatedItems([item])).toHaveLength(1);
    expect(datedItems([item])).toHaveLength(0);
  });

  it("6. a row claiming SCHEDULED without both fields is NOT placed on a date it cannot justify", () => {
    expect(toContentItem(content({ status: "SCHEDULED", scheduledAt: new Date("2026-09-20T09:00:00Z"), scheduledTimezone: null })).date).toBeNull();
    expect(toContentItem(content({ status: "SCHEDULED", scheduledAt: null, scheduledTimezone: "UTC" })).date).toBeNull();
  });

  it("7. schedule fields on a non-SCHEDULED row are ignored", () => {
    const item = toContentItem(content({ status: "DRAFT", scheduledAt: new Date("2026-09-20T09:00:00Z"), scheduledTimezone: "UTC" }));
    expect(item.date).toBeNull();
    expect(item.state).toBe("DRAFT");
  });

  it("8. a scheduled page is grouped onto its day alongside anything else there", () => {
    const items = [toContentItem(scheduledRow("2026-09-20", "10:00", "UTC")), toPlanItem(plan())];
    const day = groupByDate(datedItems(items)).get("2026-09-20");
    expect(day).toHaveLength(2);
  });

  it("9. it appears in the agenda's day grouping in date order", () => {
    const groups = groupIntoDays([
      toContentItem(scheduledRow("2026-10-05", "10:00", "UTC")),
      toContentItem({ ...scheduledRow("2026-09-20", "10:00", "UTC"), id: "c2" }),
    ]);
    expect(groups.map((group) => group.date)).toEqual(["2026-09-20", "2026-10-05"]);
  });
});

describe("Planned and Scheduled are never confused", () => {
  it("10. a plan entry is always PLANNED, whatever its own status says", () => {
    for (const status of ["PLANNED", "DRAFT", "IN_PROGRESS", "PUBLISHED", "COMPLETED"]) {
      expect(toPlanItem(plan({ status })).state).toBe("PLANNED");
    }
  });

  it("11. a scheduled page is never bucketed as a plan", () => {
    const split = splitByKind([toContentItem(scheduledRow("2026-09-20", "10:00", "UTC"))]);
    expect(split.PLAN).toHaveLength(0);
    expect(split.CONTENT).toHaveLength(1);
  });

  it("12. their ids stay namespaced, so one can never select the other", () => {
    expect(toContentItem(scheduledRow("2026-09-20", "10:00", "UTC")).id.startsWith("content-")).toBe(true);
    expect(toPlanItem(plan()).id.startsWith("plan-")).toBe(true);
  });

  it("13. all four states are distinct and labelled", () => {
    expect(WORKSPACE_ITEM_STATES).toEqual(["PLANNED", "DRAFT", "SCHEDULED", "PUBLISHED"]);
    const labels = WORKSPACE_ITEM_STATES.map((state) => STATE_LABELS[state]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("14. a scheduled page links to the Content record, not to a calendar", () => {
    expect(toContentItem(scheduledRow("2026-09-20", "10:00", "UTC")).href).toBe("/seo/project-a/content/c1");
  });
});

describe("social availability comes from data, not a hard-coded list", () => {
  it("15. no social provider type exists in this schema, so none is offered", () => {
    expect(supportedSocialProviderTypes()).toEqual([]);
  });

  it("16. availability says so plainly, and names the only connection type that does exist", () => {
    const availability = resolveSocialAvailability([]);
    expect(availability.canPublish).toBe(false);
    expect(availability.connections).toEqual([]);
    expect(availability.reason).toMatch(/no social platform integration/i);
    expect(availability.reason).toMatch(/WordPress/);
  });

  it("17. a connection is never treated as publishable while the schema has no social type", () => {
    // Even if a caller supplied connections, the schema gate answers first.
    const availability = resolveSocialAvailability([{ id: "x", label: "Fake", providerType: "FACEBOOK" }]);
    expect(availability.canPublish).toBe(false);
    expect(availability.connections).toEqual([]);
  });

  it("18. the described workflow steps carry no links or actions", () => {
    for (const step of [...SOCIAL_WORKFLOW_STEPS, ...BLOG_WORKFLOW_STEPS]) {
      expect(Object.keys(step).sort()).toEqual(["detail", "title"]);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.detail.length).toBeGreaterThan(0);
    }
  });

  it("19. the steps never claim a platform is connected", () => {
    const text = SOCIAL_WORKFLOW_STEPS.map((step) => `${step.title} ${step.detail}`).join(" ");
    expect(text).not.toMatch(/connected to|is connected|your facebook|your instagram/i);
  });
});
