import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

vi.mock("@/features/ai-workspace/services/content-brief.service", () => ({
  PROMPT_VERSION: 6,
  CONTENT_BRIEF_SYSTEM_PROMPT: "SYSTEM_PROMPT_UNDER_TEST",
  buildPrompt: vi.fn().mockReturnValue("built prompt"),
  generateContentBrief: vi.fn(),
}));

vi.mock("@/lib/ai/structured-output", () => ({ generateStructuredOutput: vi.fn() }));

vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn().mockReturnValue("input-hash-1"),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
}));

vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));

type MockPrisma = {
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  keyword: { findUnique: ReturnType<typeof vi.fn> };
  content: { create: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    sEOProject: { findUnique: vi.fn() },
    keyword: { findUnique: vi.fn() },
    content: { create: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { buildPrompt, generateContentBrief } from "@/features/ai-workspace/services/content-brief.service";
import { generateStructuredOutput } from "@/lib/ai/structured-output";
import {
  computeInputHash,
  createAiGenerationJob,
  findActiveAiGenerationJob,
} from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { LlmProviderError } from "@/lib/ai/providers/errors";
import {
  generateContentBriefAction,
  startContentBriefGenerationAction,
  saveContentBriefAction,
  previewContentBriefPromptAction,
  regenerateBriefFieldAction,
} from "@/features/ai-workspace/actions/content-brief.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedBuildPrompt = buildPrompt as unknown as ReturnType<typeof vi.fn>;
const mockedGenerateContentBrief = generateContentBrief as unknown as ReturnType<typeof vi.fn>;
const mockedGenerateStructuredOutput = generateStructuredOutput as unknown as ReturnType<typeof vi.fn>;
const mockedComputeInputHash = computeInputHash as unknown as ReturnType<typeof vi.fn>;
const mockedCreateAiGenerationJob = createAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedFindActiveAiGenerationJob = findActiveAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedRunAiGenerationJob = runAiGenerationJob as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const SUPER_ADMIN = { id: "user-super", role: "SUPER_ADMIN", companyId: COMPANY_A };
const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT = { id: "seo-1", companyId: COMPANY_A, name: "Acme SEO", domain: "acme.test" };
const KEYWORD = { id: "kw-1", seoProjectId: "seo-1", term: "emergency plumber", intent: "transactional" };

const VALID_BRIEF_INPUT = { seoProjectId: "seo-1", contentType: "BLOG_POST" as const };

function makeBrief(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Title",
    metaTitle: "Meta Title",
    metaDescription: "Meta Description",
    outline: ["one"],
    suggestedHeadings: ["h1"],
    internalLinkSuggestions: [],
    seoRecommendations: [],
    geoAeoNotes: "",
    suggestedSearchIntent: "",
    conclusion: "",
    ctaPlacementSuggestion: "",
    externalSources: [],
    faq: [],
    keyTakeaways: [],
    schemaSuggestions: [],
    statistics: [],
    examples: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
  mockedPrisma.keyword.findUnique.mockResolvedValue(KEYWORD);
  mockedGenerateContentBrief.mockResolvedValue(makeBrief());
  mockedBuildPrompt.mockReturnValue("built prompt");
  mockedGenerateStructuredOutput.mockResolvedValue({ title: "Regenerated Title" });
  mockedComputeInputHash.mockReturnValue("input-hash-1");
  mockedFindActiveAiGenerationJob.mockResolvedValue(null);
  mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-1" });
  mockedPrisma.content.create.mockResolvedValue({ id: "content-1", title: "Title" });
});

describe("generateContentBriefAction", () => {
  it("1. rejects an EMPLOYEE — below the manageSeoProjects (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await generateContentBriefAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedGenerateContentBrief).not.toHaveBeenCalled();
  });

  it("2. succeeds for a MANAGER", async () => {
    const result = await generateContentBriefAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. rejects invalid input (missing seoProjectId) without any lookup", async () => {
    const result = await generateContentBriefAction({ contentType: "BLOG_POST" } as never);
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("4. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await generateContentBriefAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedGenerateContentBrief).not.toHaveBeenCalled();
  });

  it("5. rejects when the SEO project belongs to a different company (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await generateContentBriefAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedGenerateContentBrief).not.toHaveBeenCalled();
  });

  it("6. rejects when keywordId is given but does not belong to the SEO project", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue({ ...KEYWORD, seoProjectId: "some-other-seo-project" });
    const result = await generateContentBriefAction({ ...VALID_BRIEF_INPUT, keywordId: "kw-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found for this SEO project.");
    expect(mockedGenerateContentBrief).not.toHaveBeenCalled();
  });

  it("7. calls generateContentBrief with the server-derived companyId and no keyword when none is given", async () => {
    await generateContentBriefAction(VALID_BRIEF_INPUT);
    expect(mockedGenerateContentBrief).toHaveBeenCalledWith({
      seoProjectId: "seo-1",
      companyId: COMPANY_A,
      seoProjectName: SEO_PROJECT.name,
      domain: SEO_PROJECT.domain,
      contentType: "BLOG_POST",
      keyword: null,
      notes: undefined,
    });
  });

  it("8. resolves and passes the keyword's term/intent when keywordId is valid", async () => {
    await generateContentBriefAction({ ...VALID_BRIEF_INPUT, keywordId: "kw-1" });
    const [callArgs] = mockedGenerateContentBrief.mock.calls[0];
    expect(callArgs.keyword).toEqual({ term: KEYWORD.term, intent: KEYWORD.intent });
  });

  it("9. returns the generated brief on success", async () => {
    const brief = makeBrief({ title: "Specific Title" });
    mockedGenerateContentBrief.mockResolvedValue(brief);
    const result = await generateContentBriefAction(VALID_BRIEF_INPUT);
    expect(result).toEqual({ success: true, data: brief });
  });

  it("10. maps a thrown LlmProviderError to the real describeLlmError message for its type", async () => {
    mockedGenerateContentBrief.mockRejectedValue(new LlmProviderError("boom", "RATE_LIMIT", "gemini"));
    const result = await generateContentBriefAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe(
        "The configured AI provider is temporarily rejecting requests due to rate limiting."
      );
    }
  });

  it("11. maps a non-LlmProviderError throw to the UNKNOWN error message", async () => {
    mockedGenerateContentBrief.mockRejectedValue(new Error("something else broke"));
    const result = await generateContentBriefAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("An unexpected error occurred while generating the AI analysis.");
    }
  });
});

describe("startContentBriefGenerationAction", () => {
  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await startContentBriefGenerationAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("2. rejects invalid input", async () => {
    const result = await startContentBriefGenerationAction({} as never);
    expect(result.success).toBe(false);
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
  });

  it("3. rejects a missing/cross-company SEO project (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await startContentBriefGenerationAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("4. rejects an invalid keywordId", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(null);
    const result = await startContentBriefGenerationAction({ ...VALID_BRIEF_INPUT, keywordId: "kw-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found for this SEO project.");
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
  });

  it("5. reuses an existing active job without creating a new one or starting the runner again", async () => {
    mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "existing-job-1" });
    const result = await startContentBriefGenerationAction(VALID_BRIEF_INPUT);
    expect(result).toEqual({ success: true, data: { jobId: "existing-job-1" } });
    expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
  });

  it("6. creates a new job scoped to the actor's company when none is active, and starts the runner", async () => {
    const result = await startContentBriefGenerationAction(VALID_BRIEF_INPUT);

    expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_A,
        seoProjectId: "seo-1",
        taskType: "CONTENT_BRIEF",
        inputHash: "input-hash-1",
        createdById: MANAGER.id,
      })
    );
    expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-1");
    expect(result).toEqual({ success: true, data: { jobId: "job-1" } });
  });

  it("7. computes the input hash from the parsed (validated) input", async () => {
    await startContentBriefGenerationAction(VALID_BRIEF_INPUT);
    const [hashedInput] = mockedComputeInputHash.mock.calls[0];
    expect(hashedInput).toMatchObject({ seoProjectId: "seo-1", contentType: "BLOG_POST" });
  });
});

describe("saveContentBriefAction", () => {
  const SAVE_INPUT = { seoProjectId: "seo-1", brief: makeBrief({ title: "Saved Title" }) };

  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await saveContentBriefAction(SAVE_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("2. rejects a missing/cross-company SEO project (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await saveContentBriefAction(SAVE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("3. rejects an invalid keywordId", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(null);
    const result = await saveContentBriefAction({ ...SAVE_INPUT, keywordId: "kw-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found for this SEO project.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("4. creates a DRAFT, AI-generated Content row from the brief, connecting the keyword only when given", async () => {
    await saveContentBriefAction({ ...SAVE_INPUT, keywordId: "kw-1" });

    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.seoProjectId).toBe("seo-1");
    expect(data.authorId).toBe(MANAGER.id);
    expect(data.title).toBe("Saved Title");
    expect(data.status).toBe("DRAFT");
    expect(data.generatedByAi).toBe(true);
    expect(data.keywords).toEqual({ connect: [{ id: "kw-1" }] });
  });

  it("5. omits the keywords.connect entirely when no keywordId is given", async () => {
    await saveContentBriefAction(SAVE_INPUT);
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.keywords).toBeUndefined();
  });

  it("6. logs content.ai_brief_saved scoped to the actor/company/seoProject/content", async () => {
    mockedPrisma.content.create.mockResolvedValue({ id: "new-content-1", title: "Saved Title" });
    await saveContentBriefAction(SAVE_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.ai_brief_saved",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      contentId: "new-content-1",
      metadata: { title: "Saved Title" },
    });
  });

  it("7. returns the new content id", async () => {
    mockedPrisma.content.create.mockResolvedValue({ id: "new-content-1", title: "Saved Title" });
    const result = await saveContentBriefAction(SAVE_INPUT);
    expect(result).toEqual({ success: true, data: { id: "new-content-1" } });
  });
});

describe("previewContentBriefPromptAction", () => {
  it("1. rejects a MANAGER — this action is gated by manageCompanies (Super Admin only), not manageSeoProjects", async () => {
    const result = await previewContentBriefPromptAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/super admin/i);
    expect(mockedBuildPrompt).not.toHaveBeenCalled();
  });

  it("2. succeeds for a SUPER_ADMIN", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    const result = await previewContentBriefPromptAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. rejects invalid input", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    const result = await previewContentBriefPromptAction({} as never);
    expect(result.success).toBe(false);
    expect(mockedBuildPrompt).not.toHaveBeenCalled();
  });

  it("4. rejects a missing/cross-company SEO project (tenant isolation, even for a Super Admin)", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await previewContentBriefPromptAction(VALID_BRIEF_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
  });

  it("5. builds the prompt with the server-derived companyId and returns it", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    mockedBuildPrompt.mockReturnValue("the rendered prompt");
    const result = await previewContentBriefPromptAction(VALID_BRIEF_INPUT);

    expect(mockedBuildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ seoProjectId: "seo-1", companyId: COMPANY_A, contentType: "BLOG_POST" })
    );
    expect(result).toEqual({ success: true, data: { prompt: "the rendered prompt" } });
  });
});

describe("regenerateBriefFieldAction", () => {
  const currentBrief = makeBrief({ title: "Original Title" });
  const REGENERATE_INPUT = {
    seoProjectId: "seo-1",
    contentType: "BLOG_POST" as const,
    currentBrief,
    field: "title" as const,
  };

  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await regenerateBriefFieldAction(REGENERATE_INPUT);
    expect(result.success).toBe(false);
    expect(mockedGenerateStructuredOutput).not.toHaveBeenCalled();
  });

  it("2. rejects a missing/cross-company SEO project (tenant isolation)", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await regenerateBriefFieldAction(REGENERATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedGenerateStructuredOutput).not.toHaveBeenCalled();
  });

  it("3. rejects an invalid keywordId", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue(null);
    const result = await regenerateBriefFieldAction({ ...REGENERATE_INPUT, keywordId: "kw-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found for this SEO project.");
    expect(mockedGenerateStructuredOutput).not.toHaveBeenCalled();
  });

  it("4. calls generateStructuredOutput with the company/seoProject-scoped options and a prompt naming only the requested field", async () => {
    await regenerateBriefFieldAction(REGENERATE_INPUT);

    expect(mockedGenerateStructuredOutput).toHaveBeenCalledTimes(1);
    const [, options] = mockedGenerateStructuredOutput.mock.calls[0];
    expect(options).toMatchObject({
      system: "SYSTEM_PROMPT_UNDER_TEST",
      taskType: "CONTENT_BRIEF",
      promptVersion: 6,
      seoProjectId: "seo-1",
      companyId: COMPANY_A,
    });
    expect(options.prompt).toContain('Regenerate ONLY the "title" field');
    expect(options.prompt).toContain("Original Title");
  });

  it("5. merges the regenerated patch into the current brief and returns it", async () => {
    mockedGenerateStructuredOutput.mockResolvedValue({ title: "Regenerated Title" });
    const result = await regenerateBriefFieldAction(REGENERATE_INPUT);
    expect(result).toEqual({ success: true, data: { ...currentBrief, title: "Regenerated Title" } });
  });

  it("6. maps a thrown LlmProviderError to the real describeLlmError message for its type", async () => {
    mockedGenerateStructuredOutput.mockRejectedValue(new LlmProviderError("boom", "NOT_CONFIGURED", "gemini"));
    const result = await regenerateBriefFieldAction(REGENERATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("No AI providers are configured.");
  });
});
