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
  content: { create: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    content: { create: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob, getAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { savePressReleaseAsContentAction, startPressReleaseGenerationAction } from "@/features/ai-workspace/actions/press-release-generator.actions";
import type { PressReleaseResult } from "@/features/ai-workspace/schemas/press-release-generator.schema";

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

/* -------------------------------- Save as Content -------------------------------- */

const JOB_ID = "01a002a5-ffa5-705e-9731-806267514300";

const PRESS_RELEASE_RESULT: PressReleaseResult = {
  headline: "Acme Launches New Product Line",
  subheadline: "Available starting next month",
  dateline: "Austin, TX",
  leadParagraph: "Acme today announced a new product line.",
  bodyParagraphs: ["The new line expands on Acme's existing offering."],
  quoteSection: '"We are thrilled" - Jane Doe, CEO',
  boilerplate: "Acme is a leading provider of widgets.",
  callToAction: "Visit acme.example.com to learn more",
  reasoning: "Grounded entirely in the supplied announcement facts.",
};

const SUCCEEDED_JOB = {
  id: JOB_ID,
  companyId: COMPANY_A,
  taskType: "PRESS_RELEASE_GENERATION",
  status: "SUCCEEDED",
  seoProjectId: SEO_PROJECT_ID,
  resultJson: { result: PRESS_RELEASE_RESULT },
};

describe("savePressReleaseAsContentAction", () => {
  beforeEach(() => {
    mockedGetAiGenerationJob.mockResolvedValue(SUCCEEDED_JOB);
    mockedPrisma.content.create.mockResolvedValue({ id: "content-1", title: PRESS_RELEASE_RESULT.headline });
  });

  it("1. the correct user (same company, manageSeoProjects role) can save", async () => {
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ id: "content-1" });
  });

  it("2. a user from another company cannot save — the job lookup is company-scoped", async () => {
    mockedRequireUser.mockResolvedValue({ id: "user-b", role: "MANAGER", companyId: COMPANY_B });
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3. a non-owned/non-existent job cannot be saved", async () => {
    mockedGetAiGenerationJob.mockResolvedValue(null);
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3b. a job for a different task type is refused, even if it belongs to this company", async () => {
    mockedGetAiGenerationJob.mockResolvedValue({ ...SUCCEEDED_JOB, taskType: "EMAIL_NEWSLETTER" });
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3c. a job that has not succeeded yet cannot be saved", async () => {
    mockedGetAiGenerationJob.mockResolvedValue({ ...SUCCEEDED_JOB, status: "RUNNING" });
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("4. a non-owned SEO project cannot be saved against", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("5. sets contentType = PRESS_RELEASE", async () => {
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.contentType).toBe("PRESS_RELEASE");
  });

  it("6. sets status = DRAFT", async () => {
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.status).toBe("DRAFT");
  });

  it("7. sets generatedByAi = true", async () => {
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.generatedByAi).toBe(true);
  });

  it("8. companyId comes from the authenticated user, never client input", async () => {
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.companyId).toBe(COMPANY_A);
  });

  it("9. clientId comes from seoProject.clientId ?? null", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, clientId: "client-42" });
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    const [{ data: withClient }] = mockedPrisma.content.create.mock.calls[0];
    expect(withClient.clientId).toBe("client-42");

    mockedPrisma.content.create.mockClear();
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, clientId: null });
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    const [{ data: withoutClient }] = mockedPrisma.content.create.mock.calls[0];
    expect(withoutClient.clientId).toBeNull();
  });

  it("10. Content.body contains the generated document", async () => {
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.body).toContain(PRESS_RELEASE_RESULT.subheadline);
    expect(data.body).toContain(PRESS_RELEASE_RESULT.dateline);
    expect(data.body).toContain(PRESS_RELEASE_RESULT.leadParagraph);
    expect(data.body).toContain(PRESS_RELEASE_RESULT.bodyParagraphs[0]);
    expect(data.body).toContain(PRESS_RELEASE_RESULT.quoteSection);
    expect(data.body).toContain(PRESS_RELEASE_RESULT.boilerplate);
    expect(data.body).toContain(PRESS_RELEASE_RESULT.callToAction);
  });

  it("11. Content.aiBriefDetails preserves the full structured press release — nothing lost in conversion", async () => {
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.aiBriefDetails).toEqual(PRESS_RELEASE_RESULT);
  });

  it("12. logs the activity", async () => {
    await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "content.ai_press_release_saved", companyId: COMPANY_A, contentId: "content-1" })
    );
  });

  it("13. the browser-supplied jobId is the only input — the actual text is re-read from the job row, never trusted from the client", async () => {
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(true);
    expect(mockedGetAiGenerationJob).toHaveBeenCalledWith(JOB_ID);
  });

  it("14. an EMPLOYEE cannot save", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("15. a job with a null result (generation succeeded but produced nothing valid) cannot be saved", async () => {
    mockedGetAiGenerationJob.mockResolvedValue({ ...SUCCEEDED_JOB, resultJson: { result: null } });
    const result = await savePressReleaseAsContentAction({ jobId: JOB_ID });
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });
});
