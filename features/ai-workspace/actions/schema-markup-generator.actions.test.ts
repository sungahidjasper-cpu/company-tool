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
  content: { findUnique: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    content: { findUnique: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { startSchemaMarkupGenerationAction } from "@/features/ai-workspace/actions/schema-markup-generator.actions";

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
const CONTENT_ROW = { id: "content-1", seoProjectId: "seo-1", deletedAt: null, seoProject: { companyId: COMPANY_A } };

const VALID_INPUT = { seoProjectId: "seo-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.content.findUnique.mockResolvedValue(CONTENT_ROW);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startSchemaMarkupGenerationAction", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startSchemaMarkupGenerationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("2. rejects invalid input (missing seoProjectId) without any lookup", async () => {
    const result = await startSchemaMarkupGenerationAction({} as never);
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("3. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await startSchemaMarkupGenerationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("4. rejects when the SEO project belongs to another company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startSchemaMarkupGenerationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("5. rejects when the supplied contentId belongs to another company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ id: "content-1", seoProject: { companyId: COMPANY_B } });
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("6. creates a SCHEMA_MARKUP_GENERATION job and kicks off runAiGenerationJob, unawaited", async () => {
    const result = await startSchemaMarkupGenerationAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("job-1");
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_A, seoProjectId: "seo-1", taskType: "SCHEMA_MARKUP_GENERATION" })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("7. reuses an existing active job for the identical input instead of creating a second one", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "existing-job" });
    const result = await startSchemaMarkupGenerationAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("existing-job");
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  /**
   * Phase B M1 — this action's own error message has always claimed "Content
   * not found for THIS SEO project", but the check behind it only compared
   * companies: a contentId from a DIFFERENT project in the same company was
   * accepted and written onto the job alongside an unrelated seoProjectId.
   * Every structural peer (content-rewriter, meta-tag-optimizer,
   * social-snippet-generator, internal-link-analyzer) already enforces the
   * project boundary; this closes the gap.
   */
  it("8. accepts a contentId that genuinely belongs to the selected SEO project", async () => {
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(true);
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ seoProjectId: "seo-1", contentId: "content-1" }));
  });

  it("9. rejects a contentId belonging to a DIFFERENT project in the same company (project-scoping regression)", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, seoProjectId: "seo-OTHER" });
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("10. rejects a contentId belonging to another company even when its seoProjectId matches", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, seoProject: { companyId: COMPANY_B } });
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });
});
