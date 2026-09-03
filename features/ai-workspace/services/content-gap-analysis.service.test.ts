import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
  generateStructuredOutputStreaming: vi.fn(),
}));

import { generateStructuredOutput, generateStructuredOutputStreaming } from "@/lib/ai/structured-output";
import {
  buildContentGapAnalysisResult,
  buildPrompt,
  computeExistingCoverage,
  CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT,
  extractContentClustersFromAudit,
  extractContentGapsFromAudit,
  extractCrawledPageTitles,
  generateContentGapAnalysis,
  matchCluster,
  prepareContentGaps,
  type PreparedContentGap,
} from "@/features/ai-workspace/services/content-gap-analysis.service";

const mockGenerate = vi.mocked(generateStructuredOutput);
const mockGenerateStreaming = vi.mocked(generateStructuredOutputStreaming);

beforeEach(() => {
  mockGenerate.mockReset();
  mockGenerateStreaming.mockReset();
});

// ---------------------------------------------------------------------------
// extractContentGapsFromAudit / extractContentClustersFromAudit / extractCrawledPageTitles
// ---------------------------------------------------------------------------

describe("extractContentGapsFromAudit", () => {
  it("1. extracts valid gaps from a well-formed resultJson", () => {
    const resultJson = { audit: { contentGaps: [{ title: "FAQs", description: "Add an FAQ page.", reasoning: "Improves SEO." }] } };
    expect(extractContentGapsFromAudit(resultJson)).toEqual([{ title: "FAQs", description: "Add an FAQ page.", reasoning: "Improves SEO." }]);
  });

  it("2. returns an empty array when resultJson is null/not an object", () => {
    expect(extractContentGapsFromAudit(null)).toEqual([]);
    expect(extractContentGapsFromAudit("a string")).toEqual([]);
  });

  it("3. returns an empty array when audit is null (crawl-only job, AI enrichment failed)", () => {
    expect(extractContentGapsFromAudit({ audit: null })).toEqual([]);
  });

  it("4. returns an empty array when contentGaps is missing or not an array", () => {
    expect(extractContentGapsFromAudit({ audit: {} })).toEqual([]);
    expect(extractContentGapsFromAudit({ audit: { contentGaps: "not an array" } })).toEqual([]);
  });

  it("5. drops individual malformed gap entries without throwing (missing/wrong-typed fields)", () => {
    const resultJson = {
      audit: {
        contentGaps: [
          { title: "Valid Gap", description: "A real gap.", reasoning: "Reasoning." },
          { title: "Missing description" },
          { title: 123, description: "wrong type", reasoning: "x" },
          null,
        ],
      },
    };
    expect(extractContentGapsFromAudit(resultJson)).toEqual([{ title: "Valid Gap", description: "A real gap.", reasoning: "Reasoning." }]);
  });
});

describe("extractContentClustersFromAudit", () => {
  it("6. extracts valid clusters", () => {
    const resultJson = { audit: { keywordIntelligence: { contentClusters: [{ clusterName: "Investing", keywords: ["invest", "returns"] }] } } };
    expect(extractContentClustersFromAudit(resultJson)).toEqual([{ clusterName: "Investing", keywords: ["invest", "returns"] }]);
  });

  it("7. returns an empty array for missing/malformed keywordIntelligence", () => {
    expect(extractContentClustersFromAudit({ audit: { keywordIntelligence: null } })).toEqual([]);
    expect(extractContentClustersFromAudit({ audit: {} })).toEqual([]);
    expect(extractContentClustersFromAudit(null)).toEqual([]);
  });
});

describe("extractCrawledPageTitles", () => {
  it("8. extracts titles from well-formed crawledPages", () => {
    const resultJson = { crawledPages: [{ url: "https://a.test/", title: "Home" }, { url: "https://a.test/about", title: "About" }] };
    expect(extractCrawledPageTitles(resultJson)).toEqual(["Home", "About"]);
  });

  it("9. drops entries with a missing/empty/non-string title, never throws", () => {
    const resultJson = { crawledPages: [{ url: "https://a.test/", title: "Home" }, { url: "https://a.test/x" }, { title: "" }, null] };
    expect(extractCrawledPageTitles(resultJson)).toEqual(["Home"]);
  });

  it("10. returns an empty array when crawledPages is missing", () => {
    expect(extractCrawledPageTitles({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeExistingCoverage / matchCluster — the deterministic heuristics
// ---------------------------------------------------------------------------

/** The real 12 crawled page titles from Storage Moguls' own audit (job 01a01c02), used verbatim so these assertions reflect live data. */
const REAL_STORAGE_MOGULS_TITLES = [
  "Institutional Self-Storage Investments",
  "Self Storage Investments: Complete Guide | Storage Moguls",
  "Self Storage Investment Opportunities | Storage Moguls",
  "Self Storage Development & Acquisitions | Storage Moguls",
  "How to Buy a Self Storage Facility | Storage Moguls",
  "About Us: Self Storage Investment Firm | Storage Moguls",
  "Schedule a Consultation | Storage Moguls",
  "Self Storage Projects & Portfolio | Storage Moguls",
  "Investor Resources for Self Storage | Storage Moguls",
  "Self Storage Investing Blog | Storage Moguls",
  "What Is Self Storage Investing? | Storage Moguls",
  "Benefits of Self Storage Investments | Storage Moguls",
];

describe("computeExistingCoverage", () => {
  it("11. finds no match for a genuinely uncovered topic against the real Storage Moguls titles", () => {
    expect(computeExistingCoverage("Local Business Pages", REAL_STORAGE_MOGULS_TITLES).status).toBe("NOT_FOUND");
    expect(computeExistingCoverage("Success Stories", REAL_STORAGE_MOGULS_TITLES).status).toBe("NOT_FOUND");
  });

  it("12. live regression — an FAQ gap must NOT match the homepage on the site-wide words 'self'+'storage' alone", () => {
    expect(computeExistingCoverage("FAQs on Self-Storage Investing", REAL_STORAGE_MOGULS_TITLES).status).toBe("NOT_FOUND");
  });

  it("13. finds a match when the gap title shares substantial DISTINCTIVE overlap with an existing title", () => {
    const result = computeExistingCoverage("FAQ Page for Investing", ["Self Storage Investing FAQ Page | Storage Moguls", ...REAL_STORAGE_MOGULS_TITLES]);
    expect(result).toEqual({ status: "POSSIBLE_MATCH", matchedTitle: "Self Storage Investing FAQ Page | Storage Moguls" });
  });

  it("14. ignores existing titles with fewer than 2 significant words", () => {
    expect(computeExistingCoverage("Contact", ["Contact"]).status).toBe("NOT_FOUND");
  });

  it("15. returns NOT_FOUND when there are no existing titles at all", () => {
    expect(computeExistingCoverage("Any Topic", [])).toEqual({ status: "NOT_FOUND" });
  });

  it("16. matches on a small corpus too (the frequency filter only engages with enough titles to be meaningful)", () => {
    expect(computeExistingCoverage("Self Storage Investing", ["Self Storage Investing FAQ"])).toEqual({ status: "POSSIBLE_MATCH", matchedTitle: "Self Storage Investing FAQ" });
  });
});

describe("matchCluster", () => {
  it("16. matches the cluster with the most word overlap", () => {
    const clusters = [
      { clusterName: "Investing", keywords: ["self storage investing", "benefits of investing"] },
      { clusterName: "Market Insights", keywords: ["market trends", "cashflow and returns"] },
    ];
    expect(matchCluster("Self-Storage Investing Guide", "A guide to self storage investing.", clusters)).toBe("Investing");
  });

  it("17. returns null when no cluster shares any word", () => {
    const clusters = [{ clusterName: "Unrelated", keywords: ["completely", "different", "topic"] }];
    expect(matchCluster("Something Else Entirely", "Nothing in common here.", clusters)).toBeNull();
  });

  it("18. returns null when there are no clusters", () => {
    expect(matchCluster("Any Topic", "Any description.", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// prepareContentGaps
// ---------------------------------------------------------------------------

describe("prepareContentGaps", () => {
  it("19. cleans, enriches, and keeps a valid gap", () => {
    const prepared = prepareContentGaps([{ title: "Success Stories", description: "Case studies from investors.", reasoning: "Builds trust." }], [], []);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].title).toBe("Success Stories");
    expect(prepared[0].coverage).toEqual({ status: "NOT_FOUND" });
    expect(prepared[0].relatedCluster).toBeNull();
  });

  it("20. drops a gap that becomes empty after cleaning (malformed/whitespace-only audit data)", () => {
    const prepared = prepareContentGaps([{ title: "   ", description: "desc", reasoning: "reason" }], [], []);
    expect(prepared).toEqual([]);
  });

  it("21. strips a leaked trailing configuration artifact without dropping the gap", () => {
    const prepared = prepareContentGaps([{ title: "FAQ Page | 500 words", description: "desc", reasoning: "reason" }], [], []);
    expect(prepared[0].title).toBe("FAQ Page");
  });

  it("21b. drops a gap whose own audit text is leaked instruction/configuration content, not a real gap", () => {
    expect(prepareContentGaps([{ title: "meta description: EXACTLY 50-60 characters total", description: "desc", reasoning: "reason" }], [], [])).toEqual([]);
    expect(prepareContentGaps([{ title: "A Real Topic", description: "meta title: 50 words, 60 characters", reasoning: "reason" }], [], [])).toEqual([]);
  });

  it("21c. collapses duplicate audit gap titles to a single opportunity", () => {
    const prepared = prepareContentGaps(
      [
        { title: "Success Stories", description: "Case studies.", reasoning: "Builds trust." },
        { title: "success stories", description: "A duplicate entry.", reasoning: "Also builds trust." },
      ],
      [],
      []
    );
    expect(prepared).toHaveLength(1);
    expect(prepared[0].description).toBe("Case studies.");
  });
});

// ---------------------------------------------------------------------------
// buildPrompt — grounding/anti-fabrication assertions
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  const GAPS: PreparedContentGap[] = [
    { title: "FAQs", description: "Add an FAQ page.", reasoning: "Helps SEO.", relatedCluster: "Investing", coverage: { status: "NOT_FOUND" } },
  ];

  it("22. includes the topic, opportunity, reasoning, and coverage status", () => {
    const prompt = buildPrompt({ seoProjectName: "Storage Moguls", domain: "storagemoguls.com", gaps: GAPS });
    expect(prompt).toContain("FAQs");
    expect(prompt).toContain("Add an FAQ page.");
    expect(prompt).toContain("Helps SEO.");
    expect(prompt).toContain("no matching existing page title was found");
  });

  it("23. states the existing-coverage determination is not the model's judgment to make", () => {
    const prompt = buildPrompt({ seoProjectName: "Storage Moguls", domain: "storagemoguls.com", gaps: GAPS });
    expect(prompt).toMatch(/not your judgment to make/i);
  });

  it("24. instructs the model never to mention competitors, rankings, search volume, difficulty, or traffic", () => {
    expect(buildPrompt({ seoProjectName: "S", domain: "s.test", gaps: GAPS })).toMatch(/never mention or imply anything about competitors, search rankings, search volume, keyword difficulty, or website traffic/i);
  });
});

describe("CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT", () => {
  it("25. forbids competitor claims and unsupported SEO metrics", () => {
    expect(CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT).toMatch(/never state or imply anything about a competitor/i);
    expect(CONTENT_GAP_ANALYSIS_SYSTEM_PROMPT).toMatch(/search volume, keyword ranking, keyword difficulty, or website-traffic/i);
  });
});

// ---------------------------------------------------------------------------
// buildContentGapAnalysisResult — deterministic, reject-never-repair filter
// ---------------------------------------------------------------------------

describe("buildContentGapAnalysisResult", () => {
  const NOT_FOUND_GAP: PreparedContentGap = {
    title: "Success Stories",
    description: "Case studies from investors.",
    reasoning: "Builds trust.",
    relatedCluster: "Investing",
    coverage: { status: "NOT_FOUND" },
  };
  const MATCHED_GAP: PreparedContentGap = {
    title: "FAQs on Investing",
    description: "Add an FAQ page.",
    reasoning: "Helps SEO.",
    relatedCluster: null,
    coverage: { status: "POSSIBLE_MATCH", matchedTitle: "Investing FAQ" },
  };

  it("26. a valid classification is applied on top of the ORIGINAL topic/opportunity/reason, never the model's restatement", () => {
    const result = buildContentGapAnalysisResult([{ topic: "Success Stories", suggestedContentType: "CASE_STUDY", recommendedNextAction: "CREATE_NEW" }], [NOT_FOUND_GAP]);
    expect(result.opportunities).toEqual([
      {
        topic: "Success Stories",
        opportunity: "Case studies from investors.",
        reason: "Builds trust.",
        relatedCluster: "Investing",
        existingCoverageStatus: "NOT_FOUND",
        matchedExistingTitle: null,
        suggestedContentType: "CASE_STUDY",
        // NOT_FOUND coverage: no existing page to update, so the create-vs-update question does not apply.
        recommendedNextAction: null,
      },
    ]);
  });

  it("27. ignores an item echoing a topic that matches no known gap (never fabricates a new opportunity)", () => {
    const result = buildContentGapAnalysisResult([{ topic: "A Topic That Was Never Supplied", suggestedContentType: "ARTICLE", recommendedNextAction: "CREATE_NEW" }], [NOT_FOUND_GAP]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].topic).toBe("Success Stories");
    expect(result.opportunities[0].suggestedContentType).toBeNull();
  });

  it("28. a wrong-typed topic/classification leaves the gap present with a null classification", () => {
    expect(buildContentGapAnalysisResult([{ topic: 123, suggestedContentType: "ARTICLE", recommendedNextAction: "CREATE_NEW" }], [NOT_FOUND_GAP]).opportunities[0].suggestedContentType).toBeNull();
    expect(buildContentGapAnalysisResult([{ topic: "Success Stories", suggestedContentType: 5, recommendedNextAction: "CREATE_NEW" }], [NOT_FOUND_GAP]).opportunities[0].suggestedContentType).toBeNull();
  });

  it("29. an invalid suggestedContentType enum value becomes null — never repaired into a real one", () => {
    const result = buildContentGapAnalysisResult([{ topic: "Success Stories", suggestedContentType: "BLOG_POST", recommendedNextAction: "CREATE_NEW" }], [NOT_FOUND_GAP]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].suggestedContentType).toBeNull();
  });

  it("30. NEVER lets a model's UPDATE_EXISTING claim through when the deterministic coverage check found NOT_FOUND", () => {
    const result = buildContentGapAnalysisResult([{ topic: "Success Stories", suggestedContentType: "CASE_STUDY", recommendedNextAction: "UPDATE_EXISTING" }], [NOT_FOUND_GAP]);
    expect(result.opportunities[0].recommendedNextAction).toBeNull();
  });

  it("31. honors UPDATE_EXISTING only when the deterministic coverage check actually found a match", () => {
    const result = buildContentGapAnalysisResult([{ topic: "FAQs on Investing", suggestedContentType: "FAQ_PAGE", recommendedNextAction: "UPDATE_EXISTING" }], [MATCHED_GAP]);
    expect(result.opportunities[0]).toMatchObject({ existingCoverageStatus: "POSSIBLE_MATCH", matchedExistingTitle: "Investing FAQ", recommendedNextAction: "UPDATE_EXISTING" });
  });

  it("32. honors CREATE_NEW for a matched gap when that is what the model returned", () => {
    const result = buildContentGapAnalysisResult([{ topic: "FAQs on Investing", suggestedContentType: "FAQ_PAGE", recommendedNextAction: "CREATE_NEW" }], [MATCHED_GAP]);
    expect(result.opportunities[0].recommendedNextAction).toBe("CREATE_NEW");
  });

  it("32b. an APPLICABLE but missing next action stays null on a matched gap — distinct from the not-applicable case", () => {
    const result = buildContentGapAnalysisResult([{ topic: "FAQs on Investing", suggestedContentType: "FAQ_PAGE", recommendedNextAction: "garbage" }], [MATCHED_GAP]);
    expect(result.opportunities[0]).toMatchObject({ existingCoverageStatus: "POSSIBLE_MATCH", recommendedNextAction: null, suggestedContentType: "FAQ_PAGE" });
  });

  it("33. ignores an instruction-echo topic echo, leaving the real gap present and unclassified", () => {
    const result = buildContentGapAnalysisResult(
      [{ topic: "meta title: EXACTLY 50-60 characters total", suggestedContentType: "ARTICLE", recommendedNextAction: "CREATE_NEW" }],
      [NOT_FOUND_GAP]
    );
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].suggestedContentType).toBeNull();
  });

  it("34. a repeated topic returned twice by the model still yields exactly one opportunity (first valid echo wins)", () => {
    const result = buildContentGapAnalysisResult(
      [
        { topic: "Success Stories", suggestedContentType: "CASE_STUDY", recommendedNextAction: "CREATE_NEW" },
        { topic: "Success Stories", suggestedContentType: "ARTICLE", recommendedNextAction: "CREATE_NEW" },
      ],
      [NOT_FOUND_GAP]
    );
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].suggestedContentType).toBe("CASE_STUDY");
  });

  it("35. tolerates non-object raw items without throwing, keeping every real gap", () => {
    const result = buildContentGapAnalysisResult([null, "a string", 42], [NOT_FOUND_GAP]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].suggestedContentType).toBeNull();
  });

  it("36. WEAK-MODEL SCENARIO — an entirely empty provider response still returns every valid audit opportunity, unclassified", () => {
    const result = buildContentGapAnalysisResult([], [NOT_FOUND_GAP, MATCHED_GAP]);
    expect(result.opportunities).toHaveLength(2);
    expect(result.opportunities.map((o) => o.topic)).toEqual(["Success Stories", "FAQs on Investing"]);
    for (const opportunity of result.opportunities) {
      expect(opportunity.suggestedContentType).toBeNull();
      expect(opportunity.recommendedNextAction).toBeNull();
    }
    // The deterministic audit data survives intact regardless of the model.
    expect(result.opportunities[0]).toMatchObject({ opportunity: "Case studies from investors.", reason: "Builds trust.", relatedCluster: "Investing", existingCoverageStatus: "NOT_FOUND" });
    expect(result.opportunities[1]).toMatchObject({ existingCoverageStatus: "POSSIBLE_MATCH", matchedExistingTitle: "Investing FAQ" });
  });

  it("36b. preserves the original gap order and classifies only the items the model actually answered", () => {
    const result = buildContentGapAnalysisResult([{ topic: "FAQs on Investing", suggestedContentType: "FAQ_PAGE", recommendedNextAction: "UPDATE_EXISTING" }], [NOT_FOUND_GAP, MATCHED_GAP]);
    expect(result.opportunities.map((o) => o.topic)).toEqual(["Success Stories", "FAQs on Investing"]);
    expect(result.opportunities[0].suggestedContentType).toBeNull();
    expect(result.opportunities[1].suggestedContentType).toBe("FAQ_PAGE");
  });
});

// ---------------------------------------------------------------------------
// generateContentGapAnalysis — end-to-end with a mocked provider call
// ---------------------------------------------------------------------------

describe("generateContentGapAnalysis", () => {
  const CTX = {
    seoProjectId: "project-1",
    companyId: "company-1",
    seoProjectName: "Storage Moguls",
    domain: "https://www.storagemoguls.com/",
    gaps: [{ title: "Success Stories", description: "Case studies from investors.", reasoning: "Builds trust." }],
    contentClusters: [],
    existingTitles: [],
  };

  it("37. successful generation returns the deterministically filtered result", async () => {
    mockGenerate.mockResolvedValue({ opportunities: [{ topic: "Success Stories", suggestedContentType: "CASE_STUDY", recommendedNextAction: "CREATE_NEW" }] });
    const result = await generateContentGapAnalysis(CTX);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].topic).toBe("Success Stories");
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const [, options] = mockGenerate.mock.calls[0];
    expect(options.taskType).toBe("CONTENT_GAP_ANALYSIS");
    expect(options.companyId).toBe("company-1");
  });

  it("38. skips the AI call entirely when there are no usable gaps (empty contentGaps)", async () => {
    const result = await generateContentGapAnalysis({ ...CTX, gaps: [] });
    expect(result).toEqual({ opportunities: [] });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("39. skips the AI call when every gap becomes empty after cleaning (malformed audit data)", async () => {
    const result = await generateContentGapAnalysis({ ...CTX, gaps: [{ title: "   ", description: "x", reasoning: "y" }] });
    expect(result).toEqual({ opportunities: [] });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("40. uses the streaming path when onChunk is supplied", async () => {
    mockGenerateStreaming.mockResolvedValue({ opportunities: [] });
    const onChunk = vi.fn();
    await generateContentGapAnalysis(CTX, onChunk);
    expect(mockGenerateStreaming).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("41. a provider response with an unrecognized topic never fabricates one — the real gap survives, unclassified", async () => {
    mockGenerate.mockResolvedValue({ opportunities: [{ topic: "Something Never Supplied", suggestedContentType: "ARTICLE", recommendedNextAction: "CREATE_NEW" }] });
    const result = await generateContentGapAnalysis(CTX);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].topic).toBe("Success Stories");
    expect(result.opportunities[0].suggestedContentType).toBeNull();
  });

  it("42. WEAK-MODEL SCENARIO end-to-end — a provider returning no usable classifications still surfaces every real audit opportunity", async () => {
    mockGenerate.mockResolvedValue({ opportunities: [] });
    const result = await generateContentGapAnalysis({
      ...CTX,
      gaps: [
        { title: "Local Business Pages", description: "Location pages.", reasoning: "Improves local SEO." },
        { title: "Success Stories", description: "Case studies from investors.", reasoning: "Builds trust." },
        { title: "FAQs on Self-Storage Investing", description: "An FAQ page.", reasoning: "Addresses investor concerns." },
      ],
    });
    expect(result.opportunities).toHaveLength(3);
    expect(result.opportunities.map((o) => o.topic)).toEqual(["Local Business Pages", "Success Stories", "FAQs on Self-Storage Investing"]);
    for (const opportunity of result.opportunities) {
      expect(opportunity.suggestedContentType).toBeNull();
      expect(opportunity.recommendedNextAction).toBeNull();
      expect(opportunity.opportunity.length).toBeGreaterThan(0);
      expect(opportunity.reason.length).toBeGreaterThan(0);
    }
  });
});
