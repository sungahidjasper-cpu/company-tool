import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn(),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
  getAiGenerationJob: vi.fn(),
}));
vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));

type MockPrisma = {
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  content: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    content: { findUnique: vi.fn(), create: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob, getAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { saveEmailNewsletterAsContentAction, startEmailNewsletterAction } from "@/features/ai-workspace/actions/email-newsletter.actions";
import { INSUFFICIENT_SOURCE_MATERIAL_MESSAGE, type EmailNewsletterResult } from "@/features/ai-workspace/schemas/email-newsletter.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedComputeInputHash = computeInputHash as unknown as ReturnType<typeof vi.fn>;
const mockedCreateAiGenerationJob = createAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedFindActiveAiGenerationJob = findActiveAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedRunAiGenerationJob = runAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedGetAiGenerationJob = getAiGenerationJob as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const OTHER_PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514399";
const CONTENT_ID = "01a002a5-ffa5-705e-9731-8062675143ae";

const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT = { id: PROJECT_ID, companyId: COMPANY_A, name: "Storage Moguls", domain: "storagemoguls.test", deletedAt: null };
const CONTENT_ROW = {
  id: CONTENT_ID,
  seoProjectId: PROJECT_ID,
  deletedAt: null,
  body: "Self storage facilities generate income from monthly unit rentals.",
  companyId: COMPANY_A, seoProject: { companyId: COMPANY_A },
};

const VALID_INPUT = { seoProjectId: PROJECT_ID, contentId: CONTENT_ID };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.content.findUnique.mockResolvedValue(CONTENT_ROW);
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
});

describe("startEmailNewsletterAction — permission", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });
});

describe("startEmailNewsletterAction — project ownership", () => {
  it("2. refuses a project belonging to ANOTHER company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result).toEqual({ success: false, message: "SEO project not found." });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("3. refuses a SOFT-DELETED project", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, deletedAt: new Date("2026-08-12") });
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result).toEqual({ success: false, message: "SEO project not found." });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("4. refuses a project that does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    expect((await startEmailNewsletterAction(VALID_INPUT)).success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });
});

describe("startEmailNewsletterAction — Content ownership", () => {
  it("5. refuses Content belonging to ANOTHER company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, companyId: COMPANY_B, seoProject: { companyId: COMPANY_B } });
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result).toEqual({ success: false, message: "Content not found for this SEO project." });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("6. refuses CROSS-PROJECT Content — same company, different project", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, seoProjectId: OTHER_PROJECT_ID });
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result).toEqual({ success: false, message: "Content not found for this SEO project." });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("7. refuses SOFT-DELETED Content", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, deletedAt: new Date("2026-08-12") });
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result).toEqual({ success: false, message: "Content not found for this SEO project." });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("8. refuses Content that does not exist", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(null);
    expect((await startEmailNewsletterAction(VALID_INPUT)).success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("9. RE-FETCHES the Content from the database rather than trusting the client", async () => {
    await startEmailNewsletterAction(VALID_INPUT);
    expect(mockedPrisma.content.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CONTENT_ID }, include: { seoProject: { select: { companyId: true } } } })
    );
  });
});

describe("startEmailNewsletterAction — source material", () => {
  it("10. refuses an EMPTY Content body with no additional context, before any job is created", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, body: null });
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result).toEqual({ success: false, message: INSUFFICIENT_SOURCE_MATERIAL_MESSAGE });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("11. refuses a whitespace-only body the same way", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, body: "   \n  " });
    expect((await startEmailNewsletterAction(VALID_INPUT)).success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("12. the empty-body message explains the situation without blaming the user or the AI", () => {
    expect(INSUFFICIENT_SOURCE_MATERIAL_MESSAGE).toContain("no body text yet");
    expect(INSUFFICIENT_SOURCE_MATERIAL_MESSAGE).toContain("provide additional context");
    expect(INSUFFICIENT_SOURCE_MATERIAL_MESSAGE).not.toMatch(/AI|provider|failed|error/i);
  });

  it("13. ALLOWS an empty body when the user supplied their own context", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, body: null });
    const result = await startEmailNewsletterAction({ ...VALID_INPUT, additionalContext: "We launched a new returns calculator this month." });
    expect(result).toEqual({ success: true, data: { jobId: "job-1" } });
    expect(mockedCreateAiGenerationJob).toHaveBeenCalled();
  });

  it("14. checks the RE-FETCHED body, not a client-supplied claim about it", async () => {
    // The client cannot smuggle a body through the request — the input schema
    // has no body field, so an empty row is refused whatever the caller sends.
    mockedPrisma.content.findUnique.mockResolvedValue({ ...CONTENT_ROW, body: "" });
    const result = await startEmailNewsletterAction({ ...VALID_INPUT, body: "pretend text" } as never);
    expect(result.success).toBe(false);
  });
});

describe("startEmailNewsletterAction — input validation", () => {
  it("15. rejects a missing or non-uuid project id", async () => {
    expect((await startEmailNewsletterAction({ ...VALID_INPUT, seoProjectId: "" })).success).toBe(false);
    expect((await startEmailNewsletterAction({ ...VALID_INPUT, seoProjectId: "not-a-uuid" })).success).toBe(false);
  });

  it("16. rejects a missing or non-uuid content id", async () => {
    expect((await startEmailNewsletterAction({ ...VALID_INPUT, contentId: "" })).success).toBe(false);
    expect((await startEmailNewsletterAction({ ...VALID_INPUT, contentId: "not-a-uuid" })).success).toBe(false);
  });

  it("17. rejects additional context beyond the 4000-character cap", async () => {
    const result = await startEmailNewsletterAction({ ...VALID_INPUT, additionalContext: "x".repeat(4001) });
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });
});

describe("startEmailNewsletterAction — job creation", () => {
  it("18. creates the job with the SERVER-derived company, project and content ids", async () => {
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result).toEqual({ success: true, data: { jobId: "job-1" } });
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_A,
        seoProjectId: PROJECT_ID,
        contentId: CONTENT_ID,
        taskType: "EMAIL_NEWSLETTER",
        createdById: MANAGER.id,
      })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
  });

  it("19. never takes companyId from the client", async () => {
    await startEmailNewsletterAction({ ...VALID_INPUT, companyId: COMPANY_B } as never);
    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY_A }));
  });

  it("20. stores ids and the user's own text only — never a resolved Content field", async () => {
    await startEmailNewsletterAction({ ...VALID_INPUT, audience: "Investors", callToAction: "Read the guide" });
    const stored = mockedCreateAiGenerationJob.mock.calls[0][0].inputJson;
    expect(Object.keys(stored).sort()).toEqual(["audience", "callToAction", "contentId", "seoProjectId"]);
    expect(JSON.stringify(stored)).not.toContain("Self storage facilities generate income");
  });

  it("21. reuses an already-active job for identical input rather than generating twice", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "job-existing" });
    const result = await startEmailNewsletterAction(VALID_INPUT);
    expect(result).toEqual({ success: true, data: { jobId: "job-existing" } });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("22. scopes the duplicate lookup to this company and task type", async () => {
    await startEmailNewsletterAction(VALID_INPUT);
    expect(mockedFindActiveAiGenerationJob).toHaveBeenCalledWith(COMPANY_A, "EMAIL_NEWSLETTER", "input-hash-1");
  });

  it("23. creates NO Content and modifies none — this action only creates a job", async () => {
    await startEmailNewsletterAction(VALID_INPUT);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
    // The only content call made is the ownership read.
    expect(mockedPrisma.content.findUnique).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------- Save as Content -------------------------------- */

const JOB_ID = "01a002a5-ffa5-705e-9731-806267514300";

const NEWSLETTER_RESULT: EmailNewsletterResult = {
  subjectLine: "New guide: self storage income",
  previewText: "See how monthly rentals add up.",
  headline: "Self storage income, explained",
  introduction: "Here is what our latest guide covers.",
  bodySections: [{ heading: "The basics", body: "Facilities earn from monthly unit rentals." }],
  callToAction: "Read the full guide",
  closing: "Thanks for reading.",
  reasoning: "Grounded entirely in the source page.",
};

const SUCCEEDED_JOB = {
  id: JOB_ID,
  companyId: COMPANY_A,
  taskType: "EMAIL_NEWSLETTER",
  status: "SUCCEEDED",
  seoProjectId: PROJECT_ID,
  resultJson: { result: NEWSLETTER_RESULT },
};

describe("saveEmailNewsletterAsContentAction", () => {
  beforeEach(() => {
    mockedGetAiGenerationJob.mockResolvedValue(SUCCEEDED_JOB);
    mockedPrisma.content.create.mockResolvedValue({ id: "content-1", title: NEWSLETTER_RESULT.subjectLine });
  });

  it("1. the correct user (same company, manageSeoProjects role) can save", async () => {
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ id: "content-1" });
  });

  it("2. a user from another company cannot save — the job lookup is company-scoped", async () => {
    mockedRequireUser.mockResolvedValue({ id: "user-b", role: "MANAGER", companyId: COMPANY_B });
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3. a non-owned/non-existent job cannot be saved", async () => {
    mockedGetAiGenerationJob.mockResolvedValue(null);
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3b. a job for a different task type is refused, even if it belongs to this company", async () => {
    mockedGetAiGenerationJob.mockResolvedValue({ ...SUCCEEDED_JOB, taskType: "PRESS_RELEASE_GENERATION" });
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3c. a job that has not succeeded yet cannot be saved", async () => {
    mockedGetAiGenerationJob.mockResolvedValue({ ...SUCCEEDED_JOB, status: "RUNNING" });
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("4. a non-owned SEO project cannot be saved against", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("5. sets contentType = NEWSLETTER", async () => {
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.contentType).toBe("NEWSLETTER");
  });

  it("6. sets status = DRAFT", async () => {
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("DRAFT");
  });

  it("7. sets generatedByAi = true", async () => {
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.generatedByAi).toBe(true);
  });

  it("8. companyId comes from the authenticated user, never client input", async () => {
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.companyId).toBe(COMPANY_A);
  });

  it("9. clientId comes from seoProject.clientId ?? null", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, clientId: "client-42" });
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    const [{ data: withClient }] = mockedPrisma.content.create.mock.calls[0];
    expect(withClient.clientId).toBe("client-42");

    mockedPrisma.content.create.mockClear();
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, clientId: null });
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    const [{ data: withoutClient }] = mockedPrisma.content.create.mock.calls[0];
    expect(withoutClient.clientId).toBeNull();
  });

  it("10. Content.body contains the generated document", async () => {
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.body).toContain(NEWSLETTER_RESULT.headline);
    expect(data.body).toContain(NEWSLETTER_RESULT.introduction);
    expect(data.body).toContain(NEWSLETTER_RESULT.bodySections[0].heading);
    expect(data.body).toContain(NEWSLETTER_RESULT.bodySections[0].body);
    expect(data.body).toContain(NEWSLETTER_RESULT.callToAction);
    expect(data.body).toContain(NEWSLETTER_RESULT.closing);
  });

  it("11. Content.aiBriefDetails preserves the full structured newsletter — nothing lost in conversion", async () => {
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.aiBriefDetails).toEqual(NEWSLETTER_RESULT);
  });

  it("12. logs the activity", async () => {
    await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "content.ai_email_newsletter_saved", companyId: COMPANY_A, contentId: "content-1" })
    );
  });

  it("13. the browser-supplied jobId is the only input — the actual text is re-read from the job row, never trusted from the client", async () => {
    // No text field of any kind is accepted in the input type; this documents that contract directly.
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(true);
    expect(mockedGetAiGenerationJob).toHaveBeenCalledWith(JOB_ID);
  });

  it("14. an EMPLOYEE cannot save", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("15. a job with a null result (generation succeeded but produced nothing valid) cannot be saved", async () => {
    mockedGetAiGenerationJob.mockResolvedValue({ ...SUCCEEDED_JOB, resultJson: { result: null } });
    const result = await saveEmailNewsletterAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });
});
