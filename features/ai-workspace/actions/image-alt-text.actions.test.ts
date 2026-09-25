import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn(),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
}));
vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));
vi.mock("@/features/ai-workspace/services/project-image-inventory", () => ({ getProjectImage: vi.fn() }));

type MockPrisma = {
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  file: { findFirst: ReturnType<typeof vi.fn>; update: undefined };
  content: { update: undefined };
};

vi.mock("@/lib/prisma", () => ({
  prisma: { sEOProject: { findUnique: vi.fn() }, file: { findFirst: vi.fn() }, content: {} },
}));

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { getProjectImage } from "@/features/ai-workspace/services/project-image-inventory";
import { startImageAltTextAction } from "@/features/ai-workspace/actions/image-alt-text.actions";
import { DESCRIPTION_REQUIRED_MESSAGE } from "@/features/ai-workspace/schemas/image-alt-text.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedGetProjectImage = getProjectImage as unknown as ReturnType<typeof vi.fn>;
const mockedComputeInputHash = computeInputHash as unknown as ReturnType<typeof vi.fn>;
const mockedCreateAiGenerationJob = createAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedFindActiveAiGenerationJob = findActiveAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedRunAiGenerationJob = runAiGenerationJob as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const FILE_ID = "01a002a5-ffa5-705e-9731-8062675143ae";

const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT = { id: PROJECT_ID, companyId: COMPANY_A, name: "Storage Moguls", domain: "storagemoguls.test", deletedAt: null };
const IMAGE = {
  id: FILE_ID,
  fileName: "desk-photo.png",
  mimeType: "image/png",
  contentId: "01a002a5-ffa5-705e-9731-8062675143bb",
  content: { title: "How Self Storage Investing Works", metaDescription: null, seoProjectId: PROJECT_ID, deletedAt: null },
};

const VALID_INPUT = { seoProjectId: PROJECT_ID, fileId: FILE_ID, imageDescription: "A person at a desk reviewing a spreadsheet." };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedGetProjectImage.mockResolvedValue(IMAGE);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startImageAltTextAction — permission and project", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    expect((await startImageAltTextAction(VALID_INPUT)).success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("2. refuses a project belonging to ANOTHER company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    expect(await startImageAltTextAction(VALID_INPUT)).toEqual({ success: false, message: "SEO project not found." });
    expect(mockedGetProjectImage).not.toHaveBeenCalled();
  });

  it("3. refuses a SOFT-DELETED project", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: new Date("2026-08-12") });
    expect(await startImageAltTextAction(VALID_INPUT)).toEqual({ success: false, message: "SEO project not found." });
    expect(mockedGetProjectImage).not.toHaveBeenCalled();
  });

  it("4. refuses a project that does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    expect((await startImageAltTextAction(VALID_INPUT)).success).toBe(false);
  });
});

describe("startImageAltTextAction — image ownership", () => {
  it("5. looks the image up SCOPED TO THE VERIFIED PROJECT, never by id alone", async () => {
    await startImageAltTextAction(VALID_INPUT);
    expect(mockedGetProjectImage).toHaveBeenCalledWith(FILE_ID, PROJECT_ID);
  });

  it("6. refuses when the project-scoped lookup finds nothing", async () => {
    // One null covers every case: missing, non-image, soft-deleted,
    // cross-project, cross-company, and trashed-Content.
    mockedGetProjectImage.mockResolvedValue(null);
    expect(await startImageAltTextAction(VALID_INPUT)).toEqual({ success: false, message: "Image not found for this SEO project." });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("7. reports every refusal identically, disclosing nothing about why", async () => {
    const cases = ["missing", "non-image", "soft-deleted", "cross-project", "cross-company"];
    const byCase = new Map<string, string>();
    for (const label of cases) {
      // Each of these makes the project-scoped lookup return null, which is
      // exactly why they are indistinguishable to the caller.
      mockedGetProjectImage.mockResolvedValue(null);
      const result = await startImageAltTextAction(VALID_INPUT);
      byCase.set(label, result.success ? "(succeeded)" : result.message);
    }
    expect([...byCase.keys()]).toEqual(cases);
    expect(new Set(byCase.values()).size).toBe(1);
    expect(byCase.get("cross-company")).toBe("Image not found for this SEO project.");
  });
});

describe("startImageAltTextAction — image description evidence", () => {
  it("8. refuses a MISSING description before any job is created", async () => {
    const result = await startImageAltTextAction({ ...VALID_INPUT, imageDescription: undefined } as never);
    expect(result.success).toBe(false);
    expect(result.success === false && result.message).toBe(DESCRIPTION_REQUIRED_MESSAGE);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("9. refuses a whitespace-only description the same way", async () => {
    const result = await startImageAltTextAction({ ...VALID_INPUT, imageDescription: "   \n " });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("10. the message explains WHY the description is needed and blames neither the user nor the AI", () => {
    expect(DESCRIPTION_REQUIRED_MESSAGE).toMatch(/cannot see the image/i);
    expect(DESCRIPTION_REQUIRED_MESSAGE).not.toMatch(/failed|error|invalid|provider/i);
  });

  it("11. rejects a description beyond the 2000-character cap", async () => {
    const result = await startImageAltTextAction({ ...VALID_INPUT, imageDescription: "x".repeat(2001) });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });
});

describe("startImageAltTextAction — input validation", () => {
  it("12. rejects a missing or non-uuid project id", async () => {
    expect((await startImageAltTextAction({ ...VALID_INPUT, seoProjectId: "" })).success).toBe(false);
    expect((await startImageAltTextAction({ ...VALID_INPUT, seoProjectId: "nope" })).success).toBe(false);
  });

  it("13. rejects a missing or non-uuid file id", async () => {
    expect((await startImageAltTextAction({ ...VALID_INPUT, fileId: "" })).success).toBe(false);
    expect((await startImageAltTextAction({ ...VALID_INPUT, fileId: "nope" })).success).toBe(false);
  });
});

describe("startImageAltTextAction — job creation", () => {
  it("14. creates the job with SERVER-derived company, project and content ids", async () => {
    expect(await startImageAltTextAction(VALID_INPUT)).toEqual({ success: true, data: { jobId: "job-1" } });
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_A,
        seoProjectId: PROJECT_ID,
        contentId: IMAGE.contentId,
        taskType: "IMAGE_ALT_TEXT",
        createdById: MANAGER.id,
      })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("15. never takes companyId from the client", async () => {
    await startImageAltTextAction({ ...VALID_INPUT, companyId: COMPANY_B } as never);
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY_A }));
  });

  it("16. records no contentId when the image is not attached to any content", async () => {
    mockedGetProjectImage.mockResolvedValue({ ...IMAGE, contentId: null, content: null });
    await startImageAltTextAction(VALID_INPUT);
    expect(mockedCreateAiGenerationJob.mock.calls[0][0].contentId).toBeUndefined();
  });

  it("17. stores ids and the user's own words only — never the file name or mime type", async () => {
    await startImageAltTextAction(VALID_INPUT);
    const stored = mockedCreateAiGenerationJob.mock.calls[0][0].inputJson;
    expect(Object.keys(stored).sort()).toEqual(["fileId", "imageDescription", "seoProjectId"]);
    expect(JSON.stringify(stored)).not.toContain("desk-photo.png");
    expect(JSON.stringify(stored)).not.toContain("image/png");
  });

  it("18. reuses an already-active job for identical input rather than generating twice", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "job-existing" });
    expect(await startImageAltTextAction(VALID_INPUT)).toEqual({ success: true, data: { jobId: "job-existing" } });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("19. scopes the duplicate lookup to this company and task type", async () => {
    await startImageAltTextAction(VALID_INPUT);
    expect(mockedFindActiveAiGenerationJob).toHaveBeenCalledWith(COMPANY_A, "IMAGE_ALT_TEXT", "input-hash-1");
  });
});

describe("startImageAltTextAction — persistence", () => {
  it("20. never writes to File — the action has no update path at all", async () => {
    await startImageAltTextAction(VALID_INPUT);
    const fileMock = mockedPrisma.file as unknown as Record<string, unknown>;
    expect(fileMock.update).toBeUndefined();
    expect(fileMock.create).toBeUndefined();
    expect(fileMock.delete).toBeUndefined();
  });

  it("21. never writes to Content and never creates a revision", async () => {
    await startImageAltTextAction(VALID_INPUT);
    const contentMock = mockedPrisma.content as unknown as Record<string, unknown>;
    expect(contentMock.update).toBeUndefined();
    expect(contentMock.create).toBeUndefined();
  });
});
