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
  content: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    content: { findMany: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { startMetaTagOptimizerAction } from "@/features/ai-workspace/actions/meta-tag-optimizer.actions";

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
