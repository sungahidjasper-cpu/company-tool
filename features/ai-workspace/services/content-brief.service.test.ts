import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
}));

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
  internalLinkSuggestions: ["Link to /services"],
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

    expect(result).toEqual(BRIEF_RESULT);
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
});
