import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sEOProject: { findUnique: vi.fn() },
    keyword: { findUnique: vi.fn() },
    content: { findUnique: vi.fn(), findMany: vi.fn() },
    websiteAnalysisJob: { findUnique: vi.fn() },
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
vi.mock("@/features/ai-workspace/services/meta-tag-optimizer.service", () => ({
  generateMetaTagSuggestions: vi.fn(),
}));
vi.mock("@/features/ai-workspace/services/content-rewriter.service", () => ({
  generateContentRewrite: vi.fn(),
}));
vi.mock("@/features/ai-workspace/services/press-release-generator.service", () => ({
  generatePressRelease: vi.fn(),
}));
/**
 * Only the AI call is mocked here. The audit extractors stay REAL, so these
 * tests exercise the dispatcher's actual reading of WebsiteAnalysisJob.resultJson
 * (the part unique to this tool) rather than a stubbed stand-in for it.
 */
vi.mock("@/features/ai-workspace/services/content-gap-analysis.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai-workspace/services/content-gap-analysis.service")>()),
  generateContentGapAnalysis: vi.fn(),
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
import { generateMetaTagSuggestions } from "@/features/ai-workspace/services/meta-tag-optimizer.service";
import { generateContentRewrite } from "@/features/ai-workspace/services/content-rewriter.service";
import { generatePressRelease } from "@/features/ai-workspace/services/press-release-generator.service";
import { generateContentGapAnalysis } from "@/features/ai-workspace/services/content-gap-analysis.service";
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
const mockGenerateMetaTagSuggestions = vi.mocked(generateMetaTagSuggestions);
const mockGenerateContentRewrite = vi.mocked(generateContentRewrite);
const mockGeneratePressRelease = vi.mocked(generatePressRelease);
const mockGenerateContentGapAnalysis = vi.mocked(generateContentGapAnalysis);
const mockFindWebsiteAnalysisJob = vi.mocked(prisma.websiteAnalysisJob.findUnique);
const mockFindManyContent = vi.mocked(prisma.content.findMany);
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

describe("runAiGenerationJob — META_TAG_OPTIMIZATION", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SEO_PROJECT_UUID = "00000000-0000-4000-8000-0000000000f0";
  const MISSING_SEO_PROJECT_UUID = "00000000-0000-4000-8000-0000000000ff";
  const CONTENT_ID_1 = "00000000-0000-4000-8000-000000000001";
  const CONTENT_ID_2 = "00000000-0000-4000-8000-000000000002";
  const CONTENT_ROW_1 = { id: CONTENT_ID_1, title: "Emergency Plumbing Guide", url: "https://acme.example/emergency", metaTitle: "Old Title A", metaDescription: "Old description A." };
  const CONTENT_ROW_2 = { id: CONTENT_ID_2, title: "Water Heater Repair", url: null, metaTitle: null, metaDescription: null };
  const SUGGESTIONS = [
    { contentId: CONTENT_ID_1, url: CONTENT_ROW_1.url, currentMetaTitle: CONTENT_ROW_1.metaTitle, suggestedMetaTitle: "New Title A", currentMetaDescription: CONTENT_ROW_1.metaDescription, suggestedMetaDescription: "New description A.", reasoning: "Clearer and more specific.", titleLengthGuidance: { length: 11, min: 50, max: 60, status: "TOO_SHORT" }, descriptionLengthGuidance: { length: 20, min: 120, max: 160, status: "TOO_SHORT" } },
  ];

  it("dispatches to generateMetaTagSuggestions with the resolved SEO project and a server-built inventory from the selected Content rows, marks the job SUCCEEDED", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-21",
      taskType: "META_TAG_OPTIMIZATION",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentIds: [CONTENT_ID_1, CONTENT_ID_2] },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindManyContent.mockResolvedValue([CONTENT_ROW_1, CONTENT_ROW_2] as never);
    mockGenerateMetaTagSuggestions.mockResolvedValue(SUGGESTIONS as never);

    await runAiGenerationJob("job-21");

    expect(mockGenerateMetaTagSuggestions).toHaveBeenCalledWith(
      {
        seoProjectId: "project-1",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        inventory: [
          { contentId: CONTENT_ID_1, title: CONTENT_ROW_1.title, url: CONTENT_ROW_1.url, currentMetaTitle: CONTENT_ROW_1.metaTitle, currentMetaDescription: CONTENT_ROW_1.metaDescription },
          { contentId: CONTENT_ID_2, title: CONTENT_ROW_2.title, url: null, currentMetaTitle: null, currentMetaDescription: null },
        ],
      },
      undefined
    );
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-21", { suggestions: SUGGESTIONS });
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("does NOT update Content and does NOT create a ContentRevision — the dispatcher's only prisma calls are the read-only SEO project and Content lookups", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-22",
      taskType: "META_TAG_OPTIMIZATION",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentIds: [CONTENT_ID_1] },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindManyContent.mockResolvedValue([CONTENT_ROW_1] as never);
    mockGenerateMetaTagSuggestions.mockResolvedValue([] as never);

    await runAiGenerationJob("job-22");

    // The mocked prisma client in this file exposes only read methods
    // (findUnique/findMany) for sEOProject/content — there is no
    // content.update or contentRevision mock at all, so a real write
    // attempted here would throw "not a function", not silently succeed.
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-22", { suggestions: [] });
  });

  it("marks the job FAILED with a specific message when none of the selected Content rows exist", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-23",
      taskType: "META_TAG_OPTIMIZATION",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentIds: [CONTENT_ID_1] },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindManyContent.mockResolvedValue([] as never);

    await runAiGenerationJob("job-23");

    expect(mockGenerateMetaTagSuggestions).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-23", "Content not found.", "UNKNOWN");
  });

  it("marks the job FAILED with a specific message when the SEO project no longer exists", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-24",
      taskType: "META_TAG_OPTIMIZATION",
      inputJson: { seoProjectId: MISSING_SEO_PROJECT_UUID, contentIds: [CONTENT_ID_1] },
    } as never);
    mockFindSeoProject.mockResolvedValue(null);

    await runAiGenerationJob("job-24");

    expect(mockGenerateMetaTagSuggestions).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-24", "SEO project not found.", "UNKNOWN");
  });

  it("rejects an invalid inputJson shape (empty contentIds) without ever calling generateMetaTagSuggestions", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-25",
      taskType: "META_TAG_OPTIMIZATION",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentIds: [] },
    } as never);

    await runAiGenerationJob("job-25");

    expect(mockGenerateMetaTagSuggestions).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-25", expect.any(String), "UNKNOWN");
  });

  it("rejects an invalid inputJson shape (malformed content id) without ever calling generateMetaTagSuggestions", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-26",
      taskType: "META_TAG_OPTIMIZATION",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentIds: ["not-a-uuid"] },
    } as never);

    await runAiGenerationJob("job-26");

    expect(mockGenerateMetaTagSuggestions).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-26", expect.any(String), "UNKNOWN");
  });

  it("builds the inventory only from Content rows the database actually returns — never trusting job.inputJson's ids as already-safe metadata", async () => {
    // Only one of the two requested ids resolves to a real row (e.g. the
    // other was deleted between job creation and job execution) — the
    // dispatcher must proceed with whatever real rows exist, never invent
    // a placeholder inventory entry for the missing one.
    mockMarkRunning.mockResolvedValue({
      id: "job-27",
      taskType: "META_TAG_OPTIMIZATION",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentIds: [CONTENT_ID_1, CONTENT_ID_2] },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindManyContent.mockResolvedValue([CONTENT_ROW_1] as never);
    mockGenerateMetaTagSuggestions.mockResolvedValue([] as never);

    await runAiGenerationJob("job-27");

    const [passedCtx] = mockGenerateMetaTagSuggestions.mock.calls[0];
    expect(passedCtx.inventory).toEqual([{ contentId: CONTENT_ID_1, title: CONTENT_ROW_1.title, url: CONTENT_ROW_1.url, currentMetaTitle: CONTENT_ROW_1.metaTitle, currentMetaDescription: CONTENT_ROW_1.metaDescription }]);
  });
});

describe("runAiGenerationJob — CONTENT_REWRITE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SEO_PROJECT_UUID = "00000000-0000-4000-8000-0000000000f0";
  const MISSING_SEO_PROJECT_UUID = "00000000-0000-4000-8000-0000000000ff";
  const OTHER_SEO_PROJECT_UUID = "00000000-0000-4000-8000-0000000000fe";
  const CONTENT_ID = "00000000-0000-4000-8000-000000000001";
  /** The dispatcher cross-checks content.seoProjectId against the resolved project's own id, so — unlike the other describe blocks above, whose dispatchers never make that comparison — this project's id must actually equal CONTENT_ROW.seoProjectId below. */
  const SEO_PROJECT_FOR_REWRITE = { ...SEO_PROJECT, id: SEO_PROJECT_UUID };
  const CONTENT_ROW = {
    id: CONTENT_ID,
    seoProjectId: SEO_PROJECT_UUID,
    title: "Emergency Plumbing Guide",
    metaTitle: "Old Meta Title",
    metaDescription: "Old meta description.",
    body: "## Introduction\n\nReal article body text.",
  };
  const REWRITE_RESULT = {
    contentId: CONTENT_ID,
    currentTitle: CONTENT_ROW.title,
    rewrittenTitle: "Emergency Plumbing Guide for Austin Homeowners",
    titleChanged: true,
    currentMetaTitle: CONTENT_ROW.metaTitle,
    rewrittenMetaTitle: "24/7 Emergency Plumbing | Acme",
    metaTitleChanged: true,
    currentMetaDescription: CONTENT_ROW.metaDescription,
    rewrittenMetaDescription: "Fast, licensed 24/7 emergency plumbing repair across Austin.",
    metaDescriptionChanged: true,
    currentBody: CONTENT_ROW.body,
    rewrittenBody: "## Introduction\n\nAcme Plumbing provides round-the-clock emergency repair.",
    bodyChanged: true,
    reasoning: "Clarified the audience and tightened the introduction.",
  };

  it("re-fetches the Content row fresh from the database and dispatches to generateContentRewrite with only authoritative values, marks the job SUCCEEDED", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-30",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentId: CONTENT_ID },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT_FOR_REWRITE as never);
    mockFindContent.mockResolvedValue(CONTENT_ROW as never);
    mockGenerateContentRewrite.mockResolvedValue(REWRITE_RESULT as never);

    await runAiGenerationJob("job-30");

    expect(mockGenerateContentRewrite).toHaveBeenCalledWith(
      {
        contentId: CONTENT_ID,
        seoProjectId: SEO_PROJECT_UUID,
        companyId: "company-9",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        currentTitle: CONTENT_ROW.title,
        currentMetaTitle: CONTENT_ROW.metaTitle,
        currentMetaDescription: CONTENT_ROW.metaDescription,
        currentBody: CONTENT_ROW.body,
      },
      undefined
    );
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-30", { result: REWRITE_RESULT });
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("does NOT update Content and does NOT create a ContentRevision — the dispatcher's only prisma calls are the read-only SEO project and Content lookups", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-31",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentId: CONTENT_ID },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT_FOR_REWRITE as never);
    mockFindContent.mockResolvedValue(CONTENT_ROW as never);
    mockGenerateContentRewrite.mockResolvedValue(null as never);

    await runAiGenerationJob("job-31");

    // The mocked prisma client in this file exposes only read methods
    // (findUnique/findMany) for sEOProject/content — there is no
    // content.update or contentRevision mock at all, so a real write
    // attempted here would throw "not a function", not silently succeed.
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-31", { result: null });
  });

  it("marks the job FAILED with a specific message when the SEO project no longer exists", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-32",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: MISSING_SEO_PROJECT_UUID, contentId: CONTENT_ID },
    } as never);
    mockFindSeoProject.mockResolvedValue(null);

    await runAiGenerationJob("job-32");

    expect(mockGenerateContentRewrite).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-32", "SEO project not found.", "UNKNOWN");
  });

  it("marks the job FAILED when the content id does not exist at all", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-33",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentId: CONTENT_ID },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT_FOR_REWRITE as never);
    mockFindContent.mockResolvedValue(null);

    await runAiGenerationJob("job-33");

    expect(mockGenerateContentRewrite).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-33", "Content not found.", "UNKNOWN");
  });

  it("marks the job FAILED (re-validating ownership) when the fetched Content row belongs to a different SEO project than inputJson named", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-34",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentId: CONTENT_ID },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT_FOR_REWRITE as never);
    mockFindContent.mockResolvedValue({ ...CONTENT_ROW, seoProjectId: OTHER_SEO_PROJECT_UUID } as never);

    await runAiGenerationJob("job-34");

    expect(mockGenerateContentRewrite).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-34", "Content not found.", "UNKNOWN");
  });

  it("marks the job FAILED (re-checking body eligibility) when the fetched Content row has a null body", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-35",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentId: CONTENT_ID },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT_FOR_REWRITE as never);
    mockFindContent.mockResolvedValue({ ...CONTENT_ROW, body: null } as never);

    await runAiGenerationJob("job-35");

    expect(mockGenerateContentRewrite).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-35", "This page has no body text to rewrite.", "UNKNOWN");
  });

  it("marks the job FAILED (re-checking body eligibility) when the fetched Content row has a whitespace-only body", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-36",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentId: CONTENT_ID },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT_FOR_REWRITE as never);
    mockFindContent.mockResolvedValue({ ...CONTENT_ROW, body: "   " } as never);

    await runAiGenerationJob("job-36");

    expect(mockGenerateContentRewrite).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-36", "This page has no body text to rewrite.", "UNKNOWN");
  });

  it("rejects an invalid inputJson shape (malformed contentId) without ever calling generateContentRewrite — re-validates job input, never trusts the stored shape", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-37",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, contentId: "not-a-uuid" },
    } as never);

    await runAiGenerationJob("job-37");

    expect(mockGenerateContentRewrite).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-37", expect.any(String), "UNKNOWN");
  });

  it("rejects an invalid inputJson shape (missing contentId) without ever calling generateContentRewrite", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-38",
      taskType: "CONTENT_REWRITE",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID },
    } as never);

    await runAiGenerationJob("job-38");

    expect(mockGenerateContentRewrite).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-38", expect.any(String), "UNKNOWN");
  });
});

describe("runAiGenerationJob — PRESS_RELEASE_GENERATION", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SEO_PROJECT_UUID = "00000000-0000-4000-8000-0000000000f0";
  const MISSING_SEO_PROJECT_UUID = "00000000-0000-4000-8000-0000000000ff";
  const RELEASE_RESULT = {
    headline: "Acme Launches New Product",
    subheadline: "Available starting next month",
    dateline: "",
    leadParagraph: "Acme today announced a new product.",
    bodyParagraphs: ["The product will be available in March."],
    quoteSection: "",
    boilerplate: "Acme is a plumbing company.",
    callToAction: "",
    reasoning: "Structured as a standard launch announcement.",
  };

  it("re-fetches the SEO project fresh from the database and dispatches to generatePressRelease with only authoritative values, marks the job SUCCEEDED", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-40",
      taskType: "PRESS_RELEASE_GENERATION",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, headline: "Acme Launches New Product", keyFacts: "Acme is launching a new product line." },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockGeneratePressRelease.mockResolvedValue(RELEASE_RESULT as never);

    await runAiGenerationJob("job-40");

    expect(mockGeneratePressRelease).toHaveBeenCalledWith(
      {
        seoProjectId: "project-1",
        companyId: "company-9",
        seoProjectName: "Acme SEO",
        domain: "acme.example",
        headline: "Acme Launches New Product",
        keyFacts: "Acme is launching a new product line.",
        quote: undefined,
        dateline: undefined,
        callToAction: undefined,
        notes: undefined,
      },
      undefined
    );
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-40", { result: RELEASE_RESULT });
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("passes through optional quote/dateline/callToAction/notes when present in inputJson", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-41",
      taskType: "PRESS_RELEASE_GENERATION",
      companyId: "company-9",
      inputJson: {
        seoProjectId: SEO_PROJECT_UUID,
        headline: "Acme Launches New Product",
        keyFacts: "Acme is launching a new product line.",
        quote: '"Great news" - Jane Doe',
        dateline: "Austin, TX",
        callToAction: "Visit acme.example.com",
        notes: "Keep it concise.",
      },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockGeneratePressRelease.mockResolvedValue(RELEASE_RESULT as never);

    await runAiGenerationJob("job-41");

    const [passedCtx] = mockGeneratePressRelease.mock.calls[0];
    expect(passedCtx.quote).toBe('"Great news" - Jane Doe');
    expect(passedCtx.dateline).toBe("Austin, TX");
    expect(passedCtx.callToAction).toBe("Visit acme.example.com");
    expect(passedCtx.notes).toBe("Keep it concise.");
  });

  it("does NOT touch Content or ContentRevision — no such mock exists at all, so a real attempt would throw, not silently succeed", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-42",
      taskType: "PRESS_RELEASE_GENERATION",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, headline: "Acme Launches New Product", keyFacts: "Acme is launching a new product line." },
    } as never);
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockGeneratePressRelease.mockResolvedValue(null as never);

    await runAiGenerationJob("job-42");

    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-42", { result: null });
  });

  it("marks the job FAILED with a specific message when the SEO project no longer exists", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-43",
      taskType: "PRESS_RELEASE_GENERATION",
      companyId: "company-9",
      inputJson: { seoProjectId: MISSING_SEO_PROJECT_UUID, headline: "Acme Launches New Product", keyFacts: "Acme is launching a new product line." },
    } as never);
    mockFindSeoProject.mockResolvedValue(null);

    await runAiGenerationJob("job-43");

    expect(mockGeneratePressRelease).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-43", "SEO project not found.", "UNKNOWN");
  });

  it("rejects an invalid inputJson shape (missing headline) without ever calling generatePressRelease — re-validates job input, never trusts the stored shape", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-44",
      taskType: "PRESS_RELEASE_GENERATION",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, keyFacts: "Acme is launching a new product line." },
    } as never);

    await runAiGenerationJob("job-44");

    expect(mockGeneratePressRelease).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-44", expect.any(String), "UNKNOWN");
  });

  it("rejects an invalid inputJson shape (missing keyFacts) without ever calling generatePressRelease", async () => {
    mockMarkRunning.mockResolvedValue({
      id: "job-45",
      taskType: "PRESS_RELEASE_GENERATION",
      companyId: "company-9",
      inputJson: { seoProjectId: SEO_PROJECT_UUID, headline: "Acme Launches New Product" },
    } as never);

    await runAiGenerationJob("job-45");

    expect(mockGeneratePressRelease).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-45", expect.any(String), "UNKNOWN");
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

/**
 * Phase B B2 — CONTENT_GAP_ANALYSIS was the only AI Workspace task type with
 * no dispatcher coverage here, while all eight peers had 4-10 cases each.
 * These pin down the behaviour unique to this dispatcher: it resolves a SECOND
 * row (WebsiteAnalysisJob) beyond the SEO project, re-verifies that row belongs
 * to the project, reads gap/cluster/crawled-page data out of an untyped Json
 * column, and reads Content strictly for the coverage cross-reference.
 */
describe("runAiGenerationJob — CONTENT_GAP_ANALYSIS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const SEO_PROJECT_UUID = "00000000-0000-4000-8000-0000000000f0";
  const WAJ_UUID = "00000000-0000-4000-8000-0000000000a1";

  const AUDIT_RESULT_JSON = {
    crawledPages: [
      { url: "https://acme.example/", title: "Acme Home" },
      { url: "https://acme.example/about", title: "About Acme" },
    ],
    audit: {
      contentGaps: [{ title: "Success Stories", description: "Case studies from customers.", reasoning: "Builds trust." }],
      keywordIntelligence: {
        contentClusters: [{ clusterName: "Customer Proof", keywords: ["case studies", "testimonials"] }],
      },
    },
  };

  const GAP_RESULT = {
    opportunities: [
      {
        topic: "Success Stories",
        opportunity: "Case studies from customers.",
        reason: "Builds trust.",
        relatedCluster: "Customer Proof",
        existingCoverageStatus: "NOT_FOUND",
        matchedExistingTitle: null,
        suggestedContentType: "CASE_STUDY",
        recommendedNextAction: null,
      },
    ],
  };

  function runningJob(id: string, inputJson: unknown) {
    mockMarkRunning.mockResolvedValue({ id, taskType: "CONTENT_GAP_ANALYSIS", companyId: "company-9", inputJson } as never);
  }

  function auditRow(overrides: Record<string, unknown> = {}) {
    return { id: WAJ_UUID, seoProjectId: "project-1", resultJson: AUDIT_RESULT_JSON, ...overrides } as never;
  }

  it("dispatches CONTENT_GAP_ANALYSIS to the gap-analysis handler and marks the job SUCCEEDED with the wrapped result", async () => {
    runningJob("job-gap-1", { seoProjectId: SEO_PROJECT_UUID, websiteAnalysisJobId: WAJ_UUID });
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindWebsiteAnalysisJob.mockResolvedValue(auditRow());
    mockFindManyContent.mockResolvedValue([{ title: "An Existing Page" }] as never);
    mockGenerateContentGapAnalysis.mockResolvedValue(GAP_RESULT as never);

    await runAiGenerationJob("job-gap-1");

    expect(mockGenerateContentGapAnalysis).toHaveBeenCalledTimes(1);
    expect(mockMarkSucceeded).toHaveBeenCalledWith("job-gap-1", { result: GAP_RESULT });
    expect(mockMarkFailed).not.toHaveBeenCalled();
    // Isolation: no other tool's service is engaged by this task type.
    expect(mockGeneratePressRelease).not.toHaveBeenCalled();
    expect(mockGenerateSchemaMarkup).not.toHaveBeenCalled();
    expect(mockGenerateContentBrief).not.toHaveBeenCalled();
  });

  it("passes only authoritative values — name/domain from the re-fetched project, companyId from the job, never from inputJson", async () => {
    runningJob("job-gap-2", {
      seoProjectId: SEO_PROJECT_UUID,
      websiteAnalysisJobId: WAJ_UUID,
      seoProjectName: "SPOOFED NAME",
      domain: "spoofed.example",
      companyId: "spoofed-company",
    });
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindWebsiteAnalysisJob.mockResolvedValue(auditRow());
    mockFindManyContent.mockResolvedValue([] as never);
    mockGenerateContentGapAnalysis.mockResolvedValue(GAP_RESULT as never);

    await runAiGenerationJob("job-gap-2");

    const [ctx] = mockGenerateContentGapAnalysis.mock.calls[0];
    expect(ctx.seoProjectId).toBe("project-1");
    expect(ctx.seoProjectName).toBe("Acme SEO");
    expect(ctx.domain).toBe("acme.example");
    expect(ctx.companyId).toBe("company-9");
  });

  it("extracts gaps, clusters and crawled-page titles from the audit Json and combines them with Content titles", async () => {
    runningJob("job-gap-3", { seoProjectId: SEO_PROJECT_UUID, websiteAnalysisJobId: WAJ_UUID });
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindWebsiteAnalysisJob.mockResolvedValue(auditRow());
    mockFindManyContent.mockResolvedValue([{ title: "An Existing Page" }] as never);
    mockGenerateContentGapAnalysis.mockResolvedValue(GAP_RESULT as never);

    await runAiGenerationJob("job-gap-3");

    const [ctx] = mockGenerateContentGapAnalysis.mock.calls[0];
    expect(ctx.gaps).toEqual([{ title: "Success Stories", description: "Case studies from customers.", reasoning: "Builds trust." }]);
    expect(ctx.contentClusters).toEqual([{ clusterName: "Customer Proof", keywords: ["case studies", "testimonials"] }]);
    expect(ctx.existingTitles).toEqual(["An Existing Page", "Acme Home", "About Acme"]);
  });

  it("reads Content strictly for the coverage cross-reference — project-scoped, excluding soft-deleted rows, titles only", async () => {
    runningJob("job-gap-4", { seoProjectId: SEO_PROJECT_UUID, websiteAnalysisJobId: WAJ_UUID });
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindWebsiteAnalysisJob.mockResolvedValue(auditRow());
    mockFindManyContent.mockResolvedValue([] as never);
    mockGenerateContentGapAnalysis.mockResolvedValue(GAP_RESULT as never);

    await runAiGenerationJob("job-gap-4");

    expect(mockFindManyContent).toHaveBeenCalledWith({
      where: { seoProjectId: "project-1", deletedAt: null },
      select: { title: true },
    });
  });

  it("fails the job when the website analysis belongs to a different SEO project (re-verified, never trusted from inputJson)", async () => {
    runningJob("job-gap-5", { seoProjectId: SEO_PROJECT_UUID, websiteAnalysisJobId: WAJ_UUID });
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindWebsiteAnalysisJob.mockResolvedValue(auditRow({ seoProjectId: "some-other-project" }));

    await runAiGenerationJob("job-gap-5");

    expect(mockGenerateContentGapAnalysis).not.toHaveBeenCalled();
    expect(mockMarkSucceeded).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-gap-5", expect.stringMatching(/website analysis/i), "UNKNOWN");
  });

  it("fails the job when the website analysis row no longer exists", async () => {
    runningJob("job-gap-6", { seoProjectId: SEO_PROJECT_UUID, websiteAnalysisJobId: WAJ_UUID });
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindWebsiteAnalysisJob.mockResolvedValue(null as never);

    await runAiGenerationJob("job-gap-6");

    expect(mockGenerateContentGapAnalysis).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-gap-6", expect.stringMatching(/website analysis/i), "UNKNOWN");
  });

  it("fails the job when the audit carries no content-gap data, without calling the AI", async () => {
    runningJob("job-gap-7", { seoProjectId: SEO_PROJECT_UUID, websiteAnalysisJobId: WAJ_UUID });
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindWebsiteAnalysisJob.mockResolvedValue(auditRow({ resultJson: { audit: null } }));

    await runAiGenerationJob("job-gap-7");

    expect(mockGenerateContentGapAnalysis).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-gap-7", expect.stringMatching(/content-gap data/i), "UNKNOWN");
  });

  it("fails the job on a malformed inputJson without touching the database", async () => {
    runningJob("job-gap-8", { seoProjectId: "not-a-uuid" });

    await runAiGenerationJob("job-gap-8");

    expect(mockFindSeoProject).not.toHaveBeenCalled();
    expect(mockGenerateContentGapAnalysis).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-gap-8", expect.any(String), "UNKNOWN");
  });

  it("maps a provider failure to the job's real error type rather than UNKNOWN", async () => {
    runningJob("job-gap-9", { seoProjectId: SEO_PROJECT_UUID, websiteAnalysisJobId: WAJ_UUID });
    mockFindSeoProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindWebsiteAnalysisJob.mockResolvedValue(auditRow());
    mockFindManyContent.mockResolvedValue([] as never);
    mockGenerateContentGapAnalysis.mockRejectedValue(new LlmProviderError("took too long", "TIMEOUT", "ollama"));

    await runAiGenerationJob("job-gap-9");

    expect(mockMarkSucceeded).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-gap-9", expect.any(String), "TIMEOUT");
  });
});
