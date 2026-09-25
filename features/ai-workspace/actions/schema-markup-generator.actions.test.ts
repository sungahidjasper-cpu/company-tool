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
const CONTENT_ROW = { id: "content-1", seoProjectId: "seo-1", deletedAt: null, companyId: COMPANY_A, seoProject: { companyId: COMPANY_A } };

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
    mockedPrisma.content.findUnique.mockResolvedValue({ id: "content-1", companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } });
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
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } });
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });
});

/**
 * C4.3 follow-up — the server-side lifecycle boundary.
 *
 * The route only lists live projects and live Content, and the C4 contextual
 * action hides itself for a trashed record, but neither is the security
 * boundary. These tests drive the action directly, the way a crafted request
 * would, and pin that a soft-deleted project or Content is rejected there.
 */
describe("startSchemaMarkupGenerationAction — soft-deleted records are rejected server-side", () => {
  const TRASHED = new Date("2026-08-12T00:00:00.000Z");

  it("11. ALLOWED — an active owned project with active owned Content still works (the fix must not over-reject)", async () => {
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(true);
    expect(mockedCreateAiGenerationJob).toHaveBeenCalled();
  });

  it("12. ALLOWED — a project row that simply omits deletedAt is treated as live, never wrongly rejected", async () => {
    // SEO_PROJECT deliberately has no deletedAt key at all; a `!== null`
    // check would reject it, which is why the truthy form is used.
    expect("deletedAt" in SEO_PROJECT).toBe(false);
    const result = await startSchemaMarkupGenerationAction(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it("13. REJECTED — a soft-deleted SEO project, even though it belongs to the actor's own company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: TRASHED });
    const result = await startSchemaMarkupGenerationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("14. REJECTED — a soft-deleted SEO project is refused even when no contentId is supplied at all", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: TRASHED });
    const result = await startSchemaMarkupGenerationAction({ seoProjectId: "seo-1" });
    expect(result.success).toBe(false);
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("15. REJECTED — soft-deleted Content under a live, owned project", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, deletedAt: TRASHED });
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("16. REJECTED — a FOREIGN project (another company) is still refused, unchanged by the lifecycle checks", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startSchemaMarkupGenerationAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("17. REJECTED — FOREIGN Content (another company) is still refused", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } });
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("18. REJECTED — PROJECT MISMATCH: Content of the same company but a different project", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, seoProjectId: "seo-OTHER" });
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("19. a rejected request never reaches the generator — no job row, no runner invocation, so no AI spend", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, deletedAt: TRASHED });
    await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("20. a trashed project and trashed Content together are refused at the PROJECT check, before Content is ever read", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: TRASHED });
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, deletedAt: TRASHED });
    const result = await startSchemaMarkupGenerationAction({ ...VALID_INPUT, contentId: "content-1" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
  });
});
