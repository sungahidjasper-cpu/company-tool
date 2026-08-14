import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-output", () => ({
  generateStructuredOutput: vi.fn(),
}));

import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { generateSeoAudit, type AuditContext } from "@/features/seo/services/seo-audit.service";
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
