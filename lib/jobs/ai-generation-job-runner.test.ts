import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  updateAiGenerationJobPartialText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/ai-workspace/services/content-brief.service", () => ({
  generateContentBrief: vi.fn(),
}));
vi.mock("@/features/ai-workspace/services/long-form-content.service", () => ({
  generateLongFormContent: vi.fn(),
}));
vi.mock("@/features/ai-workspace/services/schema-markup-generator.service", () => ({
  generateSchemaMarkupRecommendations: vi.fn(),
}));
vi.mock("@/features/ai-workspace/services/internal-link-analyzer.service", () => ({
  generateInternalLinkRecommendations: vi.fn(),
}));
vi.mock("@/features/ai-workspace/services/social-snippet-generator.service", () => ({
  generateSocialSnippets: vi.fn(),
}));
vi.mock("@/features/seo/services/content.service", () => ({
  listContentInventoryForProject: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  markAiGenerationJobFailed,
  markAiGenerationJobRunning,
  markAiGenerationJobSucceeded,
  updateAiGenerationJobPartialText,
} from "@/lib/jobs/ai-generation-job-table";
import { generateContentBrief } from "@/features/ai-workspace/services/content-brief.service";
import { generateLongFormContent } from "@/features/ai-workspace/services/long-form-content.service";
import { generateSchemaMarkupRecommendations } from "@/features/ai-workspace/services/schema-markup-generator.service";
import { generateInternalLinkRecommendations } from "@/features/ai-workspace/services/internal-link-analyzer.service";
import { generateSocialSnippets } from "@/features/ai-workspace/services/social-snippet-generator.service";
import { listContentInventoryForProject } from "@/features/seo/services/content.service";
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
const mockGenerateSchemaMarkup = vi.mocked(generateSchemaMarkupRecommendations);
const mockGenerateInternalLinks = vi.mocked(generateInternalLinkRecommendations);
const mockGenerateSocialSnippets = vi.mocked(generateSocialSnippets);
const mockListContentInventory = vi.mocked(listContentInventoryForProject);
const mockUpdatePartialText = vi.mocked(updateAiGenerationJobPartialText);

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

/** BRIEF_OUTPUT as it comes back out of contentBriefOutputSchema's own parse — Phase 21's modular fields default to "" / [] when absent from the raw stored/carried value. */
const BRIEF_OUTPUT_CANONICAL = {
  ...BRIEF_OUTPUT,
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

const ARTICLE_OUTPUT = {
  introduction: "Intro text.",
  sections: [{ heading: "Section", body: "Body text." }],
  conclusion: "Conclusion text.",
  faq: [],
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

    expect(mockGenerateContentBrief).toHaveBeenCalledWith(
      {
        seoProjectId: "project-1",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        contentType: "BLOG_POST",
        keyword: { term: "emergency plumber austin", intent: "COMMERCIAL" },
        notes: "focus on emergency calls",
        settings: undefined,
      },
      undefined
    );
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

    expect(mockGenerateLongFormContent).toHaveBeenCalledWith(
      {
        seoProjectId: "project-1",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        brief: BRIEF_OUTPUT_CANONICAL,
        keyword: null,
        settings: undefined,
      },
      undefined
    );
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

    expect(mockGenerateLongFormContent).toHaveBeenCalledWith(
      {
        seoProjectId: "project-1",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        brief: BRIEF_OUTPUT_CANONICAL,
        keyword: { term: "emergency plumber austin", intent: "COMMERCIAL" },
        settings: undefined,
      },
      undefined
    );
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

describe("runAiGenerationJob — SCHEMA_MARKUP_GENERATION", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SCHEMA_MARKUP_RESULT = { recommendations: [{ schemaType: "LocalBusiness", reasoning: "Local service business.", exampleJsonLd: "{}" }] };

  it("dispatches to generateSchemaMarkupRecommendations with the resolved SEO project and no content, marks the job SUCCEEDED", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-9",
      taskType: "SCHEMA_MARKUP_GENERATION",
      inputJson: { seoProjectId: "project-1" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockGenerateSchemaMarkup.mockResolvedValue(SCHEMA_MARKUP_RESULT as never);

    await runAiGenerationJob("job-9");

    expect(mockGenerateSchemaMarkup).toHaveBeenCalledWith(
      {
        seoProjectId: "project-1",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        content: null,
        notes: undefined,
      },
      undefined
    );
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-9", SCHEMA_MARKUP_RESULT);
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("fetches and passes the target Content row's title/metaDescription/url when contentId is supplied", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-10",
      taskType: "SCHEMA_MARKUP_GENERATION",
      inputJson: { seoProjectId: "project-1", contentId: "content-1" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindContent.mockResolvedValue({ title: "Emergency Plumbing", metaDescription: "24/7 service.", url: "https://acme.example/emergency" } as never);
    mockGenerateSchemaMarkup.mockResolvedValue(SCHEMA_MARKUP_RESULT as never);

    await runAiGenerationJob("job-10");

    expect(mockGenerateSchemaMarkup).toHaveBeenCalledWith(
      expect.objectContaining({ content: { title: "Emergency Plumbing", metaDescription: "24/7 service.", url: "https://acme.example/emergency" } }),
      undefined
    );
  });

  it("marks the job FAILED with a specific message when the referenced Content row no longer exists", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-11",
      taskType: "SCHEMA_MARKUP_GENERATION",
      inputJson: { seoProjectId: "project-1", contentId: "missing-content" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindContent.mockResolvedValue(null);

    await runAiGenerationJob("job-11");

    expect(mockGenerateSchemaMarkup).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-11", "Content not found.", "UNKNOWN");
  });

  it("rejects an invalid inputJson shape without ever calling generateSchemaMarkupRecommendations", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-12",
      taskType: "SCHEMA_MARKUP_GENERATION",
      inputJson: { seoProjectId: "" },
    } as never);

    await runAiGenerationJob("job-12");

    expect(mockGenerateSchemaMarkup).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-12", expect.any(String), "UNKNOWN");
  });
});

describe("runAiGenerationJob — INTERNAL_LINK_ANALYSIS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SOURCE_CONTENT = { title: "Emergency Plumbing Guide", url: "https://acme.example/emergency", metaDescription: "24/7 tips.", body: "Shut off the main valve." };
  const INVENTORY = [
    { id: "content-2", title: "Our Services", url: "https://acme.example/services" },
    { id: "content-1", title: "Emergency Plumbing Guide", url: "https://acme.example/emergency" },
  ];
  const RECOMMENDATIONS = [{ anchorText: "our services", targetPage: "https://acme.example/services", reason: "Directly related.", placement: "intro", priority: "HIGH" }];

  it("dispatches to generateInternalLinkRecommendations with the resolved SEO project, source content, and an inventory excluding the source page itself", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-13",
      taskType: "INTERNAL_LINK_ANALYSIS",
      inputJson: { seoProjectId: "project-1", contentId: "content-1" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindContent.mockResolvedValue(SOURCE_CONTENT as never);
    mockListContentInventory.mockResolvedValue(INVENTORY as never);
    mockGenerateInternalLinks.mockResolvedValue(RECOMMENDATIONS as never);

    await runAiGenerationJob("job-13");

    expect(mockGenerateInternalLinks).toHaveBeenCalledWith(
      {
        seoProjectId: "project-1",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        sourceContent: SOURCE_CONTENT,
        inventory: [{ title: "Our Services", url: "https://acme.example/services" }],
      },
      undefined
    );
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-13", { recommendations: RECOMMENDATIONS });
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("excludes inventory pages with no url from the supplied inventory", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-14",
      taskType: "INTERNAL_LINK_ANALYSIS",
      inputJson: { seoProjectId: "project-1", contentId: "content-1" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindContent.mockResolvedValue(SOURCE_CONTENT as never);
    mockListContentInventory.mockResolvedValue([...INVENTORY, { id: "content-3", title: "Draft With No URL", url: null }] as never);
    mockGenerateInternalLinks.mockResolvedValue([] as never);

    await runAiGenerationJob("job-14");

    const [passedCtx] = mockGenerateInternalLinks.mock.calls[0];
    expect(passedCtx.inventory).toEqual([{ title: "Our Services", url: "https://acme.example/services" }]);
  });

  it("marks the job FAILED with a specific message when the source Content row no longer exists", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-15",
      taskType: "INTERNAL_LINK_ANALYSIS",
      inputJson: { seoProjectId: "project-1", contentId: "missing-content" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindContent.mockResolvedValue(null);

    await runAiGenerationJob("job-15");

    expect(mockGenerateInternalLinks).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-15", "Content not found.", "UNKNOWN");
  });

  it("rejects an invalid inputJson shape (missing contentId) without ever calling generateInternalLinkRecommendations", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-16",
      taskType: "INTERNAL_LINK_ANALYSIS",
      inputJson: { seoProjectId: "project-1" },
    } as never);

    await runAiGenerationJob("job-16");

    expect(mockGenerateInternalLinks).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-16", expect.any(String), "UNKNOWN");
  });
});

describe("runAiGenerationJob — SOCIAL_SNIPPET_GENERATION", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SOURCE_CONTENT = { title: "Emergency Plumbing Guide", url: "https://acme.example/emergency", metaDescription: "24/7 tips.", body: "Shut off the main valve." };
  const SNIPPETS = [{ platform: "X", text: "Burst pipe? Here's what to do.", characterCount: 31 }];

  it("dispatches to generateSocialSnippets with the resolved SEO project, source content, platforms, and notes, marks the job SUCCEEDED", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-17",
      taskType: "SOCIAL_SNIPPET_GENERATION",
      inputJson: { seoProjectId: "project-1", contentId: "content-1", platforms: ["X", "LINKEDIN"], notes: "keep it upbeat" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindContent.mockResolvedValue(SOURCE_CONTENT as never);
    mockGenerateSocialSnippets.mockResolvedValue(SNIPPETS as never);

    await runAiGenerationJob("job-17");

    expect(mockGenerateSocialSnippets).toHaveBeenCalledWith(
      {
        seoProjectId: "project-1",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        sourceContent: SOURCE_CONTENT,
        platforms: ["X", "LINKEDIN"],
        notes: "keep it upbeat",
      },
      undefined
    );
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-17", { snippets: SNIPPETS });
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("marks the job FAILED with a specific message when the source Content row no longer exists", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-18",
      taskType: "SOCIAL_SNIPPET_GENERATION",
      inputJson: { seoProjectId: "project-1", contentId: "missing-content", platforms: ["X"] },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindContent.mockResolvedValue(null);

    await runAiGenerationJob("job-18");

    expect(mockGenerateSocialSnippets).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-18", "Content not found.", "UNKNOWN");
  });

  it("rejects an invalid inputJson shape (empty platforms) without ever calling generateSocialSnippets", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-19",
      taskType: "SOCIAL_SNIPPET_GENERATION",
      inputJson: { seoProjectId: "project-1", contentId: "content-1", platforms: [] },
    } as never);

    await runAiGenerationJob("job-19");

    expect(mockGenerateSocialSnippets).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-19", expect.any(String), "UNKNOWN");
  });

  it("rejects an invalid platform value without ever calling generateSocialSnippets", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-20",
      taskType: "SOCIAL_SNIPPET_GENERATION",
      inputJson: { seoProjectId: "project-1", contentId: "content-1", platforms: ["INSTAGRAM"] },
    } as never);

    await runAiGenerationJob("job-20");

    expect(mockGenerateSocialSnippets).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-20", expect.any(String), "UNKNOWN");
  });
});

/**
 * Phase 22 — the runner's onChunk wiring. generateContentBrief/generateLongFormContent
 * are still fully mocked; these tests only verify what the runner does with
 * whatever onChunk it's handed and how the AI_STREAMING_ENABLED flag gates it.
 */
describe("runAiGenerationJob — Phase 22 streaming wiring", () => {
  const originalFlag = process.env.AI_STREAMING_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkRunning.mockResolvedValue({
      id: "job-8",
      taskType: "CONTENT_BRIEF",
      inputJson: { seoProjectId: "project-1", contentType: "BLOG_POST" },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockGenerateContentBrief.mockResolvedValue(BRIEF_OUTPUT as never);
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AI_STREAMING_ENABLED;
    else process.env.AI_STREAMING_ENABLED = originalFlag;
  });

  it("passes onChunk as undefined and never writes partial text when the flag is off", async () => {
    delete process.env.AI_STREAMING_ENABLED;

    await runAiGenerationJob("job-8");

    expect(mockGenerateContentBrief).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(mockUpdatePartialText).not.toHaveBeenCalled();
  });

  it("writes accumulating text to the job row when the flag is on", async () => {
    process.env.AI_STREAMING_ENABLED = "true";
    mockGenerateContentBrief.mockImplementation(async (_ctx, onChunk) => {
      onChunk?.({ type: "text", text: '{"title":"Hello' });
      return BRIEF_OUTPUT as never;
    });

    await runAiGenerationJob("job-8");

    expect(mockUpdatePartialText).toHaveBeenCalledWith("job-8", '{"title":"Hello', expect.any(Number));
  });

  it("writes null immediately on a reset event, not subject to the same throttle as text events", async () => {
    process.env.AI_STREAMING_ENABLED = "true";
    mockGenerateContentBrief.mockImplementation(async (_ctx, onChunk) => {
      onChunk?.({ type: "text", text: "first attempt output" });
      onChunk?.({ type: "reset" });
      return BRIEF_OUTPUT as never;
    });

    await runAiGenerationJob("job-8");

    expect(mockUpdatePartialText).toHaveBeenCalledWith("job-8", null);
  });

  it("throttles rapid text events rather than writing on every single one", async () => {
    process.env.AI_STREAMING_ENABLED = "true";
    vi.useFakeTimers();
    try {
      mockGenerateContentBrief.mockImplementation(async (_ctx, onChunk) => {
        onChunk?.({ type: "text", text: "a" });
        onChunk?.({ type: "text", text: "ab" });
        onChunk?.({ type: "text", text: "abc" });
        return BRIEF_OUTPUT as never;
      });

      await runAiGenerationJob("job-8");

      // All three chunks arrive within the same instant — only the first should have written.
      expect(mockUpdatePartialText).toHaveBeenCalledTimes(1);
      expect(mockUpdatePartialText).toHaveBeenCalledWith("job-8", "a", expect.any(Number));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a failed partial-text write affect the job's own success", async () => {
    process.env.AI_STREAMING_ENABLED = "true";
    mockUpdatePartialText.mockRejectedValueOnce(new Error("db hiccup"));
    mockGenerateContentBrief.mockImplementation(async (_ctx, onChunk) => {
      onChunk?.({ type: "text", text: "some output" });
      return BRIEF_OUTPUT as never;
    });

    await runAiGenerationJob("job-8");

    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-8", BRIEF_OUTPUT);
  });
});
