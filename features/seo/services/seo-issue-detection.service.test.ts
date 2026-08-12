import { describe, expect, it } from "vitest";

import { detectWebsiteAnalysisIssues } from "@/features/seo/services/seo-issue-detection.service";
import type { CrawledPage, CrawlResult } from "@/features/seo/services/website-crawler.service";

/**
 * internalLinks/imageUrls are deliberately empty on every fixture page —
 * detectWebsiteAnalysisIssues also runs the real-network broken-link/
 * large-image checks, and an empty candidate list resolves those instantly
 * with no actual fetch, keeping this a pure unit test.
 */
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
    h1Text: "Example",
    imageUrls: [],
    jsonLdBlocks: [],
    ogTags: { title: "Example", description: "A description", image: "https://example.com/og.png" },
    twitterTags: { card: "summary_large_image" },
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

const emptyContext = { detectedSchemaTypes: ["Organization"], orphanPages: [] };

describe("detectWebsiteAnalysisIssues — social preview tags (Phase 11C)", () => {
  it("does not flag a page with complete OpenGraph and Twitter Card tags", async () => {
    const issues = await detectWebsiteAnalysisIssues(crawl(), emptyContext);
    expect(issues).not.toContainEqual(expect.objectContaining({ issueType: "MISSING_OG_TAGS" }));
    expect(issues).not.toContainEqual(expect.objectContaining({ issueType: "MISSING_TWITTER_CARD" }));
  });

  it("flags MISSING_OG_TAGS when og:image is absent even if og:title/description are present", async () => {
    const issues = await detectWebsiteAnalysisIssues(
      crawl({ pages: [page({ ogTags: { title: "Example", description: "A description" } })] }),
      emptyContext
    );
    expect(issues).toContainEqual(expect.objectContaining({ issueType: "MISSING_OG_TAGS", severity: "LOW" }));
  });

  it("flags MISSING_OG_TAGS when there are no og: tags at all", async () => {
    const issues = await detectWebsiteAnalysisIssues(crawl({ pages: [page({ ogTags: {} })] }), emptyContext);
    expect(issues).toContainEqual(expect.objectContaining({ issueType: "MISSING_OG_TAGS" }));
  });

  it("flags MISSING_TWITTER_CARD when twitter:card is absent", async () => {
    const issues = await detectWebsiteAnalysisIssues(crawl({ pages: [page({ twitterTags: {} })] }), emptyContext);
    expect(issues).toContainEqual(expect.objectContaining({ issueType: "MISSING_TWITTER_CARD", severity: "LOW" }));
  });

  it("reports one issue per affected page, not one for the whole site", async () => {
    const issues = await detectWebsiteAnalysisIssues(
      crawl({
        pages: [
          page({ url: "https://example.com/", ogTags: {} }),
          page({ url: "https://example.com/a", ogTags: {} }),
        ],
      }),
      emptyContext
    );
    const ogIssues = issues.filter((issue) => issue.issueType === "MISSING_OG_TAGS");
    expect(ogIssues).toHaveLength(2);
    expect(ogIssues.map((issue) => issue.url)).toEqual(["https://example.com/", "https://example.com/a"]);
  });
});
