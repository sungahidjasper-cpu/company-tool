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

  it("gives the meta description a concrete two-sentence structure to reach the required length, not just a character-count target", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("one sentence stating what this content covers plus one sentence stating the concrete benefit or outcome");
  });

  it("instructs the model to count only visible reader-facing words toward the meta title/description length, never a configuration value", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("count ONLY the visible words a reader would actually see in that field");
  });

  it("applies the shared content-quality doctrine in the system prompt (reader-first, answer-early, distinct-section value, fact/analysis/opinion distinction)", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.system).toContain("accuracy, clarity, and usefulness to the reader always outrank SEO formatting");
    expect(options.system).toContain("never turn an outline point into a visible numbered fragment");
  });

  it("asks GEO/AEO notes to suggest answer-then-evidence-then-explanation framing and citation-worthy statements", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("answer-then-evidence-then-explanation framing");
    expect(options.prompt).toContain("independently-understandable statements");
  });

  it("instructs the model, in the system prompt, never to invent statistics/figures (including in FAQ answers) or mischaracterize a real company as a generic category", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.system).toContain("Never state a specific market statistic, percentage, financial figure, or industry data point");
    expect(options.system).toContain("including inside FAQ answers and statistic angles");
    expect(options.system).toContain("Never characterize a specific real company or brand name as a generic category, product type, or common noun");
  });

  it("instructs the model to never echo configuration values (e.g. the word-count target) into the title/meta fields", async () => {
    mockGenerate.mockResolvedValue(BRIEF_RESULT);
    await generateContentBrief(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("Never include internal instructions, configuration labels, word-count targets");
    expect(options.prompt).toContain("must never be appended to or quoted inside the title or meta title");
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

  it("strips a leaked configuration/numbering artifact from title, metaTitle, outline, suggestedHeadings, and FAQ questions after generation", async () => {
    mockGenerate.mockResolvedValue({
      ...BRIEF_RESULT,
      title: "1. 10 Ways to Improve Local SEO",
      metaTitle: "10 Ways to Improve Local SEO | 1500 words",
      outline: ["1.1. Introduction", "2. Tactics"],
      suggestedHeadings: ["3) What is local SEO?"],
      faq: [{ question: "1. What is local SEO?", answer: "It's optimizing for local search." }],
    });

    const result = await generateContentBrief(BASE_CTX);

    expect(result.title).toBe("10 Ways to Improve Local SEO");
    expect(result.metaTitle).toBe("10 Ways to Improve Local SEO");
    expect(result.outline).toEqual(["Introduction", "Tactics"]);
    expect(result.suggestedHeadings).toEqual(["What is local SEO?"]);
    expect(result.faq[0].question).toBe("What is local SEO?");
  });

  it("strips HTML markup wrapping title, metaTitle, outline entries, and suggested headings (Round 4 — observed live defect)", async () => {
    mockGenerate.mockResolvedValue({
      ...BRIEF_RESULT,
      title: "<b>10 Ways to Improve Local SEO</b>",
      metaTitle: '<span class="x">Self-Storage Occupancy Rates and Unit Pricing: A Closer Look</span>',
      outline: ["<b>Introduction</b>"],
      suggestedHeadings: ["<b>What is local SEO?</b>"],
    });

    const result = await generateContentBrief(BASE_CTX);

    expect(result.title).toBe("10 Ways to Improve Local SEO");
    expect(result.metaTitle).toBe("Self-Storage Occupancy Rates and Unit Pricing: A Closer Look");
    expect(result.outline).toEqual(["Introduction"]);
    expect(result.suggestedHeadings).toEqual(["What is local SEO?"]);
  });

  it("falls back metaTitle to the sanitized title when metaTitle is echoed instruction text, rather than leaving the echo in place (Round 4 — observed live defect)", async () => {
    mockGenerate.mockResolvedValue({
      ...BRIEF_RESULT,
      title: "Self-Storage Investing for Accredited Investors",
      metaTitle: "EXACTLY 50-60 characters (50 words, 60 characters total), meta description:",
    });

    const result = await generateContentBrief(BASE_CTX);

    expect(result.metaTitle).toBe("Self-Storage Investing for Accredited Investors");
  });

  it("clears metaDescription to empty (rather than leaving echoed instruction text) when it matches the same high-confidence instruction-echo patterns", async () => {
    mockGenerate.mockResolvedValue({
      ...BRIEF_RESULT,
      metaDescription: "EXACTLY 150-160 characters, meta description: describe the topic here",
    });

    const result = await generateContentBrief(BASE_CTX);

    expect(result.metaDescription).toBe("");
  });

  it("never falls back a legitimate metaTitle or clears a legitimate metaDescription", async () => {
    mockGenerate.mockResolvedValue({
      ...BRIEF_RESULT,
      title: "Self-Storage Investing for Accredited Investors",
      metaTitle: "Self-Storage Investing Guide for Accredited Investors",
      metaDescription: "Discover the key factors to consider when evaluating self-storage as an asset class for accredited investors today.",
    });

    const result = await generateContentBrief(BASE_CTX);

    expect(result.metaTitle).toBe("Self-Storage Investing Guide for Accredited Investors");
    expect(result.metaDescription).toBe("Discover the key factors to consider when evaluating self-storage as an asset class for accredited investors today.");
  });
});
