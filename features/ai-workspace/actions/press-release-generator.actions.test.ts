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
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { startPressReleaseGenerationAction } from "@/features/ai-workspace/actions/press-release-generator.actions";

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
const SEO_PROJECT = { id: SEO_PROJECT_ID, companyId: COMPANY_A, name: "Acme SEO", domain: "acme.test" };

const VALID_INPUT = {
  seoProjectId: SEO_PROJECT_ID,
  headline: "Acme Launches New Product",
  keyFacts: "Acme is launching a new product line starting next month.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startPressReleaseGenerationAction", () => {
  it("1. valid request: creates a PRESS_RELEASE_GENERATION job with the authenticated actor's companyId and kicks off runAiGenerationJob", async () => {
    const result = await startPressReleaseGenerationAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("job-1");
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_A, seoProjectId: SEO_PROJECT_ID, taskType: "PRESS_RELEASE_GENERATION" })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("1b. never passes a contentId to createAiGenerationJob — this tool has no Content dependency at all, so the resulting job's own contentId column stays null", async () => {
    await startPressReleaseGenerationAction(VALID_INPUT);
    const [callArgs] = mockedCreateAiGenerationJob.mock.calls[0];
    expect(callArgs).not.toHaveProperty("contentId");
  });

  it("2. reuses an existing active job for identical input instead of creating a second one (duplicate active-job behavior)", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "existing-job" });
    const result = await startPressReleaseGenerationAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("existing-job");
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("3. rejects an unauthenticated request", async () => {
    mockedRequireUser.mockRejectedValue(new Error("Not authenticated"));
    await expect(startPressReleaseGenerationAction(VALID_INPUT)).rejects.toThrow();
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("4. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum (permission failure)", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startPressReleaseGenerationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("5. rejects when the SEO project does not exist (nonexistent project)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await startPressReleaseGenerationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("6. rejects when the SEO project belongs to another company (cross-company project)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startPressReleaseGenerationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("7. rejects a malformed (non-UUID) seoProjectId without any lookup", async () => {
    const result = await startPressReleaseGenerationAction({ ...VALID_INPUT, seoProjectId: "not-a-real-id" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("8. rejects a missing headline", async () => {
    const result = await startPressReleaseGenerationAction({ ...VALID_INPUT, headline: "" });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("9. rejects a missing keyFacts", async () => {
    const result = await startPressReleaseGenerationAction({ ...VALID_INPUT, keyFacts: "" });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("10. rejects keyFacts over 4000 characters", async () => {
    const result = await startPressReleaseGenerationAction({ ...VALID_INPUT, keyFacts: "a".repeat(4001) });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("11. accepts keyFacts at exactly 4000 characters", async () => {
    const result = await startPressReleaseGenerationAction({ ...VALID_INPUT, keyFacts: "a".repeat(4000) });
    expect(result.success).toBe(true);
  });

  it("12. never trusts a client-supplied companyId — the input schema has no such field to smuggle it through (companyId ownership)", async () => {
    const result = await startPressReleaseGenerationAction({ ...VALID_INPUT, companyId: COMPANY_B } as never);
    expect(result.success).toBe(true);
    const [callArgs] = mockedCreateAiGenerationJob.mock.calls[0];
    expect(callArgs.companyId).toBe(COMPANY_A);
    expect(callArgs.inputJson).not.toHaveProperty("companyId");
  });

  it("13. accepts optional quote/dateline/callToAction/notes when supplied", async () => {
    const result = await startPressReleaseGenerationAction({
      ...VALID_INPUT,
      quote: '"Great news" - Jane Doe',
      dateline: "Austin, TX",
      callToAction: "Visit acme.example.com",
      notes: "Keep it concise.",
    });
    expect(result.success).toBe(true);
    const [callArgs] = mockedCreateAiGenerationJob.mock.calls[0];
    expect(callArgs.inputJson.quote).toBe('"Great news" - Jane Doe');
    expect(callArgs.inputJson.dateline).toBe("Austin, TX");
  });

  it("14. omits quote/dateline/callToAction/notes from inputJson when not supplied, rather than storing empty strings", async () => {
    await startPressReleaseGenerationAction(VALID_INPUT);
    const [callArgs] = mockedCreateAiGenerationJob.mock.calls[0];
    expect(callArgs.inputJson.quote).toBeUndefined();
    expect(callArgs.inputJson.dateline).toBeUndefined();
    expect(callArgs.inputJson.callToAction).toBeUndefined();
    expect(callArgs.inputJson.notes).toBeUndefined();
  });
});
