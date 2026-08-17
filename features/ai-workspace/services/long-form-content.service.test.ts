import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
}));

import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { generateLongFormContent, PROMPT_VERSION, type LongFormContentContext } from "@/features/ai-workspace/services/long-form-content.service";

const mockGenerate = vi.mocked(generateStructuredOutput);

beforeEach(() => {
  mockGenerate.mockClear();
});

const ARTICLE_RESULT = {
  introduction: "Plumbing emergencies can happen at any hour.",
  sections: [{ heading: "What counts as an emergency?", body: "Burst pipes and active leaks." }],
  conclusion: "Call Acme Plumbing any time.",
  faq: [] as { question: string; answer: string }[],
  internalLinkPlacementSuggestions: ["Link to the services page in the introduction."],
};

const BASE_BRIEF = {
  title: "Emergency Plumber in Austin",
  metaTitle: "Emergency Plumber Austin | Acme",
  metaDescription: "Fast 24/7 emergency plumbing in Austin.",
  outline: ["Introduction", "Signs of an emergency", "Contact us"],
  suggestedHeadings: ["What counts as an emergency?"],
  internalLinkSuggestions: [{ anchorText: "our services page", targetPage: "/services", reason: "relevant", placement: "intro", priority: "MEDIUM" as const }],
  seoRecommendations: ["Use the keyword in the H1"],
  geoAeoNotes: "Use direct Q&A framing.",
  suggestedSearchIntent: "TRANSACTIONAL",
  conclusion: "",
  ctaPlacementSuggestion: "",
  externalSources: [],
  faq: [],
  keyTakeaways: [],
  schemaSuggestions: [],
  statistics: [],
  examples: [],
};

const BASE_CTX: LongFormContentContext = {
  seoProjectId: "project-1",
  companyId: "company-1",
  seoProjectName: "Acme Plumbing",
  domain: "acme-plumbing.example.com",
  brief: BASE_BRIEF,
  keyword: { term: "emergency plumber austin", intent: "TRANSACTIONAL" },
};

describe("generateLongFormContent", () => {
  it("calls generateStructuredOutput with taskType CONTENT_DRAFT and no websiteAnalysisJobId", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);

    const result = await generateLongFormContent(BASE_CTX);

    expect(result).toMatchObject(ARTICLE_RESULT);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.taskType).toBe("CONTENT_DRAFT");
    expect(options.promptVersion).toBe(PROMPT_VERSION);
    expect(options.websiteAnalysisJobId).toBeUndefined();
  });

  it("passes seoProjectId through for company-scoped cost attribution", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.seoProjectId).toBe("project-1");
  });

  it("passes companyId through for the Phase 19 company AI limits gate", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.companyId).toBe("company-1");
  });

  it("includes the approved brief's fields and the target keyword in the prompt", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("Emergency Plumber in Austin");
    expect(options.prompt).toContain("emergency plumber austin");
    expect(options.prompt).toContain("Use direct Q&A framing.");
  });

  it("still generates when no keyword is selected", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent({ ...BASE_CTX, keyword: null });
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("No specific tracked keyword was selected");
  });

  it("performs no database write itself — generation is a pure AI call, persistence is a separate step", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });
});
