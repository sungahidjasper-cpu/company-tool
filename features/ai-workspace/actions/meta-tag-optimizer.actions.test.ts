import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn(),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
}));
vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));

type MockPrisma = {
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  content: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contentRevision: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    sEOProject: { findUnique: vi.fn() },
    content: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    contentRevision: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockPrisma;
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: MockPrisma) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { applyMetaTagSuggestionAction, startMetaTagOptimizerAction } from "@/features/ai-workspace/actions/meta-tag-optimizer.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedComputeInputHash = computeInputHash as unknown as ReturnType<typeof vi.fn>;
const mockedCreateAiGenerationJob = createAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedFindActiveAiGenerationJob = findActiveAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedRunAiGenerationJob = runAiGenerationJob as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT = { id: "seo-1", companyId: COMPANY_A, name: "Acme SEO", domain: "acme.test" };

const CONTENT_ID_1 = "00000000-0000-4000-8000-000000000001";
const CONTENT_ID_2 = "00000000-0000-4000-8000-000000000002";
const SEO_PROJECT_ID = "00000000-0000-4000-8000-0000000000f0";

const CONTENT_ROW_1 = { id: CONTENT_ID_1, seoProjectId: SEO_PROJECT_ID, seoProject: { companyId: COMPANY_A } };
const CONTENT_ROW_2 = { id: CONTENT_ID_2, seoProjectId: SEO_PROJECT_ID, seoProject: { companyId: COMPANY_A } };

const VALID_INPUT = { seoProjectId: SEO_PROJECT_ID, contentIds: [CONTENT_ID_1, CONTENT_ID_2] };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, id: SEO_PROJECT_ID });
  mockedPrisma.content.findMany.mockResolvedValue([CONTENT_ROW_1, CONTENT_ROW_2]);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startMetaTagOptimizerAction", () => {
  it("4. rejects an unauthenticated request", async () => {
    mockedRequireUser.mockRejectedValue(new Error("Not authenticated"));
    await expect(startMetaTagOptimizerAction(VALID_INPUT)).rejects.toThrow();
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("5. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startMetaTagOptimizerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("9. rejects an empty content selection without any lookup", async () => {
    const result = await startMetaTagOptimizerAction({ seoProjectId: SEO_PROJECT_ID, contentIds: [] });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("10. rejects a selection of more than 50 content ids", async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const result = await startMetaTagOptimizerAction({ seoProjectId: SEO_PROJECT_ID, contentIds: tooMany });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("11. rejects a malformed (non-UUID) content id", async () => {
    const result = await startMetaTagOptimizerAction({ seoProjectId: SEO_PROJECT_ID, contentIds: ["not-a-real-id"] });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-UUID) seoProjectId", async () => {
    const result = await startMetaTagOptimizerAction({ seoProjectId: "not-a-real-id", contentIds: [CONTENT_ID_1] });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await startMetaTagOptimizerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("6. rejects when the SEO project belongs to another company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, id: SEO_PROJECT_ID, companyId: COMPANY_B });
    const result = await startMetaTagOptimizerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("7. rejects when any selected content belongs to another company", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([CONTENT_ROW_1, { ...CONTENT_ROW_2, seoProject: { companyId: COMPANY_B } }]);
    const result = await startMetaTagOptimizerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("8. rejects when any selected content belongs to a different SEO project than the one selected", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([CONTENT_ROW_1, { ...CONTENT_ROW_2, seoProjectId: "00000000-0000-4000-8000-0000000000ff" }]);
    const result = await startMetaTagOptimizerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("rejects when a requested content id does not resolve to any real row at all", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([CONTENT_ROW_1]); // only 1 of the 2 requested ids exists
    const result = await startMetaTagOptimizerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("1/2/3. creates a META_TAG_OPTIMIZATION job with companyId from the authenticated actor, and kicks off runAiGenerationJob", async () => {
    const result = await startMetaTagOptimizerAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("job-1");
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_A, seoProjectId: SEO_PROJECT_ID, taskType: "META_TAG_OPTIMIZATION" })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("reuses an existing active job for the identical input instead of creating a second one", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "existing-job" });
    const result = await startMetaTagOptimizerAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("existing-job");
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("deduplicates a legitimate repeated content id in the client's own selection rather than treating it as a missing row", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([CONTENT_ROW_1]);
    const result = await startMetaTagOptimizerAction({ seoProjectId: SEO_PROJECT_ID, contentIds: [CONTENT_ID_1, CONTENT_ID_1] });
    expect(result.success).toBe(true);
  });
});

function makeCurrentContentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONTENT_ID_1,
    seoProjectId: SEO_PROJECT_ID,
    title: "Page Title",
    url: "https://example.com/page",
    status: "APPROVED",
    metaTitle: "Current Meta Title",
    metaDescription: "Current Meta Description",
    body: "Current body",
    ...overrides,
  };
}

const APPLY_INPUT = {
  seoProjectId: SEO_PROJECT_ID,
  contentId: CONTENT_ID_1,
  metaTitle: "New Suggested Meta Title",
  metaDescription: "New Suggested Meta Description",
};

describe("applyMetaTagSuggestionAction", () => {
  beforeEach(() => {
    mockedPrisma.content.findMany.mockResolvedValue([CONTENT_ROW_1]);
    mockedPrisma.content.findUnique.mockResolvedValue(makeCurrentContentRow());
    mockedPrisma.contentRevision.count.mockResolvedValue(2);
    mockedPrisma.contentRevision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "revision-new", ...data }));
    mockedPrisma.content.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeCurrentContentRow(), ...data }));
  });

  it("rejects an unauthenticated request", async () => {
    mockedRequireUser.mockRejectedValue(new Error("Not authenticated"));
    await expect(applyMetaTagSuggestionAction(APPLY_INPUT)).rejects.toThrow();
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-UUID) contentId without any lookup", async () => {
    const result = await applyMetaTagSuggestionAction({ ...APPLY_INPUT, contentId: "not-a-real-id" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an empty metaTitle", async () => {
    const result = await applyMetaTagSuggestionAction({ ...APPLY_INPUT, metaTitle: "" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects an empty metaDescription", async () => {
    const result = await applyMetaTagSuggestionAction({ ...APPLY_INPUT, metaDescription: "" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects when the SEO project belongs to another company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, id: SEO_PROJECT_ID, companyId: COMPANY_B });
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects when the content belongs to another company, even though the SEO project id matches", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([{ ...CONTENT_ROW_1, seoProject: { companyId: COMPANY_B } }]);
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not be found/i);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects when the content belongs to a different SEO project than the one supplied — the exact 'still belongs to the correct project' check", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([{ ...CONTENT_ROW_1, seoProjectId: "00000000-0000-4000-8000-0000000000ff" }]);
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects when the content id does not exist at all", async () => {
    mockedPrisma.content.findMany.mockResolvedValue([]);
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("applies the suggestion, writing ONLY metaTitle/metaDescription", async () => {
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.noOp).toBe(false);
    expect(mockedPrisma.content.update).toHaveBeenCalledWith({
      where: { id: CONTENT_ID_1 },
      data: { metaTitle: "New Suggested Meta Title", metaDescription: "New Suggested Meta Description" },
    });
  });

  it("never includes title, body, status, url, or seoProjectId in the Content update's data", async () => {
    await applyMetaTagSuggestionAction(APPLY_INPUT);
    const [{ data }] = mockedPrisma.content.update.mock.calls[0];
    expect(data).not.toHaveProperty("title");
    expect(data).not.toHaveProperty("body");
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("url");
    expect(data).not.toHaveProperty("seoProjectId");
  });

  it("snapshots the CURRENT (pre-apply) values into a ContentRevision with changeSource AI_REGENERATION before overwriting them", async () => {
    await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(mockedPrisma.contentRevision.create).toHaveBeenCalledWith({
      data: {
        contentId: CONTENT_ID_1,
        companyId: COMPANY_A,
        revisionNumber: 3,
        title: "Page Title",
        metaTitle: "Current Meta Title",
        metaDescription: "Current Meta Description",
        body: "Current body",
        changeSource: "AI_REGENERATION",
        createdByUserId: "user-manager",
      },
    });
  });

  it("is a no-op when the requested metaTitle/metaDescription already match the current row — no revision, no update, no activity log", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(
      makeCurrentContentRow({ metaTitle: "New Suggested Meta Title", metaDescription: "New Suggested Meta Description" })
    );
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.noOp).toBe(true);
    expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("still returns a successful, non-no-op result when logActivity throws", async () => {
    mockedLogActivity.mockRejectedValue(new Error("activity log unavailable"));
    const result = await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.noOp).toBe(false);
    expect(mockedPrisma.content.update).toHaveBeenCalled();
  });

  it("logs content.ai_meta_tags_applied with the actor and the applied text", async () => {
    await applyMetaTagSuggestionAction(APPLY_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: "user-manager",
      action: "content.ai_meta_tags_applied",
      companyId: COMPANY_A,
      seoProjectId: SEO_PROJECT_ID,
      contentId: CONTENT_ID_1,
      metadata: { metaTitle: "New Suggested Meta Title", metaDescription: "New Suggested Meta Description" },
    });
  });

  it("locks the row before reading it, in the same transaction as the snapshot and update", async () => {
    const callOrder: string[] = [];
    mockedPrisma.$queryRaw.mockImplementation(async () => {
      callOrder.push("lock");
      return undefined;
    });
    mockedPrisma.content.findUnique.mockImplementation(async () => {
      callOrder.push("read-current");
      return makeCurrentContentRow();
    });
    mockedPrisma.contentRevision.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      callOrder.push("snapshot");
      return { id: "revision-new", ...data };
    });
    mockedPrisma.content.update.mockImplementation(async () => {
      callOrder.push("update");
      return makeCurrentContentRow();
    });

    await applyMetaTagSuggestionAction(APPLY_INPUT);

    expect(callOrder).toEqual(["lock", "read-current", "lock", "snapshot", "update"]);
  });

  it("propagates a content.update failure without logging activity or returning success", async () => {
    mockedPrisma.content.update.mockRejectedValue(new Error("simulated DB failure"));
    await expect(applyMetaTagSuggestionAction(APPLY_INPUT)).rejects.toThrow("simulated DB failure");
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });
});
