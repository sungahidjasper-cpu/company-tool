import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn(),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
}));
vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));

type MockPrisma = {
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  keyword: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    keyword: { findMany: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { startTopicClusterPlannerAction } from "@/features/ai-workspace/actions/topic-cluster-planner.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedComputeInputHash = computeInputHash as unknown as ReturnType<typeof vi.fn>;
const mockedCreateAiGenerationJob = createAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedFindActiveAiGenerationJob = findActiveAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedRunAiGenerationJob = runAiGenerationJob as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT_ID = "00000000-0000-4000-8000-0000000000f0";
const KEYWORD_ID = "00000000-0000-4000-8000-00000000ae01";
const SEO_PROJECT = { id: SEO_PROJECT_ID, companyId: COMPANY_A, name: "Storage Moguls", domain: "storagemoguls.com" };

const VALID_INPUT = { seoProjectId: SEO_PROJECT_ID, seedTopic: "self storage investing", keywordIds: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.keyword.findMany.mockResolvedValue([]);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startTopicClusterPlannerAction — authorization", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startTopicClusterPlannerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("2. rejects an unauthenticated request", async () => {
    mockedRequireUser.mockRejectedValue(new Error("Not authenticated"));
    await expect(startTopicClusterPlannerAction(VALID_INPUT)).rejects.toThrow();
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });
});

describe("startTopicClusterPlannerAction — input validation", () => {
  it("3. accepts a valid seed topic and starts a job", async () => {
    const result = await startTopicClusterPlannerAction(VALID_INPUT);
    expect(result).toEqual({ success: true, data: { jobId: "job-1" } });
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("4. rejects a missing seed topic", async () => {
    const result = await startTopicClusterPlannerAction({ ...VALID_INPUT, seedTopic: "" });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("5. rejects a seed topic that is only whitespace or too short", async () => {
    for (const seedTopic of ["   ", "ab"]) {
      vi.clearAllMocks();
      mockedRequireUser.mockResolvedValue(MANAGER);
      mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
      const result = await startTopicClusterPlannerAction({ ...VALID_INPUT, seedTopic });
      expect(result.success).toBe(false);
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    }
  });

  it("6. rejects a non-UUID project id without any lookup", async () => {
    const result = await startTopicClusterPlannerAction({ ...VALID_INPUT, seoProjectId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });
});

describe("startTopicClusterPlannerAction — ownership and lifecycle", () => {
  it("7. rejects a project belonging to ANOTHER company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startTopicClusterPlannerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("8. rejects a missing project", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await startTopicClusterPlannerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("9. rejects a SOFT-DELETED project", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: new Date("2026-08-12") });
    const result = await startTopicClusterPlannerAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("10. a project row that omits deletedAt is treated as live", async () => {
    expect("deletedAt" in SEO_PROJECT).toBe(false);
    const result = await startTopicClusterPlannerAction(VALID_INPUT);
    expect(result.success).toBe(true);
  });
});

describe("startTopicClusterPlannerAction — keyword ids are real platform records", () => {
  it("11. accepts keyword ids that genuinely belong to the selected project", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([{ id: KEYWORD_ID }]);
    const result = await startTopicClusterPlannerAction({ ...VALID_INPUT, keywordIds: [KEYWORD_ID] });
    expect(result.success).toBe(true);
    expect(mockedPrisma.keyword.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ seoProjectId: SEO_PROJECT_ID, deletedAt: null }),
      })
    );
  });

  it("12. REJECTS a keyword id that does not resolve in this project — never silently drops it", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([]);
    const result = await startTopicClusterPlannerAction({ ...VALID_INPUT, keywordIds: [KEYWORD_ID] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/could not be found in this SEO project/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("13. REJECTS a partially-valid selection — all or nothing", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([{ id: KEYWORD_ID }]);
    const result = await startTopicClusterPlannerAction({
      ...VALID_INPUT,
      keywordIds: [KEYWORD_ID, "00000000-0000-4000-8000-00000000ae02"],
    });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("14. a duplicated keyword id in the selection is not mistaken for a missing one", async () => {
    mockedPrisma.keyword.findMany.mockResolvedValue([{ id: KEYWORD_ID }]);
    const result = await startTopicClusterPlannerAction({ ...VALID_INPUT, keywordIds: [KEYWORD_ID, KEYWORD_ID] });
    expect(result.success).toBe(true);
  });

  it("15. no keyword lookup happens at all when none were selected", async () => {
    await startTopicClusterPlannerAction(VALID_INPUT);
    expect(mockedPrisma.keyword.findMany).not.toHaveBeenCalled();
  });
});

describe("startTopicClusterPlannerAction — job creation", () => {
  it("16. creates the job with SERVER-derived company and project ids, never client-supplied ones", async () => {
    await startTopicClusterPlannerAction(VALID_INPUT);
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_A,
        seoProjectId: SEO_PROJECT_ID,
        taskType: "TOPIC_CLUSTER_PLANNING",
        createdById: MANAGER.id,
      })
    );
  });

  it("17. the stored job input carries the user's seed topic verbatim", async () => {
    await startTopicClusterPlannerAction({ ...VALID_INPUT, seedTopic: "self storage investing" });
    const created = mockedCreateAiGenerationJob.mock.calls[0][0];
    expect(created.inputJson.seedTopic).toBe("self storage investing");
  });

  it("18. no companyId from the client is ever trusted — the input schema has no such field", async () => {
    await startTopicClusterPlannerAction({ ...VALID_INPUT, companyId: COMPANY_B } as never);
    const created = mockedCreateAiGenerationJob.mock.calls[0][0];
    expect(created.companyId).toBe(COMPANY_A);
    expect(created.inputJson).not.toHaveProperty("companyId");
  });

  it("19. reuses an in-flight identical job instead of starting a duplicate", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "existing-job" });
    const result = await startTopicClusterPlannerAction(VALID_INPUT);
    expect(result).toEqual({ success: true, data: { jobId: "existing-job" } });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("20. this tool never creates or modifies Keyword, KeywordCluster or Content rows", async () => {
    await startTopicClusterPlannerAction(VALID_INPUT);
    // The mocked client exposes only the reads this action is allowed to make.
    expect(Object.keys(mockedPrisma)).toEqual(["sEOProject", "keyword"]);
    expect(Object.keys(mockedPrisma.keyword)).toEqual(["findMany"]);
  });
});
