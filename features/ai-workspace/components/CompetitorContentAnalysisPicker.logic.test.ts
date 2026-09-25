import { describe, expect, it } from "vitest";

import { computeCanAnalyze, formatAnalysisAsText } from "@/features/ai-workspace/components/CompetitorContentAnalysisPicker";
import type { CompetitorAnalysisResult } from "@/features/ai-workspace/schemas/competitor-content-analysis.schema";

/**
 * This repository has no React rendering test setup (vitest runs
 * `environment: "node"`), so the picker's real logic is tested as pure
 * functions — the same approach every other AI Workspace picker uses.
 */

const RESULT: CompetitorAnalysisResult = {
  targetTopic: "self storage investing",
  competitors: [
    {
      origin: "https://competitor.com",
      source: "USER",
      pagesAnalyzed: 2,
      robotsTxtFound: true,
      warnings: ["No sitemap found — falling back to the homepage only."],
      pages: [
        {
          url: "https://competitor.com/storage-guide",
          title: "The Self Storage Investing Guide",
          metaDescription: "How to invest.",
          headings: ["Why self storage"],
          observedTopic: "A beginner guide to self storage investing.",
          format: "GUIDE",
          searchIntent: "INFORMATIONAL",
          keyCoverage: ["Evaluation criteria"],
        },
        {
          url: "https://competitor.com/pricing",
          title: "Pricing",
          metaDescription: null,
          headings: [],
          observedTopic: null,
          format: null,
          searchIntent: null,
          keyCoverage: [],
        },
      ],
    },
  ],
  opportunities: [
    {
      topic: "How to evaluate a storage facility",
      whyItMatters: "The competitor covers evaluation and your site does not.",
      suggestedContentType: "ARTICLE",
      recommendedAction: "Write a practical checklist.",
      existingCoverage: { status: "POSSIBLE_MATCH", matchedTitle: "Facility Evaluation Basics" },
      relatedKeywords: ["self storage investments"],
    },
  ],
};

describe("computeCanAnalyze — the Generate gate", () => {
  it("1. requires a project and at least one usable URL", () => {
    expect(computeCanAnalyze("project-1", ["https://competitor.com"])).toBe(true);
  });

  it("2. blocked with no project selected — the tool never defaults to one", () => {
    expect(computeCanAnalyze("", ["https://competitor.com"])).toBe(false);
  });

  it("3. blocked with no URL at all", () => {
    expect(computeCanAnalyze("project-1", [])).toBe(false);
    expect(computeCanAnalyze("project-1", ["", "   "])).toBe(false);
  });

  it("4. blocked when every URL is unusable — http, non-web scheme, or a single-label host", () => {
    expect(computeCanAnalyze("project-1", ["http://competitor.com"])).toBe(false);
    expect(computeCanAnalyze("project-1", ["ftp://competitor.com"])).toBe(false);
    expect(computeCanAnalyze("project-1", ["localhost"])).toBe(false);
  });

  it("5. enabled when at least one URL is usable, so a half-typed second field does not block", () => {
    expect(computeCanAnalyze("project-1", ["https://competitor.com", ""])).toBe(true);
  });
});

describe("formatAnalysisAsText — the Copy output", () => {
  it("6. labels the focus topic as the user's own input", () => {
    expect(formatAnalysisAsText(RESULT)).toContain("Focus (your input): self storage investing");
  });

  it("7. keeps OBSERVED pages and RECOMMENDED opportunities in separate labelled sections", () => {
    const text = formatAnalysisAsText(RESULT);
    expect(text).toContain("OBSERVED PAGE: https://competitor.com/storage-guide");
    expect(text).toContain("CONTENT OPPORTUNITIES (recommendations, not observations)");
    expect(text.indexOf("OBSERVED PAGE")).toBeLessThan(text.indexOf("CONTENT OPPORTUNITIES"));
  });

  it("8. states where each competitor URL came from", () => {
    expect(formatAnalysisAsText(RESULT)).toContain("Source: User-provided competitor URL");
    const fromBrand = { ...RESULT, competitors: [{ ...RESULT.competitors[0], source: "BRAND_PROFILE" as const }] };
    expect(formatAnalysisAsText(fromBrand)).toContain("Source: Brand Profile competitor URL");
  });

  it("9. surfaces the crawler's own warnings rather than hiding the sample size", () => {
    expect(formatAnalysisAsText(RESULT)).toContain("Crawl notes: No sitemap found");
    expect(formatAnalysisAsText(RESULT)).toContain("Pages analysed: 2");
  });

  it("10. omits absent classifications rather than printing them as null", () => {
    const text = formatAnalysisAsText(RESULT);
    expect(text).not.toContain("null");
    // Only the classified page contributes these lines.
    expect(text.match(/Observed topic:/g)).toHaveLength(1);
    expect(text.match(/Format:/g)).toHaveLength(1);
  });

  it("11. hedges existing coverage — never claims the topic is covered or ranks", () => {
    const text = formatAnalysisAsText(RESULT);
    expect(text).toContain("Potential existing coverage:");
    expect(text).toContain("(title match only)");
    expect(text).not.toMatch(/fully covered|ranks for|is ranking/i);
  });

  it("12. includes only real related keywords", () => {
    expect(formatAnalysisAsText(RESULT)).toContain("Related existing keywords: self storage investments");
  });

  it("13. contains no fabricated metrics", () => {
    expect(formatAnalysisAsText(RESULT)).not.toMatch(/search volume|monthly searches|impressions|backlinks|domain authority|ranks #/i);
  });

  it("14. never leaks internal ids or provider details", () => {
    const text = formatAnalysisAsText(RESULT);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/(?:jobId|companyId|seoProjectId)/i);
    expect(text).not.toMatch(/(?:gemini|openrouter|ollama)/i);
  });

  it("15. an empty analysis produces empty text rather than throwing", () => {
    const empty: CompetitorAnalysisResult = { targetTopic: null, competitors: [], opportunities: [] };
    expect(formatAnalysisAsText(empty)).toBe("");
  });
});
