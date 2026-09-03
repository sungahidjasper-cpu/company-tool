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
  websiteAnalysisJob: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    websiteAnalysisJob: { findMany: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { startContentGapAnalysisAction } from "@/features/ai-workspace/actions/content-gap-analysis.actions";

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
const SEO_PROJECT = { id: SEO_PROJECT_ID, companyId: COMPANY_A, name: "Storage Moguls", domain: "storagemoguls.test" };

const USABLE_AUDIT_JOB = {
  id: "waj-usable",
  resultJson: { audit: { contentGaps: [{ title: "FAQs", description: "Add an FAQ page.", reasoning: "Helps SEO." }] } },
};
const NO_AUDIT_JOB = { id: "waj-no-audit", resultJson: { audit: null } };
const EMPTY_GAPS_JOB = { id: "waj-empty-gaps", resultJson: { audit: { contentGaps: [] } } };

const VALID_INPUT = { seoProjectId: SEO_PROJECT_ID };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.websiteAnalysisJob.findMany.mockResolvedValue([USABLE_AUDIT_JOB]);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startContentGapAnalysisAction", () => {
  it("1. valid request: creates a CONTENT_GAP_ANALYSIS job with the resolved websiteAnalysisJobId and kicks off runAiGenerationJob", async () => {
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("job-1");
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_A,
        seoProjectId: SEO_PROJECT_ID,
        taskType: "CONTENT_GAP_ANALYSIS",
        inputJson: { seoProjectId: SEO_PROJECT_ID, websiteAnalysisJobId: "waj-usable" },
      })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("2. reuses an existing active job for identical input instead of creating a second one", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "existing-job" });
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("existing-job");
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("3. rejects an unauthenticated request", async () => {
    mockedRequireUser.mockRejectedValue(new Error("Not authenticated"));
    await expect(startContentGapAnalysisAction(VALID_INPUT)).rejects.toThrow();
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("4. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum (permission failure)", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("5. rejects when the SEO project does not exist (nonexistent project)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("6. rejects when the SEO project belongs to another company (cross-company project)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("7. rejects a malformed (non-UUID) seoProjectId without any lookup", async () => {
    const result = await startContentGapAnalysisAction({ seoProjectId: "not-a-real-id" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("8. rejects when no SUCCEEDED website analysis job exists for the project at all (missing audit)", async () => {
    mockedPrisma.websiteAnalysisJob.findMany.mockResolvedValue([]);
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/website analysis/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("9. rejects when the only SUCCEEDED jobs have no AI-enriched audit (crawl-only, audit: null)", async () => {
    mockedPrisma.websiteAnalysisJob.findMany.mockResolvedValue([NO_AUDIT_JOB]);
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("10. rejects when the audit has an empty contentGaps array", async () => {
    mockedPrisma.websiteAnalysisJob.findMany.mockResolvedValue([EMPTY_GAPS_JOB]);
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("11. skips a newer job with no usable audit and falls back to an older one that has real gaps", async () => {
    mockedPrisma.websiteAnalysisJob.findMany.mockResolvedValue([NO_AUDIT_JOB, EMPTY_GAPS_JOB, USABLE_AUDIT_JOB]);
    const result = await startContentGapAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(true);
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ inputJson: { seoProjectId: SEO_PROJECT_ID, websiteAnalysisJobId: "waj-usable" } }));
  });

  it("12. queries only SUCCEEDED jobs scoped to this project and company (never trusting a broader query)", async () => {
    await startContentGapAnalysisAction(VALID_INPUT);
    expect(mockedPrisma.websiteAnalysisJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { seoProjectId: SEO_PROJECT_ID, companyId: COMPANY_A, status: "SUCCEEDED" } })
    );
  });

  it("13. never passes a contentId to createAiGenerationJob — this tool has no Content dependency in its job scoping", async () => {
    await startContentGapAnalysisAction(VALID_INPUT);
    const [callArgs] = mockedCreateAiGenerationJob.mock.calls[0];
    expect(callArgs).not.toHaveProperty("contentId");
  });

  it("14. never trusts a client-supplied companyId — the input schema has no such field to smuggle it through", async () => {
    const result = await startContentGapAnalysisAction({ ...VALID_INPUT, companyId: COMPANY_B } as never);
    expect(result.success).toBe(true);
    const [callArgs] = mockedCreateAiGenerationJob.mock.calls[0];
    expect(callArgs.companyId).toBe(COMPANY_A);
    expect(callArgs.inputJson).not.toHaveProperty("companyId");
  });
});
