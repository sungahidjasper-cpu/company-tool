import { describe, expect, it } from "vitest";

import { computeOverallScore, computeTechnicalSeoScore } from "@/features/seo/services/seo-scoring.service";
import type { CrawledPage, CrawlResult } from "@/features/seo/services/website-crawler.service";

function page(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: "https://example.com/",
    title: "Example",
    metaDescription: "A description",
    headings: ["Example"],
    bodyText: "Some body text.",
    canonicalUrl: "https://example.com/",
    metaRobots: null,
    jsonLdTypes: [],
    imageCount: 0,
    imagesWithAlt: 0,
    h1Count: 1,
    internalLinks: [],
    h1Text: null,
    imageUrls: [],
    jsonLdBlocks: [],
    ogTags: {},
    twitterTags: {},
    loadTimeMs: 100,
    ...overrides,
  };
}

function crawl(overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    domain: "https://example.com",
    pages: [page()],
    sitemapUrls: [],
    robotsTxtFound: true,
    homepageDisallowedByRobots: false,
    warnings: [],
    ...overrides,
  };
}

describe("computeTechnicalSeoScore", () => {
  it("scores a clean site at 100 with no findings", () => {
    const result = computeTechnicalSeoScore(crawl());
    expect(result.score.score).toBe(100);
    expect(result.findings).toHaveLength(0);
  });

  it("heavily penalizes a robots.txt-blocked homepage as CRITICAL", () => {
    const result = computeTechnicalSeoScore(crawl({ homepageDisallowedByRobots: true }));
    expect(result.score.score).toBeLessThanOrEqual(60);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ priority: "CRITICAL", title: "Robots.txt blocking important pages" })
    );
  });

  it("flags a noindex homepage as CRITICAL", () => {
    const result = computeTechnicalSeoScore(crawl({ pages: [page({ metaRobots: "noindex" })] }));
    expect(result.findings).toContainEqual(expect.objectContaining({ priority: "CRITICAL", title: "Homepage not indexable" }));
  });

  it("only penalizes missing robots.txt lightly (LOW priority)", () => {
    const result = computeTechnicalSeoScore(crawl({ robotsTxtFound: false }));
    expect(result.findings).toContainEqual(expect.objectContaining({ priority: "LOW", title: "No robots.txt found" }));
    expect(result.score.score).toBeGreaterThanOrEqual(90);
  });

  it("flags missing canonical tags when coverage is below 50% across multiple pages", () => {
    const result = computeTechnicalSeoScore(
      crawl({
        pages: [page({ url: "https://example.com/", canonicalUrl: "https://example.com/" }), page({ url: "https://example.com/a", canonicalUrl: null }), page({ url: "https://example.com/b", canonicalUrl: null })],
      })
    );
    expect(result.findings).toContainEqual(expect.objectContaining({ title: "Missing canonical tags" }));
  });

  it("never scores below 0 even when every penalty stacks", () => {
    const result = computeTechnicalSeoScore(
      crawl({
        robotsTxtFound: false,
        homepageDisallowedByRobots: true,
        pages: [page({ metaRobots: "noindex", canonicalUrl: null }), page({ url: "https://example.com/a", canonicalUrl: null })],
      })
    );
    expect(result.score.score).toBeGreaterThanOrEqual(0);
  });

  // Phase 11C, Objective 7 — page load time is a deterministic crawl-fetch
  // timing signal (website-crawler.service.ts's loadTimeMs), not an AI
  // judgment call.
  it("flags slow-loading pages (over 3s) without needing AI", () => {
    const result = computeTechnicalSeoScore(crawl({ pages: [page({ loadTimeMs: 4500 })] }));
    expect(result.findings).toContainEqual(expect.objectContaining({ title: "Slow-loading pages", priority: "MEDIUM" }));
  });

  it("does not flag a page loaded well under the slow-page threshold", () => {
    const result = computeTechnicalSeoScore(crawl({ pages: [page({ loadTimeMs: 200 })] }));
    expect(result.findings).not.toContainEqual(expect.objectContaining({ title: "Slow-loading pages" }));
  });

  // Phase 11C, Objective 7 — informational only, no score penalty: a large
  // sitemap relative to the sampled pages means the analysis covered a
  // subset, not that the site itself is broken.
  it("notes a partial crawl sample without penalizing the score", () => {
    const full = computeTechnicalSeoScore(crawl({ sitemapUrls: ["https://example.com/"] }));
    const partial = computeTechnicalSeoScore(
      crawl({ sitemapUrls: ["https://example.com/", "https://example.com/a", "https://example.com/b"] })
    );
    expect(partial.findings).toContainEqual(expect.objectContaining({ title: "Analysis based on a partial crawl sample", priority: "LOW" }));
    expect(full.findings).not.toContainEqual(expect.objectContaining({ title: "Analysis based on a partial crawl sample" }));
    expect(partial.score.score).toBe(full.score.score);
  });
});

describe("computeOverallScore", () => {
  it("returns 0 when every category is null/missing (nothing to average)", () => {
    expect(computeOverallScore({})).toBe(0);
  });

  it("returns the flat score when every category is equal", () => {
    const allSeventy = computeOverallScore({
      TECHNICAL_SEO: 70,
      ON_PAGE_SEO: 70,
      CONTENT_QUALITY: 70,
      STRUCTURED_DATA: 70,
      INTERNAL_LINKING: 70,
      EEAT: 70,
      LOCAL_SEO: 70,
      GEO_READINESS: 70,
      AEO_READINESS: 70,
    });
    expect(allSeventy).toBe(70);
  });

  it("renormalizes weights when LOCAL_SEO is excluded (not applicable), rather than treating it as 0", () => {
    const withLocalSeo = computeOverallScore({
      TECHNICAL_SEO: 80,
      ON_PAGE_SEO: 80,
      CONTENT_QUALITY: 80,
      STRUCTURED_DATA: 80,
      INTERNAL_LINKING: 80,
      EEAT: 80,
      LOCAL_SEO: 0,
      GEO_READINESS: 80,
      AEO_READINESS: 80,
    });
    const withoutLocalSeo = computeOverallScore({
      TECHNICAL_SEO: 80,
      ON_PAGE_SEO: 80,
      CONTENT_QUALITY: 80,
      STRUCTURED_DATA: 80,
      INTERNAL_LINKING: 80,
      EEAT: 80,
      LOCAL_SEO: null,
      GEO_READINESS: 80,
      AEO_READINESS: 80,
    });

    // Excluding a null category should renormalize to the same 80 average,
    // not drag the score down the way a literal 0 would.
    expect(withoutLocalSeo).toBe(80);
    expect(withoutLocalSeo).toBeGreaterThan(withLocalSeo);
  });

  it("clamps the result to the 0-100 range", () => {
    const score = computeOverallScore({ TECHNICAL_SEO: 100, ON_PAGE_SEO: 100 });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
