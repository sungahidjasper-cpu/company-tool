import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
}));

import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { DEFAULT_CONTENT_BRIEF_SETTINGS } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { generateLongFormContent, PROMPT_VERSION, type LongFormContentContext } from "@/features/ai-workspace/services/long-form-content.service";
import { formatLongFormContentAsMarkdown } from "@/features/ai-workspace/schemas/long-form-content.schema";
import { computeWordCount } from "@/features/ai-workspace/services/seo-checklist.service";

const mockGenerate = vi.mocked(generateStructuredOutput);

beforeEach(() => {
  mockGenerate.mockClear();
});

/** A single word repeated N times — exactly N word-tokens under computeWordCount, so test fixtures can target exact totals without hand-counting prose. */
function wordsBody(word: string, count: number): string {
  return Array(count).fill(word).join(" ");
}

// Long enough (1500 words) that it already sits inside the default 1500-word
// target's acceptable range [1395, 1605] — Phase 4's refinement controller
// must NOT trigger for this fixture, so every pre-existing test below that
// doesn't override `sections` continues to see exactly one generateStructuredOutput call.
const ARTICLE_RESULT = {
  introduction: "Plumbing emergencies can happen at any hour.",
  sections: [{ heading: "What counts as an emergency?", body: wordsBody("burst-pipe", 1500) }],
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

  it("computes a per-section word floor from the brief's outline length and the word-count target, and states a real range without an explicit per-section ceiling", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    // DEFAULT_CONTENT_BRIEF_SETTINGS.wordCount is 1500; BASE_BRIEF.outline has 3 sections -> floor 375 (75% of 500).
    await generateLongFormContent(BASE_CTX);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.prompt).toContain("approximately 1500 words in total");
    expect(options.prompt).toContain("1395-1605 words is fine");
    expect(options.prompt).toContain("outline above has 3 sections");
    expect(options.prompt).toContain("AT LEAST 375 words");
    expect(options.prompt).toContain("There is no upper limit stated for a section");
    expect(options.prompt).toContain("Falling far short of the target");
  });

  it("Phase 3B — never states an explicit per-section word ceiling to the model, for any settings combination (the controlled-experiment regression check)", async () => {
    mockGenerate.mockResolvedValue(ARTICLE_RESULT);
    const scenarios: Array<{ label: string; ctx: LongFormContentContext }> = [
      { label: "default settings", ctx: BASE_CTX },
      { label: "8-section outline", ctx: { ...BASE_CTX, brief: { ...BASE_BRIEF, outline: Array.from({ length: 8 }, (_, i) => `Section ${i + 1}`) } } },
      { label: "2500-word target", ctx: { ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 2500 } } },
    ];
    for (const { label, ctx } of scenarios) {
      mockGenerate.mockClear();
      await generateLongFormContent(ctx);
      const [, options] = mockGenerate.mock.calls[0];
      expect(options.prompt, `scenario: ${label}`).not.toMatch(/up to roughly \d+ words/);
    }
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

describe("generateLongFormContent — Phase 4 deficit-aware length-control refinement", () => {
  function totalWords(article: { introduction: string; sections: Array<{ heading: string; body: string }>; conclusion?: string; faq: Array<{ question: string; answer: string }> }): number {
    return computeWordCount(formatLongFormContentAsMarkdown(article as Parameters<typeof formatLongFormContentAsMarkdown>[0]));
  }

  it("triggers zero additional calls when the initial article already meets the lower target boundary", async () => {
    mockGenerate.mockResolvedValueOnce(ARTICLE_RESULT); // 1520 words total, inside [1395, 1605] for the default 1500-word target
    const result = await generateLongFormContent(BASE_CTX);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(result.sections[0].body).toBe(ARTICLE_RESULT.sections[0].body); // untouched
  });

  it("triggers exactly one expansion round for a small deficit, and merges the validated expansion", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [{ heading: "Section One", body: wordsBody("alpha", 1300) }], // total 1320, deficit 75 -> 1 section selected
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 1400) }] }); // +100 words -> total 1420

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(result.sections[0].body).toBe(wordsBody("alpha", 1400));
    expect(totalWords(result)).toBeGreaterThanOrEqual(1395);
    expect(totalWords(result)).toBeLessThanOrEqual(1605);
  });

  it("performs multiple expansion rounds for a larger deficit, re-measuring before each and stopping as soon as the article enters range", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [{ heading: "Section One", body: wordsBody("alpha", 200) }], // total 220
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 500) }] }) // +300 -> total 520, still short
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 1400) }] }); // +900 -> total 1420, in range

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(mockGenerate).toHaveBeenCalledTimes(3); // 1 initial + 2 rounds, third round never attempted
    expect(totalWords(result)).toBeGreaterThanOrEqual(1395);
  });

  it("stops after exactly the hard safety cap of 3 expansion rounds when the article never enters range, and returns the best-effort result honestly", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [{ heading: "Section One", body: wordsBody("alpha", 200) }], // total 220
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 300) }] }) // +100 -> 320
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 400) }] }) // +100 -> 420
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 500) }] }); // +100 -> 520, still short

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(mockGenerate).toHaveBeenCalledTimes(4); // 1 initial + exactly 3 rounds (the hard cap) — never a 5th call
    expect(totalWords(result)).toBeLessThan(1395); // honestly still short — the cap is a safety bound, not a guarantee
  });

  it("selects the shortest sections by word count, not necessarily all of them, when a subset is sufficient", async () => {
    const lengths = [30, 40, 650, 660, 670, 680, 690, 700];
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: lengths.map((len, i) => ({ heading: `Section ${i + 1}`, body: wordsBody(`w${i}`, len) })), // total 4140
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    // total (including each section's own heading words, which also count) is 4156;
    // deficit (5000-word target, lowWords 4650) = 494 -> ceil(494/100) = 5 sections
    // selected: the 5 shortest (indices 0-4), excluding the 3 longest (indices 5-7).
    mockGenerate.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      expansions: lengths.slice(0, 5).map((len, i) => ({ heading: `Section ${i + 1}`, body: wordsBody(`w${i}`, len + 100) })),
    });

    await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 5000 } });

    const [, expansionOptions] = mockGenerate.mock.calls[1];
    for (let i = 0; i < 5; i++) expect(expansionOptions.prompt).toContain(`Heading: Section ${i + 1}`);
    expect(expansionOptions.prompt).not.toContain("Heading: Section 6");
    expect(expansionOptions.prompt).not.toContain("Heading: Section 7");
    expect(expansionOptions.prompt).not.toContain("Heading: Section 8");
  });

  it("re-ranks sections by their updated lengths before every round, rather than reusing a stale selection", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [
        { heading: "P", body: wordsBody("p", 100) },
        { heading: "Q", body: wordsBody("q", 150) },
        { heading: "R", body: wordsBody("r", 324) },
      ], // total 594 (800-word target, lowWords 744) -> deficit 150 -> 2 sections selected: P(100), Q(150), excluding R(324)
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({
        expansions: [
          { heading: "P", body: wordsBody("p", 180) }, // +80
          { heading: "Q", body: wordsBody("q", 168) }, // +18
        ],
      }) // new lengths: P=180, Q=168, R=324 (unchanged) -> total 692, still short (deficit 52) -> Q(168) is now the shortest, not P
      .mockResolvedValueOnce({ expansions: [{ heading: "Q", body: wordsBody("q", 230) }] }); // +62 -> total 754, in range

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 800 } });

    const [, round2Options] = mockGenerate.mock.calls[2];
    expect(round2Options.prompt).toContain("Heading: Q");
    expect(round2Options.prompt).not.toContain("Heading: P"); // P was round 1's pick — must not be blindly re-requested
    expect(round2Options.prompt).not.toContain("Heading: R"); // R was never the shortest — never requested at all
    expect(result.sections.find((s) => s.heading === "R")?.body).toBe(wordsBody("r", 324)); // R untouched throughout
    expect(totalWords(result)).toBeGreaterThanOrEqual(744);
  });

  it("deterministically validates every returned expansion: rejects an unexpected heading, a shorter body, and a <=15-word increase; accepts the first meaningfully-longer valid expansion; rejects a later duplicate for the same heading even if also valid", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [{ heading: "Section One", body: wordsBody("orig", 1305) }], // total 1325 (1500-word target), deficit 70
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      expansions: [
        { heading: "Nonexistent Section", body: wordsBody("x", 1400) }, // unexpected heading -> rejected
        { heading: "Section One", body: wordsBody("orig", 1300) }, // shorter than original (1305) -> rejected
        { heading: "Section One", body: wordsBody("orig", 1315) }, // +10 words, <=15 -> rejected
        { heading: "Section One", body: wordsBody("orig", 1395) }, // +90 words -> first valid, ACCEPTED
        { heading: "Section One", body: wordsBody("orig", 1600) }, // +295 words, valid but duplicate heading -> rejected
      ],
    });

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(mockGenerate).toHaveBeenCalledTimes(2); // the +90 acceptance already closes the gap — no 3rd round
    expect(result.sections).toHaveLength(1); // no new section was created from "Nonexistent Section"
    expect(result.sections[0].body).toBe(wordsBody("orig", 1395));
  });

  it("returns fewer expansions than requested without error — applies whichever valid ones came back, leaves the rest untouched", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [
        { heading: "Alpha Section", body: wordsBody("a", 600) },
        { heading: "Beta Section", body: wordsBody("b", 600) },
      ], // total 1220 (1500-word target), deficit 175 -> both selected
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    // Only Alpha Section actually returned this round — Beta Section simply omitted from the response.
    mockGenerate
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ expansions: [{ heading: "Alpha Section", body: wordsBody("a", 700) }] })
      .mockResolvedValueOnce({ expansions: [{ heading: "Beta Section", body: wordsBody("b", 700) }] });

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(result.sections.find((s) => s.heading === "Alpha Section")?.body).toBe(wordsBody("a", 700));
    expect(result.sections.find((s) => s.heading === "Beta Section")?.body).toBe(wordsBody("b", 700));
  });

  it("accepts a validated candidate whose total stays within highWords", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [{ heading: "Section One", body: wordsBody("alpha", 1300) }],
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate.mockResolvedValueOnce(initial).mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 1400) }] });

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(totalWords(result)).toBeLessThanOrEqual(1605); // never exceeds highWords
  });

  it("partially accepts a round's expansions, smallest-increase-first, when applying all of them would exceed highWords", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [
        { heading: "Alpha Section", body: wordsBody("a", 1000) },
        { heading: "Beta Section", body: wordsBody("b", 1000) },
      ], // total 2020 (2500-word target: lowWords 2325, highWords 2675), deficit 305 -> both selected
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      expansions: [
        { heading: "Alpha Section", body: wordsBody("a", 1350) }, // +350 (smaller delta)
        { heading: "Beta Section", body: wordsBody("b", 1700) }, // +700 (larger delta) — accepting both would total 3070 > 2675
      ],
    });

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 2500 } });

    expect(mockGenerate).toHaveBeenCalledTimes(2); // the partial accept alone already reaches [2325, 2675] — no further round
    expect(result.sections.find((s) => s.heading === "Alpha Section")?.body).toBe(wordsBody("a", 1350)); // smaller delta — accepted
    expect(result.sections.find((s) => s.heading === "Beta Section")?.body).toBe(wordsBody("b", 1000)); // larger delta — rejected, original kept
    expect(totalWords(result)).toBeGreaterThanOrEqual(2325);
    expect(totalWords(result)).toBeLessThanOrEqual(2675);
  });

  it("rejects a single expansion outright when it alone would push the article above highWords, and safely exhausts the round cap without ever exceeding it", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [{ heading: "Section One", body: wordsBody("alpha", 700) }], // total 720 (800-word target: lowWords 744, highWords 856)
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    // +200 words would put the total at 920, above highWords (856) — must be rejected, not merged.
    mockGenerate.mockResolvedValueOnce(initial).mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 900) }] });

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 800 } });

    expect(mockGenerate).toHaveBeenCalledTimes(4); // 1 initial + 3 rounds (hard cap) — later rounds fall through with nothing further queued
    expect(result.sections[0].body).toBe(wordsBody("alpha", 700)); // the overshoot-causing expansion was never applied
    expect(totalWords(result)).toBeLessThanOrEqual(856);
  });

  it("stops refinement and returns the last known-good article when an expansion call throws", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [{ heading: "Section One", body: wordsBody("alpha", 200) }],
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(mockGenerate).toHaveBeenCalledTimes(2); // no further attempts after the failure
    expect(result.sections[0].body).toBe(wordsBody("alpha", 200)); // unchanged — generation itself did not fail
    expect(result.introduction).toBe(initial.introduction);
  });

  it("treats a round with no valid expansions as a no-op and tries again on the next round", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [{ heading: "Section One", body: wordsBody("alpha", 200) }],
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ expansions: [{ heading: "Not A Real Section", body: wordsBody("x", 900) }] }) // entirely invalid — no-op round
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 1400) }] }); // valid — closes the gap

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(result.sections[0].body).toBe(wordsBody("alpha", 1400));
  });

  it("never modifies the introduction, conclusion, FAQ, or key takeaways across multiple refinement rounds", async () => {
    const initial = {
      introduction: "A genuinely useful introduction that answers the reader's question.",
      sections: [{ heading: "Section One", body: wordsBody("alpha", 200) }],
      conclusion: "A conclusion synthesizing the article's real takeaways.",
      faq: [{ question: "Is this covered?", answer: "Yes, directly." }],
      keyTakeaways: ["A specific, decision-useful insight."],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 500) }] })
      .mockResolvedValueOnce({ expansions: [{ heading: "Section One", body: wordsBody("alpha", 1400) }] });

    const result = await generateLongFormContent({
      ...BASE_CTX,
      settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, faq: true, keyTakeaways: true, conclusion: true } },
    });

    expect(result.introduction).toBe(initial.introduction);
    expect(result.conclusion).toBe(initial.conclusion);
    expect(result.faq).toEqual(initial.faq);
    expect(result.keyTakeaways).toEqual(initial.keyTakeaways);
  });

  it("never creates a new H2 section — the section count stays exactly the same across refinement", async () => {
    const initial = {
      introduction: wordsBody("intro", 10),
      sections: [
        { heading: "Section One", body: wordsBody("alpha", 100) },
        { heading: "Section Two", body: wordsBody("beta", 100) },
      ],
      conclusion: wordsBody("concl", 10),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      expansions: [
        { heading: "Section One", body: wordsBody("alpha", 200) },
        { heading: "A Brand New Section The Model Invented", body: wordsBody("z", 500) }, // rejected — never becomes a new section
      ],
    });

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 800 } });

    expect(result.sections).toHaveLength(2);
  });

  it("800-word target: does not trigger when the initial article already exceeds the lower boundary (the typical observed case)", async () => {
    const initial = {
      introduction: wordsBody("intro", 30),
      sections: [{ heading: "Section One", body: wordsBody("alpha", 850) }], // well above lowWords (744) for an 800-word target
      conclusion: wordsBody("concl", 30),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate.mockResolvedValueOnce(initial);

    await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 800 } });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("1500-word target: a moderate deficit is closed within the round budget", async () => {
    const initial = {
      introduction: wordsBody("intro", 60),
      sections: [
        { heading: "Section One", body: wordsBody("a", 250) },
        { heading: "Section Two", body: wordsBody("b", 250) },
      ], // total 620, deficit 775 relative to lowWords 1395
      conclusion: wordsBody("concl", 60),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    mockGenerate
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({
        expansions: [
          { heading: "Section One", body: wordsBody("a", 500) },
          { heading: "Section Two", body: wordsBody("b", 500) },
        ],
      })
      .mockResolvedValueOnce({
        expansions: [
          { heading: "Section One", body: wordsBody("a", 750) },
          { heading: "Section Two", body: wordsBody("b", 750) },
        ],
      });

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 1500 } });

    expect(mockGenerate.mock.calls.length).toBeLessThanOrEqual(4); // at most the hard cap
    expect(totalWords(result)).toBeGreaterThan(620); // measurable improvement over the initial total
  });

  it("2500-word target: a large deficit engages all sections and may still fall short of range without exceeding the round cap", async () => {
    const initial = {
      introduction: wordsBody("intro", 80),
      sections: Array.from({ length: 5 }, (_, i) => ({ heading: `Section ${i + 1}`, body: wordsBody(`s${i}`, 200) })), // total ~1160
      conclusion: wordsBody("concl", 80),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    const roundExpansion = { expansions: Array.from({ length: 5 }, (_, i) => ({ heading: `Section ${i + 1}`, body: wordsBody(`s${i}`, 300 + i * 20) })) };
    mockGenerate.mockResolvedValueOnce(initial).mockResolvedValueOnce(roundExpansion).mockResolvedValueOnce(roundExpansion).mockResolvedValueOnce(roundExpansion);

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 2500 } });

    expect(mockGenerate).toHaveBeenCalledTimes(4); // 1 initial + exactly 3 rounds — never a 5th call regardless of outcome
    expect(totalWords(result)).toBeLessThanOrEqual(2675); // never overshoots, even if still short of 2325
  });

  it("5000-word target: hits the hard safety cap and reports the honest best-effort result rather than forcing further rounds", async () => {
    const initial = {
      introduction: wordsBody("intro", 100),
      sections: Array.from({ length: 5 }, (_, i) => ({ heading: `Section ${i + 1}`, body: wordsBody(`s${i}`, 220) })), // total ~1200, far below lowWords (4650)
      conclusion: wordsBody("concl", 100),
      faq: [] as { question: string; answer: string }[],
      internalLinkPlacementSuggestions: [],
    };
    const roundExpansion = { expansions: Array.from({ length: 5 }, (_, i) => ({ heading: `Section ${i + 1}`, body: wordsBody(`s${i}`, 350) })) }; // modest, insufficient growth every round
    mockGenerate.mockResolvedValueOnce(initial).mockResolvedValueOnce(roundExpansion).mockResolvedValueOnce(roundExpansion).mockResolvedValueOnce(roundExpansion);

    const result = await generateLongFormContent({ ...BASE_CTX, settings: { ...DEFAULT_CONTENT_BRIEF_SETTINGS, wordCount: 5000 } });

    expect(mockGenerate).toHaveBeenCalledTimes(4); // hard cap respected — no 5th call chasing the 5000-word number
    expect(totalWords(result)).toBeLessThan(4650); // honestly reported as still short, per the known structural limitation
    expect(totalWords(result)).toBeGreaterThan(1300); // but a real, measurable improvement over the initial ~1300 total
    expect(result.sections).toHaveLength(5); // no new sections invented to chase the target
  });
});
