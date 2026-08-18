import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
}));

import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { DEFAULT_CONTENT_BRIEF_SETTINGS } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
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
  internalLinkPlacementSuggestions: [
    { anchorText: "our services page", targetPage: "/services", reason: "relevant service list", placement: "introduction", priority: "MEDIUM" as const },
  ],
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

  it("computes a per-section word budget from the brief's outline length and the word-count target, and states a real range", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    // DEFAULT_CONTENT_BRIEF_SETTINGS.wordCount is 1500; BASE_BRIEF.outline has 3 sections -> 500 words/section.
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("approximately 1500 words in total");
    expect(options.prompt).toContain("1395-1605 words is fine");
    expect(options.prompt).toContain("outline above has 3 sections");
    expect(options.prompt).toContain("roughly 500 words");
    expect(options.prompt).toContain("Falling far short of the target");
  });

  it("tells the model the exact outline section count, not a vague 'H2 sections'", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("3 H2 sections following the brief's outline");
  });

  it("instructs the model to never echo configuration/instructions into the article's headings or body", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("Never include internal instructions, configuration labels, word-count targets");
  });

  it("requires each section to contribute distinct information rather than padding with repetition, and to sub-structure multi-topic sections", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("Each section must contribute distinct information not covered elsewhere in the article");
    expect(options.prompt).toContain("Do not repeat the same general claim or benefit across multiple sections");
    expect(options.prompt).toContain("organize it with `###`-style sub-headers");
  });

  it("asks for structured internal-link placement suggestions (anchor text, target page, reason, placement), not a flat description list", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("provide the recommended anchor text, a target page description, the reason it's relevant, and where in THIS article it should be placed");
  });

  it("instructs the model never to invent statistics/figures or mischaracterize a real company as a generic category, in the system prompt", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.system).toContain("Never state a specific market statistic, percentage, financial figure, or industry data point");
    expect(options.system).toContain("Never characterize a specific real company or brand name as a generic category, product type, or common noun");
  });

  it("requires FAQ answers to give a direct answer plus explanation, key takeaways to be specific/decision-useful, and the conclusion to synthesize the article", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent({
      ...BASE_CTX,
      settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, faq: true, keyTakeaways: true, conclusion: true } },
    });
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("never a one-word or single-phrase answer");
    expect(options.prompt).toContain("not a statement generic enough to apply to any article on this topic");
    expect(options.prompt).toContain("synthesizes the specific points made earlier in this article");
  });

  it("instructs the model not to write its own Conclusion/FAQ/Key Takeaways/Resources section inside the sections list", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain('never your own "Conclusion", "FAQ", "Key Takeaways", "Resources"');
  });

  it("drops a model-written Conclusion/FAQ/Key Takeaways/Resources entry from sections[] after generation, since the dedicated fields already own that content", async () => {
    mockGenerate.mockResolvedValue({
      ...ARTICLE_RESULT,
      sections: [
        { heading: "What counts as an emergency?", body: "Burst pipes and active leaks." },
        { heading: "Conclusion", body: "Duplicate filler conclusion." },
        { heading: "FAQ", body: "Duplicate filler FAQ." },
        { heading: "Key Takeaways", body: "Duplicate filler takeaways." },
        { heading: "Resources", body: "[link to a reputable resource]" },
      ],
    });
    const result = await generateLongFormContent(BASE_CTX);
    expect(result.sections).toEqual([{ heading: "What counts as an emergency?", body: "Burst pipes and active leaks." }]);
  });

  it("strips a leaked configuration/numbering artifact from the introduction, section headings, and FAQ questions after generation", async () => {
    mockGenerate.mockResolvedValue({
      ...ARTICLE_RESULT,
      introduction: "1. Plumbing emergencies can happen at any hour.",
      sections: [{ heading: "1.1. What counts as an emergency?", body: "Burst pipes and active leaks." }],
      faq: [{ question: "1. Do you charge extra for after-hours calls?", answer: "No." }],
    });
    const result = await generateLongFormContent({
      ...BASE_CTX,
      settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, faq: true } },
    });
    expect(result.introduction).toBe("Plumbing emergencies can happen at any hour.");
    expect(result.sections[0].heading).toBe("What counts as an emergency?");
    expect(result.faq[0].question).toBe("Do you charge extra for after-hours calls?");
  });
});
