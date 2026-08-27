import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/ai-workspace/services/long-form-content.service", () => ({ generateLongFormContent: vi.fn() }));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  computeInputHash: vi.fn(),
  createAiGenerationJob: vi.fn(),
  findActiveAiGenerationJob: vi.fn(),
}));
vi.mock("@/lib/jobs/ai-generation-job-runner", () => ({ runAiGenerationJob: vi.fn() }));

type MockPrisma = {
  content: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  contentRevision: { count: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  keyword: { findUnique: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  const prisma = {
    content: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}), create: vi.fn() },
    contentRevision: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: "revision-1" }) },
    sEOProject: { findUnique: vi.fn() },
    keyword: { findUnique: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockPrisma;
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: MockPrisma) => unknown)(prisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { generateLongFormContent } from "@/features/ai-workspace/services/long-form-content.service";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { LlmProviderError } from "@/lib/ai/providers/errors";
import {
  updateLongFormContentAction,
  generateLongFormFromBriefAction,
  generateLongFormFromContentAction,
  startLongFormGenerationAction,
  saveLongFormAsNewContentAction,
} from "@/features/ai-workspace/actions/long-form-content.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedGenerateLongFormContent = generateLongFormContent as unknown as ReturnType<typeof vi.fn>;
const mockedComputeInputHash = computeInputHash as unknown as ReturnType<typeof vi.fn>;
const mockedCreateAiGenerationJob = createAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedFindActiveAiGenerationJob = findActiveAiGenerationJob as unknown as ReturnType<typeof vi.fn>;
const mockedRunAiGenerationJob = runAiGenerationJob as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

const SEO_PROJECT = { id: "seo-1", name: "Project", domain: "example.com", companyId: COMPANY_A };
const KEYWORD = { id: "keyword-1", term: "storage rental", intent: "informational", seoProjectId: "seo-1" };

const VALID_BRIEF = {
  title: "How to Rent Storage",
  metaTitle: "Storage Rental Guide",
  metaDescription: "Learn how to rent storage units.",
  outline: ["Intro", "Body"],
  suggestedHeadings: ["H1", "H2"],
  internalLinkSuggestions: [],
  seoRecommendations: ["Use keywords"],
  geoAeoNotes: "notes",
  suggestedSearchIntent: "informational",
  conclusion: "",
  ctaPlacementSuggestion: "",
  externalSources: [],
  faq: [],
  keyTakeaways: [],
  schemaSuggestions: [],
  statistics: [],
  examples: [],
  sourcesReferenced: [],
};

function makeContentWithBrief(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "content-1",
    title: VALID_BRIEF.title,
    metaTitle: VALID_BRIEF.metaTitle,
    metaDescription: VALID_BRIEF.metaDescription,
    aiBriefDetails: {
      outline: VALID_BRIEF.outline,
      suggestedHeadings: VALID_BRIEF.suggestedHeadings,
      internalLinkSuggestions: VALID_BRIEF.internalLinkSuggestions,
      seoRecommendations: VALID_BRIEF.seoRecommendations,
      geoAeoNotes: VALID_BRIEF.geoAeoNotes,
      suggestedSearchIntent: VALID_BRIEF.suggestedSearchIntent,
      conclusion: VALID_BRIEF.conclusion,
      ctaPlacementSuggestion: VALID_BRIEF.ctaPlacementSuggestion,
      externalSources: VALID_BRIEF.externalSources,
      faq: VALID_BRIEF.faq,
      keyTakeaways: VALID_BRIEF.keyTakeaways,
      schemaSuggestions: VALID_BRIEF.schemaSuggestions,
      statistics: VALID_BRIEF.statistics,
      examples: VALID_BRIEF.examples,
    },
    keywords: [] as { id: string; term: string; intent: string | null }[],
    seoProject: SEO_PROJECT,
    ...overrides,
  };
}

function makeOwnedContent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "content-1",
    title: "Old Title",
    metaTitle: "Old Meta Title",
    metaDescription: "Old Meta Description",
    body: "Old body",
    aiBriefDetails: null,
    keywords: [],
    seoProject: { id: "seo-1", name: "Project", domain: "example.com", companyId: COMPANY_A },
    ...overrides,
  };
}

function makeInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    contentId: "content-1",
    title: "Old Title",
    metaTitle: "Old Meta Title",
    metaDescription: "Old Meta Description",
    body: "Old body",
    ...overrides,
  };
}

describe("updateLongFormContentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    const owned = makeOwnedContent();
    mockedPrisma.content.findUnique.mockResolvedValue(owned);
    mockedPrisma.content.update.mockResolvedValue({ id: "content-1" });
    mockedPrisma.contentRevision.count.mockResolvedValue(0);
  });

  it("denies an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await updateLongFormContentAction(makeInput());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  it("rejects when the actor's company differs from the Content's company", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeOwnedContent({ seoProject: { id: "seo-1", name: "P", domain: "d", companyId: COMPANY_B } }));
    const result = await updateLongFormContentAction(makeInput());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.update).not.toHaveBeenCalled();
  });

  describe("2. AI regeneration creates an AI_REGENERATION revision with exact pre-change values", () => {
    it("captures the pre-change title/metaTitle/metaDescription/body when the body changes", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));

      expect(mockedPrisma.contentRevision.create).toHaveBeenCalledWith({
        data: {
          contentId: "content-1",
          companyId: COMPANY_A,
          revisionNumber: 1,
          title: "Old Title",
          metaTitle: "Old Meta Title",
          metaDescription: "Old Meta Description",
          body: "Old body",
          changeSource: "AI_REGENERATION",
          createdByUserId: "user-1",
        },
      });
    });
  });

  describe("3. revision is created before the new Content values are persisted", () => {
    it("calls contentRevision.create before content.update", async () => {
      const callOrder: string[] = [];
      mockedPrisma.contentRevision.create.mockImplementation(async () => {
        callOrder.push("revision");
        return { id: "revision-1" };
      });
      mockedPrisma.content.update.mockImplementation(async () => {
        callOrder.push("update");
        return { id: "content-1" };
      });

      await updateLongFormContentAction(makeInput({ body: "New body" }));

      expect(callOrder).toEqual(["revision", "update"]);
    });
  });

  describe("4. no revision is created when tracked fields are unchanged", () => {
    it("skips the revision when title/metaTitle/metaDescription/body are all identical", async () => {
      await updateLongFormContentAction(makeInput());

      expect(mockedPrisma.contentRevision.create).not.toHaveBeenCalled();
      expect(mockedPrisma.content.update).toHaveBeenCalled();
    });

    it("creates a revision when only metaDescription changes", async () => {
      await updateLongFormContentAction(makeInput({ metaDescription: "New Meta Description" }));
      expect(mockedPrisma.contentRevision.create).toHaveBeenCalled();
    });
  });

  describe("5. revision and Content update roll back together when the mutation fails", () => {
    it("propagates a content.update failure without logging activity or returning success", async () => {
      mockedPrisma.content.update.mockRejectedValue(new Error("simulated DB failure"));

      await expect(updateLongFormContentAction(makeInput({ body: "New body" }))).rejects.toThrow("simulated DB failure");
      expect(mockedLogActivity).not.toHaveBeenCalled();
    });
  });

  describe("6. the revision uses the authenticated user's ID", () => {
    it("sets createdByUserId to actor.id", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));
      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data.createdByUserId).toBe(MANAGER.id);
    });
  });

  describe("7. the revision uses the server-authorized company ID, not client input", () => {
    it("sets companyId to actor.companyId, derived server-side via getOwnedContent — never from client input", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));
      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data.companyId).toBe(COMPANY_A);
    });
  });

  describe("8. existing Content mutation behavior remains unchanged apart from revision creation", () => {
    it("still writes exactly title/metaTitle/metaDescription/generatedByAi/body, nothing else", async () => {
      await updateLongFormContentAction(makeInput({ title: "New Title", metaTitle: "New Meta Title", metaDescription: "New Meta Description", body: "New body" }));

      expect(mockedPrisma.content.update).toHaveBeenCalledWith({
        where: { id: "content-1" },
        data: {
          title: "New Title",
          metaTitle: "New Meta Title",
          metaDescription: "New Meta Description",
          generatedByAi: true,
          body: "New body",
        },
      });
    });

    it("still logs content.ai_long_form_saved activity with the same shape as before", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));
      expect(mockedLogActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: "content.ai_long_form_saved", contentId: "content-1" })
      );
    });
  });

  describe("fields not included in ContentRevision are never captured or modified by the revision mechanism", () => {
    it("never includes status or publishedAt in the ContentRevision snapshot data", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));

      const [{ data }] = mockedPrisma.contentRevision.create.mock.calls[0];
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("publishedAt");
    });

    it("never includes status or publishedAt in the Content update's data either", async () => {
      await updateLongFormContentAction(makeInput({ body: "New body" }));

      const [{ data }] = mockedPrisma.content.update.mock.calls[0];
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("publishedAt");
    });
  });
});

describe("generateLongFormFromBriefAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
    mockedPrisma.keyword.findUnique.mockResolvedValue(KEYWORD);
    mockedGenerateLongFormContent.mockResolvedValue({ introduction: "Intro", sections: [] });
  });

  it("1. denies an EMPLOYEE without calling the AI service", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await generateLongFormFromBriefAction({ seoProjectId: "seo-1", brief: VALID_BRIEF });
    expect(result.success).toBe(false);
    expect(mockedGenerateLongFormContent).not.toHaveBeenCalled();
  });

  it("2. rejects an empty seoProjectId (context validation) without calling the AI service", async () => {
    const result = await generateLongFormFromBriefAction({ seoProjectId: "", brief: VALID_BRIEF });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Select an SEO project");
    expect(mockedGenerateLongFormContent).not.toHaveBeenCalled();
  });

  it("3. rejects a brief missing required fields, without calling the AI service", async () => {
    const invalidBrief = { ...VALID_BRIEF, title: undefined } as unknown as typeof VALID_BRIEF;
    const result = await generateLongFormFromBriefAction({ seoProjectId: "seo-1", brief: invalidBrief });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("The brief is missing required fields — regenerate it before continuing.");
    expect(mockedGenerateLongFormContent).not.toHaveBeenCalled();
  });

  it("4. rejects when the SEO project belongs to a different company, without calling the AI service", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await generateLongFormFromBriefAction({ seoProjectId: "seo-1", brief: VALID_BRIEF });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedGenerateLongFormContent).not.toHaveBeenCalled();
  });

  it("5. rejects when the given keyword does not belong to the SEO project, without calling the AI service", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue({ ...KEYWORD, seoProjectId: "seo-other" });
    const result = await generateLongFormFromBriefAction({ seoProjectId: "seo-1", keywordId: "keyword-1", brief: VALID_BRIEF });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found for this SEO project.");
    expect(mockedGenerateLongFormContent).not.toHaveBeenCalled();
  });

  it("6. generates without a keyword, passing keyword: null and the exact project/brief context", async () => {
    await generateLongFormFromBriefAction({ seoProjectId: "seo-1", brief: VALID_BRIEF });
    expect(mockedGenerateLongFormContent).toHaveBeenCalledWith({
      seoProjectId: "seo-1",
      companyId: COMPANY_A,
      seoProjectName: SEO_PROJECT.name,
      domain: SEO_PROJECT.domain,
      brief: VALID_BRIEF,
      keyword: null,
      settings: undefined,
    });
  });

  it("7. generates with a keyword, passing its term/intent exactly", async () => {
    await generateLongFormFromBriefAction({ seoProjectId: "seo-1", keywordId: "keyword-1", brief: VALID_BRIEF });
    expect(mockedGenerateLongFormContent).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: { term: KEYWORD.term, intent: KEYWORD.intent } })
    );
  });

  it("8. returns the generated article on success", async () => {
    const article = { introduction: "Intro", sections: [{ heading: "H", body: "B" }] };
    mockedGenerateLongFormContent.mockResolvedValue(article);
    const result = await generateLongFormFromBriefAction({ seoProjectId: "seo-1", brief: VALID_BRIEF });
    expect(result).toEqual({ success: true, data: article });
  });

  it("9. maps an LlmProviderError to its real, friendly description message", async () => {
    mockedGenerateLongFormContent.mockRejectedValue(new LlmProviderError("boom", "TIMEOUT", "openai"));
    const result = await generateLongFormFromBriefAction({ seoProjectId: "seo-1", brief: VALID_BRIEF });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("The request to the AI provider took too long to complete.");
    }
  });

  it("10. maps a non-LlmProviderError to the UNKNOWN error description", async () => {
    mockedGenerateLongFormContent.mockRejectedValue(new Error("something else broke"));
    const result = await generateLongFormFromBriefAction({ seoProjectId: "seo-1", brief: VALID_BRIEF });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("An unexpected error occurred while generating the AI analysis.");
    }
  });
});

describe("generateLongFormFromContentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.content.findUnique.mockResolvedValue(makeContentWithBrief());
    mockedGenerateLongFormContent.mockResolvedValue({ introduction: "Intro", sections: [] });
  });

  it("11. denies an EMPLOYEE without calling the AI service", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await generateLongFormFromContentAction("content-1");
    expect(result.success).toBe(false);
    expect(mockedGenerateLongFormContent).not.toHaveBeenCalled();
  });

  it("12. rejects when the Content row belongs to a different company, without calling the AI service", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeContentWithBrief({ seoProject: { ...SEO_PROJECT, companyId: COMPANY_B } }));
    const result = await generateLongFormFromContentAction("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Content not found.");
    expect(mockedGenerateLongFormContent).not.toHaveBeenCalled();
  });

  it("13. rejects when the Content row has no saved brief (missing aiBriefDetails)", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(makeContentWithBrief({ aiBriefDetails: null }));
    const result = await generateLongFormFromContentAction("content-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("This content has no saved brief to generate an article from.");
    expect(mockedGenerateLongFormContent).not.toHaveBeenCalled();
  });

  it("14. reconstructs the brief from the Content row and generates with keyword: null when there are no linked keywords", async () => {
    await generateLongFormFromContentAction("content-1");
    expect(mockedGenerateLongFormContent).toHaveBeenCalledWith({
      seoProjectId: SEO_PROJECT.id,
      companyId: COMPANY_A,
      seoProjectName: SEO_PROJECT.name,
      domain: SEO_PROJECT.domain,
      brief: VALID_BRIEF,
      keyword: null,
      settings: undefined,
    });
  });

  it("15. derives the keyword from the Content row's first linked keyword", async () => {
    mockedPrisma.content.findUnique.mockResolvedValue(
      makeContentWithBrief({ keywords: [{ id: "keyword-1", term: "storage rental", intent: "informational" }] })
    );
    await generateLongFormFromContentAction("content-1");
    expect(mockedGenerateLongFormContent).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: { term: "storage rental", intent: "informational" } })
    );
  });

  it("16. maps an LlmProviderError to its real, friendly description message", async () => {
    mockedGenerateLongFormContent.mockRejectedValue(new LlmProviderError("boom", "BUDGET_EXCEEDED", "openai"));
    const result = await generateLongFormFromContentAction("content-1");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("This company's configured AI budget for the current month has been reached.");
    }
  });
});

describe("startLongFormGenerationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
    mockedPrisma.keyword.findUnique.mockResolvedValue(KEYWORD);
    mockedPrisma.content.findUnique.mockResolvedValue(makeContentWithBrief());
    mockedComputeInputHash.mockReturnValue("hash-abc");
    mockedFindActiveAiGenerationJob.mockResolvedValue(null);
    mockedCreateAiGenerationJob.mockResolvedValue({ id: "job-new" });
  });

  describe("mode: fromContent", () => {
    it("17. denies an EMPLOYEE without creating a job", async () => {
      mockedRequireUser.mockResolvedValue(EMPLOYEE);
      const result = await startLongFormGenerationAction({ mode: "fromContent", contentId: "content-1" });
      expect(result.success).toBe(false);
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
      expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
    });

    it("18. rejects when the Content row belongs to a different company, without creating a job", async () => {
      mockedPrisma.content.findUnique.mockResolvedValue(makeContentWithBrief({ seoProject: { ...SEO_PROJECT, companyId: COMPANY_B } }));
      const result = await startLongFormGenerationAction({ mode: "fromContent", contentId: "content-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Content not found.");
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("19. rejects when the Content row has no saved brief, without creating a job", async () => {
      mockedPrisma.content.findUnique.mockResolvedValue(makeContentWithBrief({ aiBriefDetails: null }));
      const result = await startLongFormGenerationAction({ mode: "fromContent", contentId: "content-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("This content has no saved brief to generate an article from.");
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("20. reuses an existing active job instead of creating a duplicate", async () => {
      mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "job-existing" });
      const result = await startLongFormGenerationAction({ mode: "fromContent", contentId: "content-1" });
      expect(result).toEqual({ success: true, data: { jobId: "job-existing" } });
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
      expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
    });

    it("21. creates a new job with the exact payload and kicks off the background runner when no active job exists", async () => {
      const result = await startLongFormGenerationAction({ mode: "fromContent", contentId: "content-1" });
      expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith({
        companyId: COMPANY_A,
        seoProjectId: SEO_PROJECT.id,
        contentId: "content-1",
        taskType: "CONTENT_DRAFT",
        inputJson: { mode: "fromContent", contentId: "content-1" },
        inputHash: "hash-abc",
        createdById: MANAGER.id,
      });
      expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-new");
      expect(result).toEqual({ success: true, data: { jobId: "job-new" } });
    });
  });

  describe("mode: fromBrief", () => {
    function fromBriefInput(overrides: Partial<Record<string, unknown>> = {}) {
      return { mode: "fromBrief" as const, seoProjectId: "seo-1", brief: VALID_BRIEF, ...overrides };
    }

    it("22. rejects an empty seoProjectId, without creating a job", async () => {
      const result = await startLongFormGenerationAction(fromBriefInput({ seoProjectId: "" }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Select an SEO project");
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("23. rejects a brief missing required fields, without creating a job", async () => {
      const invalidBrief = { ...VALID_BRIEF, title: undefined } as unknown as typeof VALID_BRIEF;
      const result = await startLongFormGenerationAction(fromBriefInput({ brief: invalidBrief }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("The brief is missing required fields — regenerate it before continuing.");
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("24. rejects when the SEO project belongs to a different company, without creating a job", async () => {
      mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
      const result = await startLongFormGenerationAction(fromBriefInput());
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("SEO project not found.");
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("25. rejects when the given keyword does not belong to the SEO project, without creating a job", async () => {
      mockedPrisma.keyword.findUnique.mockResolvedValue({ ...KEYWORD, seoProjectId: "seo-other" });
      const result = await startLongFormGenerationAction(fromBriefInput({ keywordId: "keyword-1" }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Keyword not found for this SEO project.");
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
    });

    it("26. reuses an existing active job instead of creating a duplicate", async () => {
      mockedFindActiveAiGenerationJob.mockResolvedValue({ id: "job-existing" });
      const result = await startLongFormGenerationAction(fromBriefInput());
      expect(result).toEqual({ success: true, data: { jobId: "job-existing" } });
      expect(mockedCreateAiGenerationJob).not.toHaveBeenCalled();
      expect(mockedRunAiGenerationJob).not.toHaveBeenCalled();
    });

    it("27. creates a new job with the exact payload and kicks off the background runner when no active job exists", async () => {
      const result = await startLongFormGenerationAction(fromBriefInput());
      expect(mockedCreateAiGenerationJob).toHaveBeenCalledWith({
        companyId: COMPANY_A,
        seoProjectId: SEO_PROJECT.id,
        taskType: "CONTENT_DRAFT",
        inputJson: { mode: "fromBrief", seoProjectId: SEO_PROJECT.id, keywordId: undefined, brief: VALID_BRIEF, settings: undefined },
        inputHash: "hash-abc",
        createdById: MANAGER.id,
      });
      expect(mockedRunAiGenerationJob).toHaveBeenCalledWith("job-new");
      expect(result).toEqual({ success: true, data: { jobId: "job-new" } });
    });
  });
});

describe("saveLongFormAsNewContentAction", () => {
  function makeSaveInput(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      seoProjectId: "seo-1",
      title: "How to Rent Storage",
      metaTitle: "Storage Rental Guide",
      metaDescription: "Learn how to rent storage units.",
      body: "Full article body text.",
      brief: VALID_BRIEF,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(SEO_PROJECT);
    mockedPrisma.keyword.findUnique.mockResolvedValue(KEYWORD);
    mockedPrisma.content.create.mockResolvedValue({ id: "content-new", title: "How to Rent Storage" });
  });

  it("28. denies an EMPLOYEE without creating any Content row", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await saveLongFormAsNewContentAction(makeSaveInput());
    expect(result.success).toBe(false);
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("29. rejects an empty body (schema validation), without creating any Content row", async () => {
    const result = await saveLongFormAsNewContentAction(makeSaveInput({ body: "" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Article body cannot be empty");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("30. rejects when the SEO project belongs to a different company, without creating any Content row", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue({ ...SEO_PROJECT, companyId: COMPANY_B });
    const result = await saveLongFormAsNewContentAction(makeSaveInput());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("31. rejects when the given keyword does not belong to the SEO project, without creating any Content row", async () => {
    mockedPrisma.keyword.findUnique.mockResolvedValue({ ...KEYWORD, seoProjectId: "seo-other" });
    const result = await saveLongFormAsNewContentAction(makeSaveInput({ keywordId: "keyword-1" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Keyword not found for this SEO project.");
    expect(mockedPrisma.content.create).not.toHaveBeenCalled();
  });

  it("32. creates a DRAFT Content row with the exact fields, without linking a keyword when none is given", async () => {
    await saveLongFormAsNewContentAction(makeSaveInput());
    expect(mockedPrisma.content.create).toHaveBeenCalledWith({
      data: {
        seoProjectId: "seo-1",
        authorId: MANAGER.id,
        title: "How to Rent Storage",
        status: "DRAFT",
        metaTitle: "Storage Rental Guide",
        metaDescription: "Learn how to rent storage units.",
        generatedByAi: true,
        body: "Full article body text.",
        aiBriefDetails: {
          outline: VALID_BRIEF.outline,
          suggestedHeadings: VALID_BRIEF.suggestedHeadings,
          internalLinkSuggestions: VALID_BRIEF.internalLinkSuggestions,
          seoRecommendations: VALID_BRIEF.seoRecommendations,
          geoAeoNotes: VALID_BRIEF.geoAeoNotes,
          suggestedSearchIntent: VALID_BRIEF.suggestedSearchIntent,
          conclusion: VALID_BRIEF.conclusion,
          ctaPlacementSuggestion: VALID_BRIEF.ctaPlacementSuggestion,
          externalSources: VALID_BRIEF.externalSources,
          faq: VALID_BRIEF.faq,
          keyTakeaways: VALID_BRIEF.keyTakeaways,
          schemaSuggestions: VALID_BRIEF.schemaSuggestions,
          statistics: VALID_BRIEF.statistics,
          examples: VALID_BRIEF.examples,
          briefSettings: undefined,
        },
        keywords: undefined,
      },
    });
  });

  it("33. connects the given keyword when a keywordId is provided", async () => {
    await saveLongFormAsNewContentAction(makeSaveInput({ keywordId: "keyword-1" }));
    const [{ data }] = mockedPrisma.content.create.mock.calls[0];
    expect(data.keywords).toEqual({ connect: [{ id: "keyword-1" }] });
  });

  it("34. logs content.ai_long_form_saved with the exact actor/company/project/content ids", async () => {
    await saveLongFormAsNewContentAction(makeSaveInput());
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "content.ai_long_form_saved",
      companyId: COMPANY_A,
      seoProjectId: "seo-1",
      contentId: "content-new",
      metadata: { title: "How to Rent Storage" },
    });
  });

  it("35. revalidates the content list, the content detail, and the /ai dashboard", async () => {
    const { revalidatePath } = await import("next/cache");
    await saveLongFormAsNewContentAction(makeSaveInput());
    expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/content/content-new");
    expect(revalidatePath).toHaveBeenCalledWith("/ai");
  });

  it("36. returns the id of the newly created Content row", async () => {
    const result = await saveLongFormAsNewContentAction(makeSaveInput());
    expect(result).toEqual({ success: true, data: { id: "content-new" } });
  });
});
