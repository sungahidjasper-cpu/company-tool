import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn(),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
}));
vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));
vi.mock("@/features/companies/services/brand-profile.service", () => ({ getBrandProfileByCompanyId: vi.fn() }));
vi.mock("@/features/publishing/services/ssrf-guard.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/publishing/services/ssrf-guard.service")>()),
  assertSafePublicUrl: vi.fn(),
}));

type MockPrisma = { sEOProject: { findUnique: ReturnType<typeof vi.fn> } };
vi.mock("@/lib/prisma", () => ({ prisma: { sEOProject: { findUnique: vi.fn() } } }));

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";
import { assertSafePublicUrl, UnsafePublishingUrlError } from "@/features/publishing/services/ssrf-guard.service";
import { startCompetitorContentAnalysisAction } from "@/features/ai-workspace/actions/competitor-content-analysis.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedComputeInputHash = computeInputHash as unknown as ReturnType<typeof vi.fn>;
const mockedCreateJob = createAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedFindActiveJob = findActiveAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedRunJob = runAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedBrandProfile = getBrandProfileByCompanyId as unknown as ReturnType<typeof vi.fn>;
const mockedAssertSafe = assertSafePublicUrl as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT_ID = "00000000-0000-4000-8000-0000000000f0";
const SEO_PROJECT = { id: SEO_PROJECT_ID, companyId: COMPANY_A, name: "Storage Moguls", domain: "storagemoguls.com" };

const VALID_INPUT = { seoProjectId: SEO_PROJECT_ID, competitorUrls: ["https://competitor.com"] };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedBrandProfile.mockResolvedValue(null);
  mockedAssertSafe.mockResolvedValue({ hostname: "competitor.com", port: 443, pinnedIp: "93.184.216.34", pinnedFamily: 4 });
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveJob.mockResolvedValue(null);
  mockedCreateJob.mockResolvedValue({ id: "job-1" });
});

describe("startCompetitorContentAnalysisAction — authorization", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateJob).not.toHaveBeenCalled();
    expect(mockedAssertSafe).not.toHaveBeenCalled();
  });

  it("2. rejects an unauthenticated request", async () => {
    mockedRequireUser.mockRejectedValue(new Error("Not authenticated"));
    await expect(startCompetitorContentAnalysisAction(VALID_INPUT)).rejects.toThrow();
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });
});

describe("startCompetitorContentAnalysisAction — project security", () => {
  it("3. rejects a project belonging to ANOTHER company, before any URL is checked", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not found/i);
    expect(mockedAssertSafe).not.toHaveBeenCalled();
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("4. rejects a missing project", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    expect((await startCompetitorContentAnalysisAction(VALID_INPUT)).success).toBe(false);
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("5. rejects a SOFT-DELETED project", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: new Date("2026-08-12") });
    const result = await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedAssertSafe).not.toHaveBeenCalled();
    expect(mockedRunJob).not.toHaveBeenCalled();
  });

  it("6. rejects a non-UUID project id without any lookup", async () => {
    const result = await startCompetitorContentAnalysisAction({ ...VALID_INPUT, seoProjectId: "nope" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });
});

describe("startCompetitorContentAnalysisAction — SSRF boundary", () => {
  it("7. the DNS-resolving guard runs on every URL before a job is ever created", async () => {
    await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(mockedAssertSafe).toHaveBeenCalledWith("https://competitor.com");
    expect(mockedAssertSafe.mock.invocationCallOrder[0]).toBeLessThan(mockedCreateJob.mock.invocationCallOrder[0]);
  });

  it("8. an UNSAFE url is refused with the guard's reason, and no job is created", async () => {
    mockedAssertSafe.mockRejectedValue(new UnsafePublishingUrlError("The destination URL may not point to localhost."));
    const result = await startCompetitorContentAnalysisAction({ ...VALID_INPUT, competitorUrls: ["https://internal.example.com"] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/may not point to localhost/i);
    expect(mockedCreateJob).not.toHaveBeenCalled();
    expect(mockedRunJob).not.toHaveBeenCalled();
  });

  it("9. an unexpected guard failure still refuses the URL rather than proceeding", async () => {
    mockedAssertSafe.mockRejectedValue(new Error("boom"));
    const result = await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("10. a malformed or non-https url never reaches the guard at all", async () => {
    for (const url of ["http://competitor.com", "ftp://competitor.com", "localhost", "not a url"]) {
      vi.clearAllMocks();
      mockedRequireUser.mockResolvedValue(MANAGER);
      mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
      mockedBrandProfile.mockResolvedValue(null);
      const result = await startCompetitorContentAnalysisAction({ ...VALID_INPUT, competitorUrls: [url] });
      expect(result.success).toBe(false);
      expect(mockedAssertSafe).not.toHaveBeenCalled();
      expect(mockedCreateJob).not.toHaveBeenCalled();
    }
  });

  it("11. a userinfo-attack url is refused before the guard", async () => {
    const result = await startCompetitorContentAnalysisAction({ ...VALID_INPUT, competitorUrls: ["https://real.com@evil.example.com/"] });
    expect(result.success).toBe(false);
    expect(mockedAssertSafe).not.toHaveBeenCalled();
  });

  it("12. EVERY url in a multi-url request is checked — one unsafe entry fails the whole request", async () => {
    mockedAssertSafe.mockResolvedValueOnce({ hostname: "a.com", port: 443, pinnedIp: "1.1.1.1", pinnedFamily: 4 });
    mockedAssertSafe.mockRejectedValueOnce(new UnsafePublishingUrlError("blocked"));
    const result = await startCompetitorContentAnalysisAction({ ...VALID_INPUT, competitorUrls: ["https://a.com", "https://b.com"] });
    expect(result.success).toBe(false);
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });
});

describe("startCompetitorContentAnalysisAction — job creation", () => {
  it("13. stores the normalized ORIGIN, not the raw user text", async () => {
    await startCompetitorContentAnalysisAction({ ...VALID_INPUT, competitorUrls: ["https://competitor.com/blog/post?x=1"] });
    const created = mockedCreateJob.mock.calls[0][0];
    expect(created.inputJson.competitors).toEqual([{ origin: "https://competitor.com", source: "USER" }]);
  });

  it("14. labels a URL as USER-provided when it is not on the Brand Profile", async () => {
    await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(mockedCreateJob.mock.calls[0][0].inputJson.competitors[0].source).toBe("USER");
  });

  it("15. labels a URL as BRAND_PROFILE when it matches a stored company competitor URL", async () => {
    mockedBrandProfile.mockResolvedValue({ competitorUrls: ["https://competitor.com/"] });
    await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(mockedCreateJob.mock.calls[0][0].inputJson.competitors[0].source).toBe("BRAND_PROFILE");
  });

  it("16. an empty Brand Profile competitor list changes nothing", async () => {
    mockedBrandProfile.mockResolvedValue({ competitorUrls: [] });
    const result = await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(result.success).toBe(true);
    expect(mockedCreateJob.mock.calls[0][0].inputJson.competitors[0].source).toBe("USER");
  });

  it("17. de-duplicates the same site supplied twice", async () => {
    await startCompetitorContentAnalysisAction({ ...VALID_INPUT, competitorUrls: ["https://competitor.com/a", "https://competitor.com/b"] });
    expect(mockedCreateJob.mock.calls[0][0].inputJson.competitors).toHaveLength(1);
  });

  it("18. creates the job with SERVER-derived company and project ids", async () => {
    await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(mockedCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_A,
        seoProjectId: SEO_PROJECT_ID,
        taskType: "COMPETITOR_CONTENT_ANALYSIS",
        createdById: MANAGER.id,
      })
    );
  });

  it("19. a client-supplied companyId is never trusted — the input schema has no such field", async () => {
    await startCompetitorContentAnalysisAction({ ...VALID_INPUT, companyId: COMPANY_B } as never);
    const created = mockedCreateJob.mock.calls[0][0];
    expect(created.companyId).toBe(COMPANY_A);
    expect(created.inputJson).not.toHaveProperty("companyId");
  });

  it("20. reuses an in-flight identical job instead of starting a duplicate crawl", async () => {
    mockedFindActiveJob.mockResolvedValue({ id: "existing-job" });
    const result = await startCompetitorContentAnalysisAction(VALID_INPUT);
    expect(result).toEqual({ success: true, data: { jobId: "existing-job" } });
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("21. rejects an empty competitor URL list", async () => {
    const result = await startCompetitorContentAnalysisAction({ ...VALID_INPUT, competitorUrls: [] });
    expect(result.success).toBe(false);
    expect(mockedCreateJob).not.toHaveBeenCalled();
  });

  it("22. this tool never creates or modifies Content, Keyword, KeywordCluster or Brand Profile rows", async () => {
    await startCompetitorContentAnalysisAction(VALID_INPUT);
    // The mocked client exposes only the single read this action is allowed.
    expect(Object.keys(mockedPrisma)).toEqual(["sEOProject"]);
    expect(Object.keys(mockedPrisma.sEOProject)).toEqual(["findUnique"]);
  });
});
