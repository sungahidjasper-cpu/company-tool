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
import { startSocialSnippetGeneratorAction } from "@/features/ai-workspace/actions/social-snippet-generator.actions";

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
const CONTENT_ROW = { id: "content-1", seoProjectId: "seo-1", companyId: COMPANY_A, seoProject: { companyId: COMPANY_A } };

const VALID_INPUT = { seoProjectId: "seo-1", contentId: "content-1", platforms: ["X" as const] };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.content.findUnique.mockResolvedValue(CONTENT_ROW);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startSocialSnippetGeneratorAction", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("2. rejects invalid input (missing contentId) without any lookup", async () => {
    const result = await startSocialSnippetGeneratorAction({ seoProjectId: "seo-1", platforms: ["X"] } as never);
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("3. rejects invalid input (empty platforms array)", async () => {
    const result = await startSocialSnippetGeneratorAction({ seoProjectId: "seo-1", contentId: "content-1", platforms: [] });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input (invalid platform value)", async () => {
    const result = await startSocialSnippetGeneratorAction({ seoProjectId: "seo-1", contentId: "content-1", platforms: ["INSTAGRAM"] } as never);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("5. accepts an optional notes field", async () => {
    const result = await startSocialSnippetGeneratorAction({ ...VALID_INPUT, notes: "keep it upbeat" });
    expect(result.success).toBe(true);
  });

  it("6. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("7. rejects when the SEO project belongs to another company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("8. rejects when the content belongs to another company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("9. rejects when the content belongs to a different SEO project than the one selected", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, seoProjectId: "seo-2" });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("10. creates a SOCIAL_SNIPPET_GENERATION job and kicks off runAiGenerationJob, unawaited", async () => {
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("job-1");
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_A, seoProjectId: "seo-1", contentId: "content-1", taskType: "SOCIAL_SNIPPET_GENERATION" })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("11. reuses an existing active job for the identical input instead of creating a second one", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "existing-job" });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.jobId).toBe("existing-job");
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });
});

/**
 * Phase C4.5 — the server-side lifecycle boundary for the Social Snippet
 * Generator, brought in line with the three tools already connected to
 * Content Detail (schema-markup, content-rewriter, meta-tag-optimizer).
 *
 * Before C4.5 this action verified company ownership and the project match
 * but neither soft-delete state, so a crafted request naming a trashed
 * project or a trashed Content row of the actor's own company was accepted
 * and a real AI job was created for it. These tests drive the action
 * directly, the way such a request would.
 */
describe("startSocialSnippetGeneratorAction — project/content lifecycle is enforced server-side", () => {
  const TRASHED = new Date("2026-08-12T00:00:00.000Z");

  it("12. ALLOWED — active owned project + active owned Content", async () => {
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(true);
    expect(mockedCreateAiGenerationJob).toHaveBeenCalled();
  });

  it("13. ALLOWED — fixtures that OMIT deletedAt are treated as live, never wrongly rejected", async () => {
    expect("deletedAt" in SEO_PROJECT).toBe(false);
    expect("deletedAt" in CONTENT_ROW).toBe(false);
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it("14. BLOCKED — soft-deleted SEO project, even within the actor's own company; no AI job is created", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: TRASHED });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("15. BLOCKED — soft-deleted Content under a live owned project; no AI job is created", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, deletedAt: TRASHED });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("16. BLOCKED — FOREIGN project (another company)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("17. BLOCKED — FOREIGN Content (another company)", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("18. BLOCKED — PROJECT MISMATCH: Content of the same company but a different project", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, seoProjectId: "seo-OTHER" });
    const result = await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("19. a trashed project short-circuits BEFORE the Content row is ever read", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: TRASHED });
    await startSocialSnippetGeneratorAction(VALID_INPUT);
    expect(mockedPrisma.content.findUnique).not.toHaveBeenCalled();
  });

  it("20. the platform selection is unchanged by these checks — a valid request still passes the platforms through untouched", async () => {
    await startSocialSnippetGeneratorAction({ ...VALID_INPUT, platforms: ["X", "LINKEDIN", "FACEBOOK"] });
    const created = mockedCreateAiGenerationJob.mock.calls[0][0];
    expect(created.inputJson.platforms).toEqual(["X", "LINKEDIN", "FACEBOOK"]);
  });
});
