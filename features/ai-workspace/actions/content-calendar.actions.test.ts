import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn(),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
}));
vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));
vi.mock("@/features/ai-workspace/services/content-calendar.repository", () => ({
  filterOwnedContentIds: vi.fn(),
  filterOwnedKeywordIds: vi.fn(),
  getOwnedCalendar: vi.fn(),
  getOwnedKeywordCluster: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sEOProject: { findUnique: vi.fn() },
    contentCalendar: { create: vi.fn(), update: vi.fn() },
    contentCalendarEntry: { update: vi.fn(), updateMany: vi.fn() },
    content: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import {
  filterOwnedContentIds,
  filterOwnedKeywordIds,
  getOwnedCalendar,
  getOwnedKeywordCluster,
} from "@/features/ai-workspace/services/content-calendar.repository";
import {
  deleteContentCalendarAction,
  saveContentCalendarAction,
  startContentCalendarAction,
  updateCalendarEntryStatusAction,
} from "@/features/ai-workspace/actions/content-calendar.actions";

const mockedRequireUser = vi.mocked(requireUser);
const mockedLogActivity = vi.mocked(logActivity);
const mockedFindProject = vi.mocked(prisma.sEOProject.findUnique);
const mockedTransaction = vi.mocked(prisma.$transaction);
const mockedEntryUpdate = vi.mocked(prisma.contentCalendarEntry.update);
const mockedContentUpdate = vi.mocked(prisma.content.update);
const mockedComputeInputHash = vi.mocked(computeInputHash);
const mockedCreateJob = vi.mocked(createAiGenerationJob);
const mockedFindActiveJob = vi.mocked(findActiveAiGenerationJob);
const mockedRunJob = vi.mocked(runAiGenerationJob);
const mockedFilterKeywords = vi.mocked(filterOwnedKeywordIds);
const mockedFilterContent = vi.mocked(filterOwnedContentIds);
const mockedGetCalendar = vi.mocked(getOwnedCalendar);
const mockedGetCluster = vi.mocked(getOwnedKeywordCluster);

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const CLUSTER_ID = "01a002a5-ffa5-705e-9731-8062675143aa";
const KEYWORD_ID = "01a002a5-ffa5-705e-9731-8062675143ab";
const CONTENT_ID = "01a002a5-ffa5-705e-9731-8062675143ac";
const CALENDAR_ID = "01a002a5-ffa5-705e-9731-8062675143ad";
const ENTRY_ID = "01a002a5-ffa5-705e-9731-8062675143ae";

const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };
const PROJECT = { id: PROJECT_ID, companyId: COMPANY_A, name: "Storage Moguls", domain: "storagemoguls.test", deletedAt: null };

const GENERATE_INPUT = {
  seoProjectId: PROJECT_ID,
  name: "Q4 plan",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  cadence: "WEEKLY" as const,
  topicSource: "PROJECT_DATA" as const,
};

const SAVE_INPUT = {
  seoProjectId: PROJECT_ID,
  name: "Q4 plan",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  entries: [
    { scheduledDate: "2026-10-01", topic: "Pillar page", contentType: "GUIDE" as const, role: "PILLAR" as const, status: "PLANNED" as const },
    { scheduledDate: "2026-10-08", topic: "Supporting page", contentType: "ARTICLE" as const, role: "SUPPORTING" as const, status: "PLANNED" as const },
  ],
};

const CALENDAR = {
  id: CALENDAR_ID,
  name: "Q4 plan",
  seoProjectId: PROJECT_ID,
  entries: [{ id: ENTRY_ID }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER as never);
  mockedFindProject.mockResolvedValue(PROJECT as never);
  mockedComputeInputHash.mockReturnValue("hash-1" as never);
  mockedFindActiveJob.mockResolvedValue(null as never);
  mockedCreateJob.mockResolvedValue({ id: "job-1" } as never);
  mockedFilterKeywords.mockResolvedValue(new Set() as never);
  mockedFilterContent.mockResolvedValue(new Set() as never);
  mockedGetCluster.mockResolvedValue({ id: CLUSTER_ID, name: "Cluster", keywords: [] } as never);
  mockedGetCalendar.mockResolvedValue(CALENDAR as never);
  // $transaction is called with a callback in this feature; run it against a
  // minimal tx stub so the write path is exercised rather than stubbed out.
  (mockedTransaction as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(async (fn: unknown) => {
    if (typeof fn === "function") {
      return (fn as (tx: unknown) => unknown)({
        contentCalendar: { create: vi.fn().mockResolvedValue({ id: CALENDAR_ID }), update: vi.fn() },
        contentCalendarEntry: { updateMany: vi.fn() },
      });
    }
    return undefined;
  });
});

describe("startContentCalendarAction — permission and project", () => {
  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE as never);
    expect((await startContentCalendarAction(GENERATE_INPUT)).success).toBe(false);
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("2. refuses a project of ANOTHER company", async () => {
    mockedFindProject.mockResolvedValue({ ...PROJECT, companyId: COMPANY_B } as never);
    expect(await startContentCalendarAction(GENERATE_INPUT)).toEqual({ success: false, message: "SEO project not found." });
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("3. refuses a SOFT-DELETED project", async () => {
    mockedFindProject.mockResolvedValue({ ...PROJECT, deletedAt: new Date("2026-08-12") } as never);
    expect(await startContentCalendarAction(GENERATE_INPUT)).toEqual({ success: false, message: "SEO project not found." });
  });

  it("4. refuses an invalid date range before creating a job", async () => {
    expect((await startContentCalendarAction({ ...GENERATE_INPUT, endDate: "2026-09-01" })).success).toBe(false);
    expect((await startContentCalendarAction({ ...GENERATE_INPUT, startDate: "2026-02-30" })).success).toBe(false);
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("5. refuses a cluster that does not belong to the project", async () => {
    mockedGetCluster.mockResolvedValue(null as never);
    const result = await startContentCalendarAction({ ...GENERATE_INPUT, topicSource: "TOPIC_CLUSTER", keywordClusterId: CLUSTER_ID });
    expect(result).toEqual({ success: false, message: "Topic cluster not found for this SEO project." });
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("6. verifies the cluster SCOPED to the verified project", async () => {
    await startContentCalendarAction({ ...GENERATE_INPUT, topicSource: "TOPIC_CLUSTER", keywordClusterId: CLUSTER_ID });
    expect(mockedGetCluster).toHaveBeenCalledWith(CLUSTER_ID, PROJECT_ID);
  });

  it("7. creates the job with the SERVER-derived company and project", async () => {
    expect(await startContentCalendarAction(GENERATE_INPUT)).toEqual({ success: true, data: { jobId: "job-1" } });
    expect(mockedCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_A, seoProjectId: PROJECT_ID, taskType: "CONTENT_CALENDAR", createdById: MANAGER.id })
    );
    expect(mockedRunJob).toHaveBeenCalledWith("job-1");
  });

  it("8. never takes companyId from the client", async () => {
    await startContentCalendarAction({ ...GENERATE_INPUT, companyId: COMPANY_B } as never);
    expect(mockedCreateJob).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY_A }));
  });

  it("9. reuses an active job for identical input", async () => {
    mockedFindActiveJob.mockResolvedValue({ id: "job-existing" } as never);
    expect(await startContentCalendarAction(GENERATE_INPUT)).toEqual({ success: true, data: { jobId: "job-existing" } });
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("10. writes NOTHING to the calendar tables — generation is not persistence", async () => {
    await startContentCalendarAction(GENERATE_INPUT);
    expect(mockedTransaction).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.contentCalendar.create)).not.toHaveBeenCalled();
  });
});

describe("saveContentCalendarAction — the approval gate", () => {
  it("11. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE as never);
    expect((await saveContentCalendarAction(SAVE_INPUT)).success).toBe(false);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("12. refuses a project of ANOTHER company", async () => {
    mockedFindProject.mockResolvedValue({ ...PROJECT, companyId: COMPANY_B } as never);
    expect(await saveContentCalendarAction(SAVE_INPUT)).toEqual({ success: false, message: "SEO project not found." });
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("13. refuses a SOFT-DELETED project", async () => {
    mockedFindProject.mockResolvedValue({ ...PROJECT, deletedAt: new Date() } as never);
    expect((await saveContentCalendarAction(SAVE_INPUT)).success).toBe(false);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("14. refuses a keyword that does not belong to this project", async () => {
    mockedFilterKeywords.mockResolvedValue(new Set() as never);
    const result = await saveContentCalendarAction({
      ...SAVE_INPUT,
      entries: [{ ...SAVE_INPUT.entries[0], keywordId: KEYWORD_ID }],
    });
    expect(result).toEqual({ success: false, message: "One of the keywords does not belong to this SEO project." });
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("15. accepts a keyword the project DOES own, verified project-scoped", async () => {
    mockedFilterKeywords.mockResolvedValue(new Set([KEYWORD_ID]) as never);
    const result = await saveContentCalendarAction({
      ...SAVE_INPUT,
      entries: [{ ...SAVE_INPUT.entries[0], keywordId: KEYWORD_ID }],
    });
    expect(result.success).toBe(true);
    expect(mockedFilterKeywords).toHaveBeenCalledWith([KEYWORD_ID], PROJECT_ID);
  });

  it("16. refuses a Content link that does not belong to this project", async () => {
    mockedFilterContent.mockResolvedValue(new Set() as never);
    const result = await saveContentCalendarAction({
      ...SAVE_INPUT,
      entries: [{ ...SAVE_INPUT.entries[0], contentId: CONTENT_ID }],
    });
    expect(result).toEqual({ success: false, message: "One of the linked pages does not belong to this SEO project." });
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("17. refuses a cluster that does not belong to this project", async () => {
    mockedGetCluster.mockResolvedValue(null as never);
    const result = await saveContentCalendarAction({ ...SAVE_INPUT, keywordClusterId: CLUSTER_ID });
    expect(result).toEqual({ success: false, message: "Topic cluster not found for this SEO project." });
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("18. refuses an entry dated outside the calendar range", async () => {
    const result = await saveContentCalendarAction({
      ...SAVE_INPUT,
      entries: [{ ...SAVE_INPUT.entries[0], scheduledDate: "2027-05-05" }],
    });
    expect(result.success).toBe(false);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("19. refuses an impossible date", async () => {
    const result = await saveContentCalendarAction({
      ...SAVE_INPUT,
      entries: [{ ...SAVE_INPUT.entries[0], scheduledDate: "2026-11-31" }],
    });
    expect(result.success).toBe(false);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("20. refuses duplicate topics", async () => {
    const result = await saveContentCalendarAction({
      ...SAVE_INPUT,
      entries: [SAVE_INPUT.entries[0], { ...SAVE_INPUT.entries[1], topic: "pillar PAGE" }],
    });
    expect(result.success).toBe(false);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("21. saves in ONE transaction, so a partial calendar cannot exist", async () => {
    const result = await saveContentCalendarAction(SAVE_INPUT);
    expect(result).toEqual({ success: true, data: { id: CALENDAR_ID } });
    expect(mockedTransaction).toHaveBeenCalledTimes(1);
  });

  it("22. records the save in the activity log against the project", async () => {
    await saveContentCalendarAction(SAVE_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contentCalendar.created", seoProjectId: PROJECT_ID, actorId: MANAGER.id })
    );
  });

  it("23. never modifies Content while saving a calendar", async () => {
    await saveContentCalendarAction(SAVE_INPUT);
    expect(mockedContentUpdate).not.toHaveBeenCalled();
  });
});

describe("updateCalendarEntryStatusAction", () => {
  it("24. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE as never);
    expect((await updateCalendarEntryStatusAction({ calendarId: CALENDAR_ID, entryId: ENTRY_ID, status: "DRAFT" })).success).toBe(false);
    expect(mockedEntryUpdate).not.toHaveBeenCalled();
  });

  it("25. refuses a calendar the company does not own", async () => {
    mockedGetCalendar.mockResolvedValue(null as never);
    const result = await updateCalendarEntryStatusAction({ calendarId: CALENDAR_ID, entryId: ENTRY_ID, status: "DRAFT" });
    expect(result).toEqual({ success: false, message: "Content calendar not found." });
    expect(mockedEntryUpdate).not.toHaveBeenCalled();
  });

  it("26. verifies the calendar against the actor's company, not a client value", async () => {
    await updateCalendarEntryStatusAction({ calendarId: CALENDAR_ID, entryId: ENTRY_ID, status: "DRAFT" });
    expect(mockedGetCalendar).toHaveBeenCalledWith(CALENDAR_ID, COMPANY_A);
  });

  it("27. refuses an entry that belongs to a DIFFERENT calendar", async () => {
    const result = await updateCalendarEntryStatusAction({ calendarId: CALENDAR_ID, entryId: "some-other-entry", status: "DRAFT" });
    expect(result).toEqual({ success: false, message: "Calendar entry not found." });
    expect(mockedEntryUpdate).not.toHaveBeenCalled();
  });

  it("28. refuses an unrecognised status", async () => {
    const result = await updateCalendarEntryStatusAction({ calendarId: CALENDAR_ID, entryId: ENTRY_ID, status: "LIVE" as never });
    expect(result).toEqual({ success: false, message: "That status is not recognised." });
    expect(mockedEntryUpdate).not.toHaveBeenCalled();
  });

  it("29. updates only the entry's own status", async () => {
    const result = await updateCalendarEntryStatusAction({ calendarId: CALENDAR_ID, entryId: ENTRY_ID, status: "IN_PROGRESS" });
    expect(result).toEqual({ success: true, data: { id: ENTRY_ID } });
    expect(mockedEntryUpdate).toHaveBeenCalledWith({ where: { id: ENTRY_ID }, data: { status: "IN_PROGRESS" } });
  });

  it("30. marking an entry PUBLISHED never touches the linked page", async () => {
    await updateCalendarEntryStatusAction({ calendarId: CALENDAR_ID, entryId: ENTRY_ID, status: "PUBLISHED" });
    expect(mockedContentUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteContentCalendarAction", () => {
  it("31. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE as never);
    expect((await deleteContentCalendarAction(CALENDAR_ID)).success).toBe(false);
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("32. refuses a calendar the company does not own", async () => {
    mockedGetCalendar.mockResolvedValue(null as never);
    expect(await deleteContentCalendarAction(CALENDAR_ID)).toEqual({ success: false, message: "Content calendar not found." });
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("33. soft-deletes, so a mistake stays recoverable", async () => {
    const result = await deleteContentCalendarAction(CALENDAR_ID);
    expect(result).toEqual({ success: true, data: { id: CALENDAR_ID } });
    expect(mockedTransaction).toHaveBeenCalledTimes(1);
  });

  it("34. never deletes Content while deleting a calendar", async () => {
    await deleteContentCalendarAction(CALENDAR_ID);
    expect(mockedContentUpdate).not.toHaveBeenCalled();
  });

  it("35. records the deletion in the activity log", async () => {
    await deleteContentCalendarAction(CALENDAR_ID);
    expect(mockedLogActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "contentCalendar.deleted", seoProjectId: PROJECT_ID }));
  });
});
