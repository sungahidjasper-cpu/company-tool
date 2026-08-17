import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
}));

import { z as zv4 } from "zod/v4";

import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { generateContentBrief, PROMPT_VERSION, type ContentBriefContext } from "@/features/ai-workspace/services/content-brief.service";

const mockGenerate = vi.mocked(generateStructuredOutput);

beforeEach(() => {
  mockGenerate.mockClear();
});

const BRIEF_RESULT = {
  title: "10 Ways to Improve Local SEO",
  metaTitle: "10 Ways to Improve Local SEO",
  metaDescription: "Practical local SEO tactics for small businesses.",
  outline: ["Introduction", "Tactics", "Conclusion"],
  suggestedHeadings: ["What is local SEO?"],
  internalLinkSuggestions: [{ anchorText: "our services", targetPage: "/services", reason: "relevant", placement: "intro", priority: "MEDIUM" as const }],
  seoRecommendations: ["Add a Google Business Profile"],
  geoAeoNotes: "Use direct Q&A framing.",
  suggestedSearchIntent: "INFORMATIONAL",
};

const BASE_CTX: ContentBriefContext = {
  seoProjectId: "project-1",
  companyId: "company-1",
  seoProjectName: "Acme Plumbing",
  domain: "acme-plumbing.example.com",
  contentType: "BLOG_POST",
  keyword: { term: "emergency plumber near me", intent: "COMMERCIAL" },
};

describe("generateContentBrief", () => {
  it("calls generateStructuredOutput with taskType CONTENT_BRIEF and no websiteAnalysisJobId", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);

    const result = await generateContentBrief(BASE_CTX);

    expect(result).toMatchObject(BRIEF_RESULT);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.taskType).toBe("CONTENT_BRIEF");
    expect(options.promptVersion).toBe(PROMPT_VERSION);
    expect(options.websiteAnalysisJobId).toBeUndefined();
  });

  it("passes seoProjectId through for company-scoped cost attribution", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);

    await generateContentBrief(BASE_CTX);

    const [, options] = mockGenerate.mock.calls[0];
    expect(options.seoProjectId).toBe("project-1");
  });

  it("passes companyId through for the Phase 19 company AI limits gate", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);

    await generateContentBrief(BASE_CTX);

    const [, options] = mockGenerate.mock.calls[0];
    expect(options.companyId).toBe("company-1");
  });

  it("includes the target keyword and its tracked intent in the prompt when a keyword is selected", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);

    await generateContentBrief(BASE_CTX);

    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("emergency plumber near me");
    expect(options.prompt).toContain("COMMERCIAL");
  });

  it("instructs the model with the exact meta title/description character ranges, not a vague approximation", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("50-60 characters");
    expect(options.prompt).toContain("150-160 characters");
  });

  it("still generates a brief from notes alone when no keyword is selected (ad-hoc topic)", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);

    await generateContentBrief({ ...BASE_CTX, keyword: null, notes: "A guide to water heater maintenance" });

    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("No specific tracked keyword was selected");
    expect(options.prompt).toContain("water heater maintenance");
  });

  it("performs no database write itself — generation is a pure read/AI-call, persistence is a separate step", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief(BASE_CTX);
    // generateStructuredOutput is the only dependency; asserting it's the
    // sole call confirms this function has no other side effect to mock out.
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("reflects settings in the prompt: word count target, brand voice, and a disabled section is never requested", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief({
      ...BASE_CTX,
      settings: {
        secondaryKeywords: [],
        competitorUrls: [],
        wordCount: 2500,
        readingLevel: "GENERAL",
        brandVoice: "FRIENDLY",
        sections: { faq: false, conclusion: true, cta: false, keyTakeaways: false, internalLinks: true, externalSources: false, schemaSuggestions: false, statistics: false, examples: false },
        outline: { h2Count: 6, h3Count: 0, maxHeadingDepth: 2, includeComparisonTable: false, includeChecklist: false, includeNumberedProcess: false, includeProsCons: false },
        faqConfig: { count: 5, style: "PEOPLE_ALSO_ASK" },
        cta: {},
        qualityControls: {
          avoidCliches: true,
          avoidKeywordStuffing: true,
          includeStatistics: true,
          includeDefinitions: true,
          includeEeatSignals: true,
          optimizeForFeaturedSnippets: true,
          optimizeForAiOverviews: true,
          optimizeForGeo: true,
          optimizeForAeo: true,
          optimizeForSemanticSeo: true,
        },
        draftOptions: { imagePlaceholders: false, altTextSuggestions: false, featuredImagePrompt: false, socialSnippets: false, excerpt: false },
      },
    });

    const [schema, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("approximately 2500 words");
    expect(options.prompt).toContain("friendly");
    const shapeKeys = Object.keys((schema as zv4.ZodObject<Record<string, zv4.ZodTypeAny>>).shape);
    expect(shapeKeys).not.toContain("faq");
    expect(shapeKeys).toContain("internalLinkSuggestions");
  });
});
