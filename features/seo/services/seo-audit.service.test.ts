import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
}));

import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { generateSeoAudit, type AuditContext } from "@/features/seo/services/seo-audit.service";
import {
  seoContentIntelligenceSchema,
  seoContentIntelligenceWithSourcesSchema,
  seoRecommendationsSchema,
  seoRecommendationsWithSourcesSchema,
} from "@/features/seo/schemas/seo-audit.schema";
import type { CrawlResult } from "@/features/seo/services/website-crawler.service";

const mockGenerate = vi.mocked(generateStructuredOutput);

const SCORES_RESULT = {
  contentQuality: { score: 70, reasoning: "Reasonable depth." },
  eeat: { score: 60, reasoning: "Some trust signals.", factors: [{ name: "Experience", score: 60, reasoning: "..." }] },
  localSeo: { applicable: false, score: null, reasoning: "Not a local business." },
  geoReadiness: { score: 55, reasoning: "...", factors: [{ name: "Entity Clarity", score: 55, reasoning: "..." }] },
  aeoReadiness: { score: 50, reasoning: "...", factors: [{ name: "FAQ Content", score: 50, reasoning: "..." }] },
};

const RECOMMENDATIONS_RESULT = {
  recommendations: [
    {
      title: "Add FAQ content",
      description: "...",
      whyItMatters: "...",
      estimatedImpact: "MEDIUM" as const,
      difficulty: "EASY" as const,
      priority: "MEDIUM" as const,
      category: "AEO_READINESS" as const,
    },
  ],
};

const CONTENT_INTELLIGENCE_RESULT = {
  keywordIntelligence: {
    primaryKeywords: ["widgets"],
    secondaryKeywords: [],
    longTailKeywords: [],
    semanticKeywords: [],
    searchIntentSummary: "Commercial intent.",
    contentClusters: [],
  },
  contentGaps: [],
  structuredDataRecommendations: [],
  internalLinkingSuggestions: [],
};

const EXECUTIVE_SUMMARY_RESULT = {
  overallHealthNarrative: "Solid foundation.",
  strengths: ["Fast pages"],
  weaknesses: ["Thin content"],
  topActions: ["Add FAQ content"],
};

function crawl(): CrawlResult {
  return {
    domain: "https://example.com",
    pages: [],
    sitemapUrls: [],
    robotsTxtFound: true,
    homepageDisallowedByRobots: false,
    warnings: [],
  };
}

function ctx(): AuditContext {
  return {
    websiteAnalysisJobId: "job-1",
    companyId: "company-1",
    crawl: crawl(),
    extraction: { businessCategory: "Widgets", services: [], locations: [], topics: [] },
    deterministicFindings: [],
    detectedSchemaTypes: [],
    missingSchemaTypes: [],
    orphanPages: [],
    thinPageUrls: [],
  };
}

/** Routes each generateStructuredOutput call to a canned result/rejection based on the taskType the caller passed — mirrors the 4 real independent AI calls generateSeoAudit makes. */
function mockByTaskType(overrides: Record<string, unknown | Error> = {}) {
  mockGenerate.mockImplementation(async (_schema, input) => {
    const value = overrides[input.taskType as string];
    if (value instanceof Error) throw value;
    if (value !== undefined) return value;

    switch (input.taskType) {
      case "SCORES":
        return SCORES_RESULT;
      case "RECOMMENDATIONS":
        return RECOMMENDATIONS_RESULT;
      case "CONTENT_INTELLIGENCE":
        return CONTENT_INTELLIGENCE_RESULT;
      case "EXECUTIVE_SUMMARY":
        return EXECUTIVE_SUMMARY_RESULT;
      default:
        throw new Error(`unexpected taskType ${input.taskType}`);
    }
  });
}

describe("generateSeoAudit — independent task failure (Phase 11C)", () => {
  it("returns every section populated when all 4 AI calls succeed", async () => {
    mockByTaskType();
    const result = await generateSeoAudit(ctx());

    expect(result.scores).not.toBeNull();
    expect(result.recommendations).not.toBeNull();
    expect(result.contentIntelligence).not.toBeNull();
    expect(result.executiveSummary).not.toBeNull();
  });

  it("keeps scores and recommendations when only contentIntelligence fails", async () => {
    mockByTaskType({ CONTENT_INTELLIGENCE: new Error("provider outage") });
    const result = await generateSeoAudit(ctx());

    expect(result.scores).not.toBeNull();
    expect(result.recommendations).not.toBeNull();
    expect(result.contentIntelligence).toBeNull();
    // Executive summary only needs scores + recommendations, both of which succeeded.
    expect(result.executiveSummary).not.toBeNull();
  });

  it("keeps contentIntelligence when only scores fails, and skips the executive summary (it would otherwise summarize missing data)", async () => {
    mockByTaskType({ SCORES: new Error("quota exceeded") });
    const result = await generateSeoAudit(ctx());

    expect(result.scores).toBeNull();
    expect(result.recommendations).not.toBeNull();
    expect(result.contentIntelligence).not.toBeNull();
    expect(result.executiveSummary).toBeNull();
  });

  it("skips the executive summary when recommendations fails, even though scores succeeded", async () => {
    mockByTaskType({ RECOMMENDATIONS: new Error("rate limited") });
    const result = await generateSeoAudit(ctx());

    expect(result.scores).not.toBeNull();
    expect(result.recommendations).toBeNull();
    expect(result.executiveSummary).toBeNull();
  });

  it("rethrows when all 3 independent tasks fail — equivalent to the pre-existing 'AI audit unavailable' path", async () => {
    mockByTaskType({
      SCORES: new Error("all providers exhausted"),
      RECOMMENDATIONS: new Error("all providers exhausted"),
      CONTENT_INTELLIGENCE: new Error("all providers exhausted"),
    });

    await expect(generateSeoAudit(ctx())).rejects.toThrow("all providers exhausted");
  });
});

/** SCORES/RECOMMENDATIONS/CONTENT_INTELLIGENCE all build their prompt from buildSharedContext (where knowledgeSourceContext is injected); EXECUTIVE_SUMMARY's prompt is built separately from already-computed results and never includes it — that's unchanged, existing behavior, not something this stage touches. */
const SHARED_CONTEXT_TASK_TYPES = new Set(["SCORES", "RECOMMENDATIONS", "CONTENT_INTELLIGENCE"]);

describe("generateSeoAudit — Knowledge Source context (Phase 30 Stage 8)", () => {
  it("includes the supplied Knowledge Source context block in every buildSharedContext-based task's prompt when present", async () => {
    mockByTaskType();
    mockGenerate.mockClear();
    await generateSeoAudit({ ...ctx(), knowledgeSourceContext: "Supplied authoritative sources for this project:\n- Google Search Central" });

    const sharedContextPrompts = mockGenerate.mock.calls
      .filter((call) => SHARED_CONTEXT_TASK_TYPES.has(call[1].taskType as string))
      .map((call) => call[1].prompt as string);
    expect(sharedContextPrompts).toHaveLength(3);
    for (const prompt of sharedContextPrompts) {
      expect(prompt).toContain("Supplied authoritative sources for this project:\n- Google Search Central");
    }
  });

  it("produces a byte-identical prompt to before this stage existed when no Knowledge Source context applies (null)", async () => {
    mockByTaskType();
    mockGenerate.mockClear();
    await generateSeoAudit({ ...ctx(), knowledgeSourceContext: null });

    const prompts = mockGenerate.mock.calls.map((call) => call[1].prompt as string);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).not.toContain("Supplied authoritative sources");
    }
  });

  it("omits the Knowledge Source block when the field is simply not supplied (existing callers/tests unaffected)", async () => {
    mockByTaskType();
    mockGenerate.mockClear();
    await generateSeoAudit(ctx());

    const prompts = mockGenerate.mock.calls.map((call) => call[1].prompt as string);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).not.toContain("Supplied authoritative sources");
    }
  });
});

describe("generateSeoAudit — source attribution (Phase 30 Stage 9)", () => {
  const SOURCES = [{ title: "Google Search Central", url: "https://developers.google.com/search" }];
  const KS_CONTEXT = "Supplied authoritative sources for this project:\n- Google Search Central";

  function callByTaskType(taskType: string) {
    return mockGenerate.mock.calls.find((call) => call[1].taskType === taskType);
  }

  it("1. [CRITICAL] uses the sources-extended schema for RECOMMENDATIONS and CONTENT_INTELLIGENCE only when Knowledge Source context is present", async () => {
    mockByTaskType();
    mockGenerate.mockClear();
    await generateSeoAudit({ ...ctx(), knowledgeSourceContext: KS_CONTEXT });

    expect(callByTaskType("RECOMMENDATIONS")?.[0]).toBe(seoRecommendationsWithSourcesSchema);
    expect(callByTaskType("CONTENT_INTELLIGENCE")?.[0]).toBe(seoContentIntelligenceWithSourcesSchema);
  });

  it("2. uses the original (unmodified) schemas for RECOMMENDATIONS and CONTENT_INTELLIGENCE when no Knowledge Source context applies", async () => {
    mockByTaskType();
    mockGenerate.mockClear();
    await generateSeoAudit(ctx());

    expect(callByTaskType("RECOMMENDATIONS")?.[0]).toBe(seoRecommendationsSchema);
    expect(callByTaskType("CONTENT_INTELLIGENCE")?.[0]).toBe(seoContentIntelligenceSchema);
  });

  it("3. instructs the model to cite only supplied sources and never fabricate one, only when Knowledge Source context is present", async () => {
    mockByTaskType();
    mockGenerate.mockClear();
    await generateSeoAudit({ ...ctx(), knowledgeSourceContext: KS_CONTEXT });

    const recommendationsPrompt = callByTaskType("RECOMMENDATIONS")?.[1].prompt as string;
    const contentIntelligencePrompt = callByTaskType("CONTENT_INTELLIGENCE")?.[1].prompt as string;
    for (const prompt of [recommendationsPrompt, contentIntelligencePrompt]) {
      expect(prompt).toContain("sourcesReferenced");
      expect(prompt).toContain("Never invent a URL");
      expect(prompt).toContain("Never list a source that was not supplied above");
    }
  });

  it("4. never adds the citation instruction when no Knowledge Source context applies", async () => {
    mockByTaskType();
    mockGenerate.mockClear();
    await generateSeoAudit(ctx());

    const recommendationsPrompt = callByTaskType("RECOMMENDATIONS")?.[1].prompt as string;
    const contentIntelligencePrompt = callByTaskType("CONTENT_INTELLIGENCE")?.[1].prompt as string;
    for (const prompt of [recommendationsPrompt, contentIntelligencePrompt]) {
      expect(prompt).not.toContain("sourcesReferenced");
    }
  });

  it("5. surfaces recommendationSources and contentIntelligence.sourcesReferenced exactly as the model returned them, in { title, url } form", async () => {
    mockByTaskType({
      RECOMMENDATIONS: { ...RECOMMENDATIONS_RESULT, sourcesReferenced: SOURCES },
      CONTENT_INTELLIGENCE: { ...CONTENT_INTELLIGENCE_RESULT, sourcesReferenced: SOURCES },
    });
    const result = await generateSeoAudit({ ...ctx(), knowledgeSourceContext: KS_CONTEXT });

    expect(result.recommendationSources).toEqual(SOURCES);
    expect(result.recommendationSources?.[0]).toEqual({ title: "Google Search Central", url: "https://developers.google.com/search" });
    expect(Object.keys(result.recommendationSources![0])).toEqual(["title", "url"]);
    expect(result.contentIntelligence?.sourcesReferenced).toEqual(SOURCES);
  });

  it("6. [defensive-only, not a reachable production case] the recommendations pass-through never fabricates a source list even if sourcesReferenced were entirely missing from the response", async () => {
    // NOTE: with Knowledge Source context present, seoRecommendationsWithSourcesSchema/
    // seoContentIntelligenceWithSourcesSchema make sourcesReferenced a REQUIRED field —
    // the real generateStructuredOutput would reject a response missing it outright via
    // schema.safeParse, so this exact input can never actually reach generateSeoAudit in
    // production. This test exists purely to prove the `?? null` pass-through itself
    // doesn't silently invent a fabricated value if that invariant were ever violated
    // (e.g. by a future bug elsewhere) — see test 8 below for the realistic "model cited
    // nothing" case (a present, empty sourcesReferenced: []), which IS schema-valid.
    mockByTaskType();
    const result = await generateSeoAudit({ ...ctx(), knowledgeSourceContext: KS_CONTEXT });

    expect(result.recommendationSources).toBeNull();
    expect(result.contentIntelligence?.sourcesReferenced).toBeUndefined();
  });

  it("7. recommendationSources is null and contentIntelligence.sourcesReferenced is absent when no Knowledge Source context applies — existing output shape otherwise unaffected", async () => {
    mockByTaskType();
    const result = await generateSeoAudit(ctx());

    expect(result.recommendationSources).toBeNull();
    expect(result.contentIntelligence?.sourcesReferenced).toBeUndefined();
    // Everything else about the existing output shape is untouched by this stage.
    expect(result.scores).not.toBeNull();
    expect(result.recommendations).not.toBeNull();
    expect(result.contentIntelligence).not.toBeNull();
    expect(result.executiveSummary).not.toBeNull();
  });

  it("8. [realistic, schema-valid case] preserves an empty sourcesReferenced: [] exactly as returned — never converted to null, and never fabricated into a non-empty list", async () => {
    // Unlike test 6's unreachable "field entirely missing" input, an empty array IS a
    // schema-valid response from seoRecommendationsWithSourcesSchema/
    // seoContentIntelligenceWithSourcesSchema — this is what the model is expected to
    // return when Knowledge Source context was supplied but it genuinely drew from none
    // of it for this particular run.
    mockByTaskType({
      RECOMMENDATIONS: { ...RECOMMENDATIONS_RESULT, sourcesReferenced: [] },
      CONTENT_INTELLIGENCE: { ...CONTENT_INTELLIGENCE_RESULT, sourcesReferenced: [] },
    });
    const result = await generateSeoAudit({ ...ctx(), knowledgeSourceContext: KS_CONTEXT });

    expect(result.recommendationSources).toEqual([]);
    expect(result.contentIntelligence?.sourcesReferenced).toEqual([]);
  });
});
