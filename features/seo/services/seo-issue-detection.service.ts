import type { WebsiteAnalysisIssueSeverity, WebsiteAnalysisIssueType } from "@/lib/generated/prisma/client";
import { checkImageSize, checkLinkHealth, type CrawlResult } from "@/features/seo/services/website-crawler.service";

/**
 * Itemized, per-URL technical findings — Phase 11B's replacement for
 * summary-only scoring. Returns plain input rows (no id/jobId/status/
 * timestamps); the caller bulk-inserts via `createMany`.
 */
export type IssueInput = {
  issueType: WebsiteAnalysisIssueType;
  severity: WebsiteAnalysisIssueSeverity;
  url: string | null;
  explanation: string;
  recommendedFix: string;
};

/** Real network checks (broken links, image size) are bounded to avoid unbounded fan-out against the target site. */
const MAX_LINKS_CHECKED = 20;
const MAX_IMAGES_CHECKED = 20;
const LARGE_IMAGE_THRESHOLD_BYTES = 500_000;

const REQUIRED_FIELDS_BY_SCHEMA_TYPE: Record<string, string[]> = {
  Organization: ["name"],
  LocalBusiness: ["name", "address"],
  FAQPage: ["mainEntity"],
  BreadcrumbList: ["itemListElement"],
  Article: ["headline"],
  Product: ["name"],
  Service: ["name"],
  Review: ["reviewRating", "author"],
  VideoObject: ["name", "description"],
  HowTo: ["name", "step"],
};

/** Flattens @graph-nested JSON-LD blocks into {type, node} pairs, same traversal shape as the crawler's own type extraction. */
function flattenJsonLdNodes(blocks: unknown[]): { type: string; node: Record<string, unknown> }[] {
  const nodes: { type: string; node: Record<string, unknown> }[] = [];

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    const obj = value as Record<string, unknown>;
    const type = obj["@type"];
    if (typeof type === "string") nodes.push({ type, node: obj });
    if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && nodes.push({ type: t, node: obj }));
    if (Array.isArray(obj["@graph"])) visit(obj["@graph"]);
  }

  blocks.forEach(visit);
  return nodes;
}

function detectTitleIssues(crawl: CrawlResult): IssueInput[] {
  const issues: IssueInput[] = [];
  const titleCounts = new Map<string, number>();
  crawl.pages.forEach((page) => {
    if (page.title) titleCounts.set(page.title, (titleCounts.get(page.title) ?? 0) + 1);
  });

  for (const page of crawl.pages) {
    if (!page.title) {
      issues.push({
        issueType: "MISSING_TITLE",
        severity: "HIGH",
        url: page.url,
        explanation: "This page has no <title> tag.",
        recommendedFix: "Add a unique, descriptive <title> tag (50-60 characters) summarizing this page's content.",
      });
    } else if ((titleCounts.get(page.title) ?? 0) > 1) {
      issues.push({
        issueType: "DUPLICATE_TITLE",
        severity: "HIGH",
        url: page.url,
        explanation: `This page's title ("${page.title}") is reused on another crawled page.`,
        recommendedFix: "Write a unique title for each page reflecting its specific content.",
      });
    }
  }
  return issues;
}

function detectMetaDescriptionIssues(crawl: CrawlResult): IssueInput[] {
  return crawl.pages
    .filter((page) => !page.metaDescription)
    .map((page) => ({
      issueType: "MISSING_META_DESCRIPTION" as const,
      severity: "MEDIUM" as const,
      url: page.url,
      explanation: "This page has no meta description.",
      recommendedFix: "Add a compelling meta description (120-160 characters) summarizing the page for search results.",
    }));
}

function detectH1Issues(crawl: CrawlResult): IssueInput[] {
  const issues: IssueInput[] = [];
  const h1Counts = new Map<string, number>();
  crawl.pages.forEach((page) => {
    if (page.h1Text) h1Counts.set(page.h1Text, (h1Counts.get(page.h1Text) ?? 0) + 1);
  });

  for (const page of crawl.pages) {
    if (page.h1Text && (h1Counts.get(page.h1Text) ?? 0) > 1) {
      issues.push({
        issueType: "DUPLICATE_H1",
        severity: "MEDIUM",
        url: page.url,
        explanation: `This page's H1 ("${page.h1Text}") is reused on another crawled page.`,
        recommendedFix: "Give each page a unique H1 that reflects its specific topic.",
      });
    }
  }
  return issues;
}

function detectAltTextIssues(crawl: CrawlResult): IssueInput[] {
  return crawl.pages
    .filter((page) => page.imageCount > page.imagesWithAlt)
    .map((page) => ({
      issueType: "MISSING_ALT_TEXT" as const,
      severity: "LOW" as const,
      url: page.url,
      explanation: `${page.imageCount - page.imagesWithAlt} of ${page.imageCount} image(s) on this page have no alt text.`,
      recommendedFix: "Add descriptive alt text to every meaningful image for accessibility and image search visibility.",
    }));
}

function detectCanonicalIssues(crawl: CrawlResult): IssueInput[] {
  if (crawl.pages.length <= 1) return [];
  return crawl.pages
    .filter((page) => !page.canonicalUrl)
    .map((page) => ({
      issueType: "CANONICAL_ISSUE" as const,
      severity: "MEDIUM" as const,
      url: page.url,
      explanation: "This page has no canonical tag.",
      recommendedFix: "Add a <link rel=\"canonical\"> tag pointing to this page's preferred URL to avoid duplicate-content ambiguity.",
    }));
}

function detectSitemapAndRobotsIssues(crawl: CrawlResult): IssueInput[] {
  const issues: IssueInput[] = [];

  if (crawl.sitemapUrls.length === 0) {
    issues.push({
      issueType: "SITEMAP_ISSUE",
      severity: "MEDIUM",
      url: null,
      explanation: "No sitemap.xml was found for this site.",
      recommendedFix: "Publish a sitemap.xml listing all indexable pages and reference it from robots.txt.",
    });
  }

  if (!crawl.robotsTxtFound) {
    issues.push({
      issueType: "ROBOTS_ISSUE",
      severity: "LOW",
      url: null,
      explanation: "No robots.txt was found at the site root.",
      recommendedFix: "Add a robots.txt file with explicit crawl guidance, even if it just allows everything.",
    });
  }
  if (crawl.homepageDisallowedByRobots) {
    issues.push({
      issueType: "ROBOTS_ISSUE",
      severity: "CRITICAL",
      url: `${crawl.domain}/`,
      explanation: "robots.txt disallows crawling the homepage, blocking it from search engines entirely.",
      recommendedFix: "Remove the Disallow rule blocking the homepage in robots.txt.",
    });
  }

  return issues;
}

function detectStructuredDataIssues(crawl: CrawlResult, detectedSchemaTypes: string[]): IssueInput[] {
  const issues: IssueInput[] = [];

  if (detectedSchemaTypes.length === 0) {
    issues.push({
      issueType: "STRUCTURED_DATA_ISSUE",
      severity: "HIGH",
      url: null,
      explanation: "No structured data (JSON-LD) was detected anywhere on the crawled pages.",
      recommendedFix: "Add Organization/LocalBusiness JSON-LD at minimum — see the Structured Data tab for a ready-to-use example.",
    });
    return issues;
  }

  for (const page of crawl.pages) {
    const nodes = flattenJsonLdNodes(page.jsonLdBlocks);
    for (const { type, node } of nodes) {
      const requiredFields = REQUIRED_FIELDS_BY_SCHEMA_TYPE[type];
      if (!requiredFields) continue;
      const missing = requiredFields.filter((field) => !node[field]);
      if (missing.length > 0) {
        issues.push({
          issueType: "STRUCTURED_DATA_ISSUE",
          severity: "MEDIUM",
          url: page.url,
          explanation: `This page's ${type} structured data is missing required field(s): ${missing.join(", ")}.`,
          recommendedFix: `Add ${missing.join(", ")} to the ${type} JSON-LD block on this page.`,
        });
      }
    }
  }

  return issues;
}

function detectInternalLinkingIssues(orphanPages: string[]): IssueInput[] {
  return orphanPages.map((url) => ({
    issueType: "INTERNAL_LINKING_OPPORTUNITY" as const,
    severity: "MEDIUM" as const,
    url,
    explanation: "This page isn't linked from any other page in the crawled sample.",
    recommendedFix: "Add at least one contextual internal link to this page from a related, higher-traffic page.",
  }));
}

async function detectBrokenLinksAndRedirects(crawl: CrawlResult): Promise<IssueInput[]> {
  const crawledUrls = new Set(crawl.pages.map((page) => page.url));
  const uniqueLinks = new Set<string>();
  crawl.pages.forEach((page) => page.internalLinks.forEach((link) => uniqueLinks.add(link)));

  // Only check links we haven't already successfully crawled as pages — those are known-good.
  const candidates = Array.from(uniqueLinks)
    .filter((link) => !crawledUrls.has(link))
    .slice(0, MAX_LINKS_CHECKED);

  const results = await Promise.all(candidates.map((link) => checkLinkHealth(link)));
  const issues: IssueInput[] = [];

  for (const result of results) {
    if (result.broken) {
      issues.push({
        issueType: "BROKEN_LINK",
        severity: "HIGH",
        url: result.url,
        explanation: result.status ? `This internal link returns HTTP ${result.status}.` : "This internal link could not be reached.",
        recommendedFix: "Fix or remove this link, or restore the page it points to.",
      });
    } else if (result.redirectCount > 1) {
      issues.push({
        issueType: "REDIRECT_CHAIN",
        severity: "MEDIUM",
        url: result.url,
        explanation: `This internal link passes through ${result.redirectCount} redirects before reaching ${result.finalUrl}.`,
        recommendedFix: "Update the link to point directly at the final URL, removing the intermediate redirect hops.",
      });
    }
  }

  return issues;
}

async function detectLargeImages(crawl: CrawlResult): Promise<IssueInput[]> {
  const uniqueImageUrls = new Set<string>();
  crawl.pages.forEach((page) => page.imageUrls.forEach((url) => uniqueImageUrls.add(url)));
  const candidates = Array.from(uniqueImageUrls).slice(0, MAX_IMAGES_CHECKED);

  const results = await Promise.all(candidates.map((url) => checkImageSize(url)));
  return results
    .filter((result) => !result.broken && result.sizeBytes !== null && result.sizeBytes > LARGE_IMAGE_THRESHOLD_BYTES)
    .map((result) => ({
      issueType: "LARGE_IMAGE" as const,
      severity: "MEDIUM" as const,
      url: result.url,
      explanation: `This image is ${Math.round((result.sizeBytes ?? 0) / 1000)}KB, over the ${Math.round(LARGE_IMAGE_THRESHOLD_BYTES / 1000)}KB threshold.`,
      recommendedFix: "Compress this image or serve a modern format (WebP/AVIF) to reduce page weight.",
    }));
}

/**
 * Runs every deterministic issue check against a completed crawl. The
 * synchronous checks (titles, meta, H1s, alt text, canonicals, sitemap/
 * robots, structured data) are effectively free — the two async ones
 * (broken links, large images) make real, bounded network requests against
 * the target site.
 */
export async function detectWebsiteAnalysisIssues(
  crawl: CrawlResult,
  context: { detectedSchemaTypes: string[]; orphanPages: string[] }
): Promise<IssueInput[]> {
  const [brokenLinkIssues, largeImageIssues] = await Promise.all([
    detectBrokenLinksAndRedirects(crawl),
    detectLargeImages(crawl),
  ]);

  return [
    ...detectTitleIssues(crawl),
    ...detectMetaDescriptionIssues(crawl),
    ...detectH1Issues(crawl),
    ...detectAltTextIssues(crawl),
    ...detectCanonicalIssues(crawl),
    ...detectSitemapAndRobotsIssues(crawl),
    ...detectStructuredDataIssues(crawl, context.detectedSchemaTypes),
    ...detectInternalLinkingIssues(context.orphanPages),
    ...brokenLinkIssues,
    ...largeImageIssues,
  ];
}
