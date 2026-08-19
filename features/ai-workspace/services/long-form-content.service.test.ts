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

  it("computes a per-section word budget from the brief's outline length and the word-count target, and states a firm floor plus a real range", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    // DEFAULT_CONTENT_BRIEF_SETTINGS.wordCount is 1500; BASE_BRIEF.outline has 3 sections -> 500 words/section, floor 375 (75%).
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("approximately 1500 words in total");
    expect(options.prompt).toContain("1395-1605 words is fine");
    expect(options.prompt).toContain("outline above has 3 sections");
    expect(options.prompt).toContain("AT LEAST 375 words");
    expect(options.prompt).toContain("up to roughly 500 words");
    expect(options.prompt).toContain("Falling far short of the target");
  });

  it("frames the word-count target as a consequence of depth, not a goal to pad toward", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("reaching it should be a natural consequence of genuine depth, not a goal pursued for its own sake");
    expect(options.prompt).toContain("if the supplied context does not support reaching the target without inventing unsupported material, prioritize accuracy and write a shorter, honest article instead");
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
    expect(options.prompt).toContain("names 2-3 specific takeaways actually made earlier in this article");
  });

  it("forbids the conclusion from introducing new facts/statistics/examples not already established in the article", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent({
      ...BASE_CTX,
      settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, conclusion: true } },
    });
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("not a restatement of the section topics/headings");
    expect(options.prompt).toContain("Do not introduce any new fact, statistic, example, or claim in the conclusion that wasn't already established earlier in the article");
  });

  it("bans generic template closing phrases in the introduction", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain('"This comprehensive guide will walk you through..."');
    expect(options.prompt).toContain('"In this article, we\'ll explore..."');
    expect(options.prompt).toContain("every sentence in the introduction should add real orientation, context, or insight, not preview the article's structure");
  });

  it("forbids inventing case studies/statistics under a heading that implies real-world specifics not present in the supplied context", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain('"Real-Life Examples", "Case Studies", "Success Stories", "Statistics", "Industry Examples"');
    expect(options.prompt).toContain("do not invent one");
    expect(options.prompt).toContain('explicitly label the illustration as hypothetical (e.g. "Consider a hypothetical scenario where...")');
    expect(options.prompt).toContain("Never invent a company name, project name, case study, outcome, statistic, percentage, revenue figure, occupancy rate, or ROI number");
    expect(options.prompt).toContain('Never use phrases like "one notable example," "a recent study," or "industry data shows"');
  });

  it("applies the shared content-quality doctrine in the system prompt (reader-first, answer-early, distinct-section value, fact/analysis/opinion distinction)", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.system).toContain("accuracy, clarity, and usefulness to the reader always outrank SEO formatting");
    expect(options.system).toContain("never turn an outline point into a visible numbered fragment");
  });

  it("requires the introduction to answer the reader's main question early, not just hook/restate the topic", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("gives the reader a clear, useful answer or orientation to their main question within the first few sentences");
  });

  it("requires sections to be developed prose, not a visible numbered fragment or a bare question-and-one-line-answer echoing the outline", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("never restate the outline point itself as a visible numbered fragment");
    expect(options.prompt).toContain("bare question-and-one-line-answer");
  });

  it("requires each FAQ answer to stand entirely on its own, and restricts tables to genuinely useful cases", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    await generateLongFormContent({
      ...BASE_CTX,
      settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, faq: true } },
    });
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("understandable entirely on its own, without requiring the reader to have read the rest of the article");
    expect(options.prompt).toContain("never add one merely to look more structured");
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

  it("strips HTML markup wrapping a section heading (Round 4 — observed live defect), leaving the underlying text", async () => {
    mockGenerate.mockResolvedValue({
      ...ARTICLE_RESULT,
      sections: [{ heading: "<b>What counts as an emergency?</b>", body: "Burst pipes and active leaks." }],
    });
    const result = await generateLongFormContent(BASE_CTX);
    expect(result.sections).toEqual([{ heading: "What counts as an emergency?", body: "Burst pipes and active leaks." }]);
  });

  it("filters a reserved-name section even when it's wrapped in HTML markup, since headings are cleaned before the reserved-section filter runs", async () => {
    mockGenerate.mockResolvedValue({
      ...ARTICLE_RESULT,
      sections: [
        { heading: "What counts as an emergency?", body: "Burst pipes and active leaks." },
        { heading: "<b>Conclusion</b>", body: "Duplicate filler conclusion." },
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
