import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sEOProject: { findUnique: vi.fn() },
    keyword: { findUnique: vi.fn() },
    content: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/jobs/ai-generation-job-table", () => ({
  markAiGenerationJobRunning: vi.fn(),
  markAiGenerationJobSucceeded: vi.fn(),
  markAiGenerationJobFailed: vi.fn(),
}));
vi.mock("@/features/ai-workspace/services/content-brief.service", () => ({
  generateContentBrief: vi.fn(),
}));
vi.mock("@/features/ai-workspace/services/long-form-content.service", () => ({
  generateLongFormContent: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  markAiGenerationJobFailed,
  markAiGenerationJobRunning,
  markAiGenerationJobSucceeded,
} from "@/lib/jobs/ai-generation-job-table";
import { generateContentBrief } from "@/features/ai-workspace/services/content-brief.service";
import { generateLongFormContent } from "@/features/ai-workspace/services/long-form-content.service";
import { LlmProviderError } from "@/lib/ai/providers/errors";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";

const mockFindSeoProject = vi.mocked(prisma.sEOProject.findUnique);
const mockFindKeyword = vi.mocked(prisma.keyword.findUnique);
const mockFindContent = vi.mocked(prisma.content.findUnique);
const mockMarkRunning = vi.mocked(markAiGenerationJobRunning);
const mockMarkSucceeded = vi.mocked(markAiGenerationJobSucceeded);
const mockMarkFailed = vi.mocked(markAiGenerationJobFailed);
const mockGenerateContentBrief = vi.mocked(generateContentBrief);
const mockGenerateLongFormContent = vi.mocked(generateLongFormContent);

const SEO_PROJECT = { id: "project-1", name: "Acme SEO", domain: "acme.example" };

const BRIEF_OUTPUT = {
  title: "Best Plumbers in Austin",
  metaTitle: "Best Plumbers in Austin | Acme",
  metaDescription: "Find the best plumbers in Austin.",
  outline: ["Intro", "Services"],
  suggestedHeadings: ["Why choose us"],
  internalLinkSuggestions: [],
  seoRecommendations: [],
  geoAeoNotes: "",
  suggestedSearchIntent: "informational",
};

const ARTICLE_OUTPUT = {
  introduction: "Intro text.",
  sections: [{ heading: "Section", body: "Body text." }],
  conclusion: "Conclusion text.",
  faq: null,
  internalLinkPlacementSuggestions: [],
};

describe("runAiGenerationJob — CONTENT_BRIEF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches to generateContentBrief with the resolved SEO project and keyword, marks the job SUCCEEDED", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-1",
      taskType: "CONTENT_BRIEF",
      inputJson: { seoProjectId: "project-1", keywordId: "keyword-1", contentType: "BLOG_POST", notes: "focus on emergency calls" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindKeyword.mockResolvedValue({ term: "emergency plumber austin", intent: "COMMERCIAL" } as never);
    mockGenerateContentBrief.mockResolvedValue(BRIEF_OUTPUT as never);

    await runAiGenerationJob("job-1");

    expect(mockGenerateContentBrief).toHaveBeenCalledWith({
      seoProjectId: "project-1",
      seoProjectName: "Acme SEO",
      domain: "acme.example",
      contentType: "BLOG_POST",
      keyword: { term: "emergency plumber austin", intent: "COMMERCIAL" },
      notes: "focus on emergency calls",
    });
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-1", BRIEF_OUTPUT);
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("marks the job FAILED with the specific message when the SEO project no longer exists", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-2",
      taskType: "CONTENT_BRIEF",
      inputJson: { seoProjectId: "missing-project", contentType: "BLOG_POST" },
    } as never);
    mockFindSeoProject.mockResolvedValue(null);

    await runAiGenerationJob("job-2");

    expect(mockGenerateContentBrief).not.toHaveBeenCalled();
    expect(mockMarkSucceeded).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-2", "SEO project not found.", "UNKNOWN");
  });

  it("classifies a real LlmProviderError with describeLlmError's friendly message, not the raw error text", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-3",
      taskType: "CONTENT_BRIEF",
      inputJson: { seoProjectId: "project-1", contentType: "BLOG_POST" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockGenerateContentBrief.mockRejectedValue(new LlmProviderError("quota exhausted", "INSUFFICIENT_CREDITS", "gemini"));

    await runAiGenerationJob("job-3");

    expect(mockMarkFailed).toHaveBeenCalledWith(
      "job-3",
      "The configured AI provider account has run out of credits or hit its spending limit.",
      "INSUFFICIENT_CREDITS"
    );
  });

  it("rejects an invalid inputJson shape without ever calling generateContentBrief", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-4",
      taskType: "CONTENT_BRIEF",
      inputJson: { seoProjectId: "" },
    } as never);

    await runAiGenerationJob("job-4");

    expect(mockGenerateContentBrief).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-4", expect.any(String), "UNKNOWN");
  });
});

describe("runAiGenerationJob — CONTENT_DRAFT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fromBrief mode dispatches to generateLongFormContent with the brief carried in inputJson", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-5",
      taskType: "CONTENT_DRAFT",
      inputJson: { mode: "fromBrief", seoProjectId: "project-1", brief: BRIEF_OUTPUT },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockGenerateLongFormContent.mockResolvedValue(ARTICLE_OUTPUT as never);

    await runAiGenerationJob("job-5");

    expect(mockGenerateLongFormContent).toHaveBeenCalledWith({
      seoProjectId: "project-1",
      seoProjectName: "Acme SEO",
      domain: "acme.example",
      brief: BRIEF_OUTPUT,
      keyword: null,
    });
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-5", ARTICLE_OUTPUT);
  });

  it("fromContent mode rebuilds the brief from the Content row and dispatches to generateLongFormContent", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-6",
      taskType: "CONTENT_DRAFT",
      inputJson: { mode: "fromContent", contentId: "content-1" },
    } as never);
    mockFindContent.mockResolvedValue({
      title: BRIEF_OUTPUT.title,
      metaTitle: BRIEF_OUTPUT.metaTitle,
      metaDescription: BRIEF_OUTPUT.metaDescription,
      aiBriefDetails: {
        outline: BRIEF_OUTPUT.outline,
        suggestedHeadings: BRIEF_OUTPUT.suggestedHeadings,
        internalLinkSuggestions: BRIEF_OUTPUT.internalLinkSuggestions,
        seoRecommendations: BRIEF_OUTPUT.seoRecommendations,
        geoAeoNotes: BRIEF_OUTPUT.geoAeoNotes,
        suggestedSearchIntent: BRIEF_OUTPUT.suggestedSearchIntent,
      },
      seoProject: SEO_PROJECT,
      keywords: [{ term: "emergency plumber austin", intent: "COMMERCIAL" }],
    } as never);
    mockGenerateLongFormContent.mockResolvedValue(ARTICLE_OUTPUT as never);

    await runAiGenerationJob("job-6");

    expect(mockGenerateLongFormContent).toHaveBeenCalledWith({
      seoProjectId: "project-1",
      seoProjectName: "Acme SEO",
      domain: "acme.example",
      brief: BRIEF_OUTPUT,
      keyword: { term: "emergency plumber austin", intent: "COMMERCIAL" },
    });
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-6", ARTICLE_OUTPUT);
  });

  it("fromContent mode fails with a specific message when the Content row has no saved brief", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-7",
      taskType: "CONTENT_DRAFT",
      inputJson: { mode: "fromContent", contentId: "content-2" },
    } as never);
    mockFindContent.mockResolvedValue({
      title: "Untitled",
      metaTitle: null,
      metaDescription: null,
      aiBriefDetails: null,
      seoProject: SEO_PROJECT,
      keywords: [],
    } as never);

    await runAiGenerationJob("job-7");

    expect(mockGenerateLongFormContent).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-7", "This content has no saved brief to generate an article from.", "UNKNOWN");
  });
});
