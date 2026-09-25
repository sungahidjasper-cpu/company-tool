import { describe, expect, it } from "vitest";

import {
  buildCompetitorAnalysisResult,
  buildPrompt,
  COMPETITOR_CONTENT_ANALYSIS_SYSTEM_PROMPT,
  normalizeCompetitorFormat,
  normalizeCompetitorIntent,
  type CompetitorCrawlEvidence,
} from "@/features/ai-workspace/services/competitor-content-analysis.service";

/**
 * The eleventh AI Workspace tool.
 *
 * The governing rule is that observation and inference stay separate. The only
 * competitor facts that exist are the pages the crawler actually fetched, so
 * the tests that matter most are the ones proving the model cannot introduce a
 * page, a URL, or a metric of its own.
 */

const EVIDENCE: CompetitorCrawlEvidence[] = [
  {
    origin: "https://competitor.com",
    source: "USER",
    robotsTxtFound: true,
    warnings: [],
    pages: [
      {
        url: "https://competitor.com/storage-guide",
        title: "The Self Storage Investing Guide",
        metaDescription: "How to invest in self storage.",
        headings: ["Why self storage", "How to evaluate a facility"],
        bodyText: "Self storage investing basics and evaluation criteria.",
      },
      {
        url: "https://competitor.com/pricing",
        title: "Pricing",
        metaDescription: null,
        headings: ["Plans"],
        bodyText: "Our plans and pricing tiers.",
      },
    ],
  },
];

const CTX = {
  evidence: EVIDENCE,
  existingTitles: ["Unlocking Self Storage Investments: Key Insights"],
  keywordTerms: ["self storage investments"],
};

function providerOutput(overrides: Record<string, unknown> = {}) {
  return {
    pageAnalyses: [
      {
        url: "https://competitor.com/storage-guide",
        observedTopic: "A beginner guide to self storage investing.",
        format: "GUIDE",
        searchIntent: "INFORMATIONAL",
        keyCoverage: ["Evaluation criteria", "Why self storage"],
      },
    ],
    opportunities: [
      {
        topic: "How to evaluate a storage facility",
        whyItMatters: "The competitor covers evaluation and your site does not.",
        suggestedContentType: "ARTICLE",
        recommendedAction: "Write a practical evaluation checklist.",
      },
    ],
    ...overrides,
  };
}

describe("buildCompetitorAnalysisResult — observation comes from the crawl", () => {
  it("1. every page in the result comes from the crawl evidence, with its real url and title", () => {
    const result = buildCompetitorAnalysisResult(providerOutput(), CTX);
    expect(result.competitors).toHaveLength(1);
    expect(result.competitors[0].pages.map((p) => p.url)).toEqual([
      "https://competitor.com/storage-guide",
      "https://competitor.com/pricing",
    ]);
    expect(result.competitors[0].pages[0].title).toBe("The Self Storage Investing Guide");
  });

  it("2. crawler facts are carried through verbatim — page count, robots.txt, warnings", () => {
    const withWarnings = [{ ...EVIDENCE[0], warnings: ["No sitemap found — falling back to the homepage only."] }];
    const result = buildCompetitorAnalysisResult(providerOutput(), { ...CTX, evidence: withWarnings });
    expect(result.competitors[0].pagesAnalyzed).toBe(2);
    expect(result.competitors[0].robotsTxtFound).toBe(true);
    expect(result.competitors[0].warnings).toEqual(["No sitemap found — falling back to the homepage only."]);
  });

  it("3. the URL SOURCE is preserved so user-supplied and Brand Profile URLs stay distinguishable", () => {
    const fromBrand = [{ ...EVIDENCE[0], source: "BRAND_PROFILE" as const }];
    expect(buildCompetitorAnalysisResult(providerOutput(), { ...CTX, evidence: fromBrand }).competitors[0].source).toBe("BRAND_PROFILE");
  });

  it("4. a page the model did not classify still appears, with null classifications rather than guesses", () => {
    const result = buildCompetitorAnalysisResult(providerOutput(), CTX);
    const pricing = result.competitors[0].pages.find((p) => p.url.endsWith("/pricing"))!;
    expect(pricing.observedTopic).toBeNull();
    expect(pricing.format).toBeNull();
    expect(pricing.searchIntent).toBeNull();
    expect(pricing.keyCoverage).toEqual([]);
  });

  it("5. a classification is attached to the page whose url it names", () => {
    const result = buildCompetitorAnalysisResult(providerOutput(), CTX);
    const guide = result.competitors[0].pages[0];
    expect(guide.observedTopic).toBe("A beginner guide to self storage investing.");
    expect(guide.format).toBe("GUIDE");
    expect(guide.searchIntent).toBe("INFORMATIONAL");
    expect(guide.keyCoverage).toEqual(["Evaluation criteria", "Why self storage"]);
  });
});

describe("buildCompetitorAnalysisResult — the model cannot invent competitor facts", () => {
  it("6. GROUNDING — a classification for a page that was NOT crawled is dropped entirely", () => {
    const raw = providerOutput({
      pageAnalyses: [
        {
          url: "https://competitor.com/page-that-was-never-fetched",
          observedTopic: "Invented page",
          format: "ARTICLE",
          searchIntent: "INFORMATIONAL",
          keyCoverage: ["made up"],
        },
      ],
    });
    const serialized = JSON.stringify(buildCompetitorAnalysisResult(raw, CTX));
    expect(serialized).not.toContain("page-that-was-never-fetched");
    expect(serialized).not.toContain("Invented page");
  });

  it("7. GROUNDING — a fabricated url on ANOTHER domain never reaches the result", () => {
    const raw = providerOutput({
      pageAnalyses: [{ url: "https://evil.example.com/x", observedTopic: "x", format: "ARTICLE", searchIntent: "INFORMATIONAL", keyCoverage: [] }],
    });
    expect(JSON.stringify(buildCompetitorAnalysisResult(raw, CTX))).not.toContain("evil.example.com");
  });

  it("8. the result never contains more pages than the crawler actually fetched", () => {
    const raw = providerOutput({
      pageAnalyses: Array.from({ length: 20 }, (_, i) => ({
        url: `https://competitor.com/invented-${i}`,
        observedTopic: "x",
        format: "ARTICLE",
        searchIntent: "INFORMATIONAL",
        keyCoverage: [],
      })),
    });
    const result = buildCompetitorAnalysisResult(raw, CTX);
    expect(result.competitors[0].pages).toHaveLength(EVIDENCE[0].pages.length);
  });

  it("9. GROUNDING — a page classification carrying an unsupported metric claim is discarded", () => {
    const raw = providerOutput({
      pageAnalyses: [
        {
          url: "https://competitor.com/storage-guide",
          observedTopic: "This page ranks #1 and gets 40,000 monthly visits.",
          format: "GUIDE",
          searchIntent: "INFORMATIONAL",
          keyCoverage: [],
        },
      ],
    });
    const result = buildCompetitorAnalysisResult(raw, CTX);
    expect(result.competitors[0].pages[0].observedTopic).toBeNull();
    expect(JSON.stringify(result)).not.toContain("40,000");
  });

  it("10. GROUNDING — an opportunity making a ranking or traffic claim is dropped whole", () => {
    const raw = providerOutput({
      opportunities: [
        { topic: "Clean opportunity", whyItMatters: "Useful.", suggestedContentType: "ARTICLE", recommendedAction: "Write it." },
        { topic: "Ranked topic", whyItMatters: "Competitor ranks #2 for this.", suggestedContentType: "ARTICLE", recommendedAction: "Write it." },
      ],
    });
    const result = buildCompetitorAnalysisResult(raw, CTX);
    expect(result.opportunities.map((o) => o.topic)).toEqual(["Clean opportunity"]);
  });

  it("11. metric-bearing keyCoverage entries are removed while the page survives", () => {
    const raw = providerOutput({
      pageAnalyses: [
        {
          url: "https://competitor.com/storage-guide",
          observedTopic: "A guide.",
          format: "GUIDE",
          searchIntent: "INFORMATIONAL",
          keyCoverage: ["Evaluation criteria", "Gets 12,000 monthly searches"],
        },
      ],
    });
    const result = buildCompetitorAnalysisResult(raw, CTX);
    expect(result.competitors[0].pages[0].keyCoverage).toEqual(["Evaluation criteria"]);
  });
});

describe("buildCompetitorAnalysisResult — opportunities", () => {
  it("12. existing coverage is computed in CODE against the project's real titles", () => {
    const raw = providerOutput({
      opportunities: [
        { topic: "Self Storage Investing Guide", whyItMatters: "x", suggestedContentType: "GUIDE", recommendedAction: "y" },
      ],
    });
    const result = buildCompetitorAnalysisResult(raw, { ...CTX, existingTitles: ["Self Storage Investing Guide"] });
    expect(result.opportunities[0].existingCoverage.status).toBe("POSSIBLE_MATCH");
    expect(result.opportunities[0].existingCoverage.matchedTitle).toBe("Self Storage Investing Guide");
  });

  it("13. reports NOT_FOUND with no matched title when nothing relates", () => {
    const result = buildCompetitorAnalysisResult(providerOutput(), { ...CTX, existingTitles: ["Commercial Plumbing Basics"] });
    expect(result.opportunities[0].existingCoverage.status).toBe("NOT_FOUND");
    expect(result.opportunities[0].existingCoverage.matchedTitle).toBeNull();
  });

  it("14. related keywords are matched against the project's REAL keywords only", () => {
    const raw = providerOutput({
      opportunities: [{ topic: "self storage investments explained", whyItMatters: "x", suggestedContentType: "ARTICLE", recommendedAction: "y" }],
    });
    const result = buildCompetitorAnalysisResult(raw, CTX);
    expect(result.opportunities[0].relatedKeywords).toEqual(["self storage investments"]);
  });

  it("15. duplicate opportunities are removed, ignoring case and spacing", () => {
    const raw = providerOutput({
      opportunities: [
        { topic: "Storage ROI", whyItMatters: "a", suggestedContentType: "ARTICLE", recommendedAction: "b" },
        { topic: "  storage   ROI ", whyItMatters: "c", suggestedContentType: "ARTICLE", recommendedAction: "d" },
      ],
    });
    expect(buildCompetitorAnalysisResult(raw, CTX).opportunities).toHaveLength(1);
  });

  it("16. empty opportunities are dropped and the list is capped", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      topic: `Topic ${i}`,
      whyItMatters: "x",
      suggestedContentType: "ARTICLE",
      recommendedAction: "y",
    }));
    const raw = providerOutput({ opportunities: [{ topic: "   ", whyItMatters: "x", suggestedContentType: "ARTICLE", recommendedAction: "y" }, ...many] });
    const result = buildCompetitorAnalysisResult(raw, CTX);
    expect(result.opportunities.map((o) => o.topic)).not.toContain("");
    expect(result.opportunities.length).toBeLessThanOrEqual(8);
  });

  it("17. an invalid content type becomes null rather than a guessed value", () => {
    const raw = providerOutput({
      opportunities: [{ topic: "X", whyItMatters: "a", suggestedContentType: "PODCAST", recommendedAction: "b" }],
    });
    expect(buildCompetitorAnalysisResult(raw, CTX).opportunities[0].suggestedContentType).toBeNull();
  });
});

describe("buildCompetitorAnalysisResult — malformed and empty", () => {
  it("18. malformed model output still returns the crawl observations, never a throw", () => {
    for (const bad of [null, undefined, "not an object", [], {}, { pageAnalyses: "wrong" }]) {
      const result = buildCompetitorAnalysisResult(bad, CTX);
      expect(result.competitors[0].pages).toHaveLength(2);
      expect(result.opportunities).toEqual([]);
    }
  });

  it("19. a site the crawler returned no pages for is reported honestly as zero", () => {
    const empty = [{ ...EVIDENCE[0], pages: [], warnings: ["Could not read any pages."] }];
    const result = buildCompetitorAnalysisResult(providerOutput(), { ...CTX, evidence: empty });
    expect(result.competitors[0].pagesAnalyzed).toBe(0);
    expect(result.competitors[0].warnings).toEqual(["Could not read any pages."]);
  });

  it("20. the user's focus topic is echoed back, or null when none was given", () => {
    expect(buildCompetitorAnalysisResult(providerOutput(), { ...CTX, targetTopic: "storage" }).targetTopic).toBe("storage");
    expect(buildCompetitorAnalysisResult(providerOutput(), CTX).targetTopic).toBeNull();
  });
});

describe("normalizeCompetitorFormat / normalizeCompetitorIntent", () => {
  it("21. accepts valid values case- and spacing-insensitively", () => {
    expect(normalizeCompetitorFormat("landing page")).toBe("LANDING_PAGE");
    expect(normalizeCompetitorIntent("commercial")).toBe("COMMERCIAL");
  });

  it("22. returns null for anything else, never a default", () => {
    expect(normalizeCompetitorFormat("PODCAST")).toBeNull();
    expect(normalizeCompetitorIntent("BUYING")).toBeNull();
    expect(normalizeCompetitorFormat(undefined)).toBeNull();
  });
});

describe("prompt grounding", () => {
  const FULL_CTX = {
    seoProjectId: "p",
    companyId: "c",
    seoProjectName: "Storage Moguls",
    domain: "storagemoguls.com",
    evidence: EVIDENCE,
    existingTitles: CTX.existingTitles,
    keywordTerms: CTX.keywordTerms,
  };

  it("23. the system prompt forbids inventing competitor pages, URLs and business facts", () => {
    for (const phrase of ["the ONLY competitor information that exists", "Never invent a competitor URL", "not in the supplied list"]) {
      expect(COMPETITOR_CONTENT_ANALYSIS_SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it("24. the system prompt forbids every metric this platform lacks", () => {
    for (const phrase of ["ranking", "traffic", "search volume", "keyword difficulty", "backlink", "domain authority"]) {
      expect(COMPETITOR_CONTENT_ANALYSIS_SYSTEM_PROMPT.toLowerCase()).toContain(phrase);
    }
    expect(COMPETITOR_CONTENT_ANALYSIS_SYSTEM_PROMPT).toContain("Never promise a ranking, a featured snippet, AI-assistant visibility, or any performance outcome");
  });

  it("25. the system prompt separates observation from recommendation", () => {
    expect(COMPETITOR_CONTENT_ANALYSIS_SYSTEM_PROMPT).toContain("Keep observation separate from recommendation");
  });

  it("26. the prompt labels the crawl evidence and the customer's own data distinctly", () => {
    const prompt = buildPrompt(FULL_CTX);
    expect(prompt).toContain("COMPETITOR PAGES ACTUALLY FETCHED");
    expect(prompt).toContain("THE CUSTOMER'S OWN PROJECT DATA");
    expect(prompt).toContain("No ranking, traffic, search volume, keyword difficulty, backlink, or authority data is available");
  });

  it("27. the prompt lists the real crawled urls and titles", () => {
    const prompt = buildPrompt(FULL_CTX);
    expect(prompt).toContain("https://competitor.com/storage-guide");
    expect(prompt).toContain("The Self Storage Investing Guide");
  });

  it("28. the prompt states plainly when a site yielded no pages", () => {
    const prompt = buildPrompt({ ...FULL_CTX, evidence: [{ ...EVIDENCE[0], pages: [] }] });
    expect(prompt).toContain("No pages could be fetched from this site.");
  });

  it("29. the prompt states plainly when the project has no content or keywords", () => {
    const prompt = buildPrompt({ ...FULL_CTX, existingTitles: [], keywordTerms: [] });
    expect(prompt).toContain("Existing content titles: none recorded");
    expect(prompt).toContain("Tracked keywords: none recorded");
  });

  it("30. the prompt carries the user's focus topic when supplied", () => {
    expect(buildPrompt({ ...FULL_CTX, targetTopic: "self storage investing" })).toContain("USER-PROVIDED FOCUS");
  });

  it("31. the prompt never asks for ids or urls beyond the crawled pages", () => {
    expect(buildPrompt(FULL_CTX)).toContain("Do not include any ids, metrics, or urls other than the exact competitor page urls listed above");
  });
});
