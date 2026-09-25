import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  content: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    content: { findUnique: vi.fn(), updateMany: vi.fn() },
  } as unknown as MockPrisma;
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: MockPrisma) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { cancelContentScheduleAction, scheduleContentAction } from "@/features/content-workspace/actions/content-scheduling.actions";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedPrisma = prisma as unknown as MockPrisma;
const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;

const CONTENT_ID = "01a016c7-c1c5-74fb-9c43-c35ad68146e8";
const OTHER_COMPANY = "00000000-0000-0000-0000-0000000000ff";

const ADMIN = { id: "user-1", companyId: "company-1", role: "SUPER_ADMIN" };
const VIEWER = { id: "user-2", companyId: "company-1", role: "VIEWER" };

/** A schedule far enough ahead that it stays in the future as the suite ages. */
function futureRequest() {
  const year = new Date().getUTCFullYear() + 2;
  return { contentId: CONTENT_ID, dateIso: `${year}-09-20`, time: "10:00", timeZone: "Europe/London" };
}

function contentRow(over: Record<string, unknown> = {}) {
  return {
    id: CONTENT_ID,
    title: "Unlocking Self Storage Investments",
    status: "DRAFT",
    deletedAt: null,
    scheduledAt: null,
    scheduledTimezone: null,
    companyId: "company-1",
    seoProjectId: "project-1",
    seoProject: { id: "project-1", companyId: "company-1", deletedAt: null },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(ADMIN);
  mockedPrisma.content.findUnique.mockResolvedValue(contentRow());
  mockedPrisma.content.updateMany.mockResolvedValue({ count: 1 });
});

describe("scheduleContentAction — authorization", () => {
  it("1. refuses a role that cannot manage SEO projects, and writes nothing", async () => {
    mockedRequireUser.mockResolvedValue(VIEWER);
    const result = await scheduleContentAction(futureRequest());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("2. refuses another company's content — reported as not found, never as forbidden", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(contentRow({ companyId: OTHER_COMPANY, seoProject: { id: "project-1", companyId: OTHER_COMPANY, deletedAt: null } }));
    const result = await scheduleContentAction(futureRequest());
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toBe("Content not found.");
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("3. refuses a malformed content id WITHOUT querying the database", async () => {
    for (const contentId of ["", "  ", "not-a-uuid", "../../etc/passwd", "1 OR 1=1"]) {
      mockedPrisma.content.findUnique.mockClear();
      const result = await scheduleContentAction({ ...futureRequest(), contentId });
      expect(result.success).toBe(false);
      expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
    }
  });

  it("4. refuses a content id that does not exist", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    const result = await scheduleContentAction(futureRequest());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("5. refuses a trashed record and a trashed project, writing nothing", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(contentRow({ deletedAt: new Date("2026-01-01") }));
    expect((await scheduleContentAction(futureRequest())).success).toBe(false);

    mockedPrisma.content.findUnique.mockResolvedValue(contentRow({ seoProject: { id: "project-1", companyId: "company-1", deletedAt: new Date("2026-01-01") } }));
    expect((await scheduleContentAction(futureRequest())).success).toBe(false);

    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("6. scopes the lookup by the ACTOR's company, never a client-supplied one", async () => {
    await scheduleContentAction(futureRequest());
    const [{ where }] = mockedPrisma.content.findUnique.mock.calls[0];
    expect(where).toEqual({ id: CONTENT_ID });
    // The company check is made against the actor, in code, after the read.
    expect(mockedRequireUser).toHaveBeenCalled();
  });
});

describe("scheduleContentAction — the write", () => {
  it("7. writes SCHEDULED with both fields, and never a publishedAt", async () => {
    const result = await scheduleContentAction(futureRequest());
    expect(result.success).toBe(true);

    const [{ data, where }] = mockedPrisma.content.updateMany.mock.calls[0];
    expect(data.status).toBe("SCHEDULED");
    expect(data.scheduledTimezone).toBe("Europe/London");
    expect(data.scheduledAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("publishedAt");
    expect(where).toMatchObject({ id: CONTENT_ID, deletedAt: null });
  });

  it("8. stores the exact instant the chosen wall time names in the chosen zone", async () => {
    const year = new Date().getUTCFullYear() + 2;
    await scheduleContentAction({ contentId: CONTENT_ID, dateIso: `${year}-01-15`, time: "10:00", timeZone: "Europe/London" });
    const [{ data }] = mockedPrisma.content.updateMany.mock.calls[0];
    // January in London is UTC+0, so 10:00 local is 10:00Z.
    expect((data.scheduledAt as Date).toISOString()).toBe(`${year}-01-15T10:00:00.000Z`);
  });

  it("9. the same wall time in a different zone stores a different instant", async () => {
    const year = new Date().getUTCFullYear() + 2;
    await scheduleContentAction({ contentId: CONTENT_ID, dateIso: `${year}-01-15`, time: "10:00", timeZone: "America/New_York" });
    const [{ data }] = mockedPrisma.content.updateMany.mock.calls[0];
    expect((data.scheduledAt as Date).toISOString()).toBe(`${year}-01-15T15:00:00.000Z`);
  });

  it("10. guards the write against the state it validated — a concurrent change refuses it", async () => {
    mockedPrisma.content.updateMany.mockResolvedValue({ count: 0 });
    const result = await scheduleContentAction(futureRequest());
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/changed while you were scheduling/i);
  });

  it("11. records the schedule in the activity log", async () => {
    await scheduleContentAction(futureRequest());
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "content.scheduled", contentId: CONTENT_ID, companyId: "company-1" })
    );
  });

  it("12. refuses a past instant and writes nothing", async () => {
    const result = await scheduleContentAction({ contentId: CONTENT_ID, dateIso: "2020-01-01", time: "10:00", timeZone: "UTC" });
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/in the future/i);
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("13. refuses a malformed date, time or timezone and writes nothing", async () => {
    const base = futureRequest();
    for (const bad of [
      { ...base, dateIso: "20/09/2027" },
      { ...base, time: "10" },
      { ...base, timeZone: "Mars/Olympus" },
      { ...base, dateIso: "2027-02-31" },
    ]) {
      const result = await scheduleContentAction(bad);
      expect(result.success).toBe(false);
    }
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("14. refuses to schedule already-published or archived content", async () => {
    for (const status of ["PUBLISHED", "ARCHIVED"]) {
      mockedPrisma.content.findUnique.mockResolvedValue(contentRow({ status }));
      expect((await scheduleContentAction(futureRequest())).success).toBe(false);
    }
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("15. allows re-scheduling something already SCHEDULED", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(contentRow({ status: "SCHEDULED", scheduledAt: new Date("2030-01-01"), scheduledTimezone: "UTC" }));
    expect((await scheduleContentAction(futureRequest())).success).toBe(true);
  });
});

describe("cancelContentScheduleAction", () => {
  beforeEach(() => {
    mockedPrisma.content.findUnique.mockResolvedValue(
      contentRow({ status: "SCHEDULED", scheduledAt: new Date("2030-01-01T10:00:00Z"), scheduledTimezone: "Europe/London" })
    );
  });

  it("16. returns the content to DRAFT and clears BOTH schedule fields", async () => {
    const result = await cancelContentScheduleAction({ contentId: CONTENT_ID });
    expect(result.success).toBe(true);
    const [{ data, where }] = mockedPrisma.content.updateMany.mock.calls[0];
    expect(data).toEqual({ status: "DRAFT", scheduledAt: null, scheduledTimezone: null });
    expect(where).toMatchObject({ id: CONTENT_ID, status: "SCHEDULED" });
  });

  it("17. never touches publishedAt", async () => {
    await cancelContentScheduleAction({ contentId: CONTENT_ID });
    const [{ data }] = mockedPrisma.content.updateMany.mock.calls[0];
    expect(data).not.toHaveProperty("publishedAt");
  });

  it("18. refuses content that is not scheduled", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(contentRow({ status: "DRAFT" }));
    const result = await cancelContentScheduleAction({ contentId: CONTENT_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("19. refuses another company's content, and a malformed id", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(contentRow({ status: "SCHEDULED", companyId: OTHER_COMPANY, seoProject: { id: "p", companyId: OTHER_COMPANY, deletedAt: null } }));
    expect((await cancelContentScheduleAction({ contentId: CONTENT_ID })).success).toBe(false);

    mockedPrisma.content.findUnique.mockClear();
    expect((await cancelContentScheduleAction({ contentId: "not-a-uuid" })).success).toBe(false);
    expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
  });

  it("20. refuses a role that cannot manage SEO projects", async () => {
    mockedRequireUser.mockResolvedValue(VIEWER);
    expect((await cancelContentScheduleAction({ contentId: CONTENT_ID })).success).toBe(false);
    expect(mockedPrisma.content.updateMany).not.toHaveBeenCalled();
  });

  it("21. records the cancellation in the activity log", async () => {
    await cancelContentScheduleAction({ contentId: CONTENT_ID });
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "content.schedule_cancelled", contentId: CONTENT_ID })
    );
  });

  it("22. a concurrent change refuses the cancellation rather than forcing it", async () => {
    mockedPrisma.content.updateMany.mockResolvedValue({ count: 0 });
    const result = await cancelContentScheduleAction({ contentId: CONTENT_ID });
    expect(result.success).toBe(false);
  });
});

describe("nothing is written except by these two actions", () => {
  it("23. neither action ever sets PUBLISHED", async () => {
    await scheduleContentAction(futureRequest());
    mockedPrisma.content.findUnique.mockResolvedValue(contentRow({ status: "SCHEDULED", scheduledAt: new Date("2030-01-01"), scheduledTimezone: "UTC" }));
    await cancelContentScheduleAction({ contentId: CONTENT_ID });

    for (const [{ data }] of mockedPrisma.content.updateMany.mock.calls) {
      expect(data.status).not.toBe("PUBLISHED");
    }
  });

  it("24. every write goes through a transaction", async () => {
    await scheduleContentAction(futureRequest());
    expect(mockedPrisma.$transaction).toHaveBeenCalled();
  });
});
