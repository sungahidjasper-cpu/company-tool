import type { CrawlResult } from "@/features/seo/services/website-crawler.service";

/**
 * Deterministic SEO scoring — the anti-hallucination backbone for the four
 * categories that are actually observable facts from a crawl (Technical
 * SEO, On-Page SEO, Structured Data, Internal Linking). Content Quality,
 * EEAT, Local SEO, GEO Readiness, and AEO Readiness need real judgment and
 * come from the audit LLM call instead (see seo-audit.service.ts) — these
 * findings are fed into that call as grounding context.
 */

export const SEO_CATEGORIES = [
  "TECHNICAL_SEO",
  "ON_PAGE_SEO",
  "CONTENT_QUALITY",
  "STRUCTURED_DATA",
  "INTERNAL_LINKING",
  "EEAT",
  "LOCAL_SEO",
  "GEO_READINESS",
  "AEO_READINESS",
] as const;
export type SeoCategory = (typeof SEO_CATEGORIES)[number];

export const RECOMMENDED_SCHEMA_TYPES = [
  "Organization",
  "LocalBusiness",
  "FAQPage",
  "BreadcrumbList",
  "Article",
  "Product",
  "Service",
  "Review",
  "VideoObject",
  "HowTo",
] as const;

export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type DeterministicFinding = {
  title: string;
  description: string;
  priority: Priority;
  category: SeoCategory;
};

export type CategoryScore = { score: number; reasoning: string };

const CATEGORY_WEIGHTS: Record<SeoCategory, number> = {
  TECHNICAL_SEO: 15,
  ON_PAGE_SEO: 15,
  CONTENT_QUALITY: 15,
  STRUCTURED_DATA: 10,
  INTERNAL_LINKING: 10,
  EEAT: 15,
  LOCAL_SEO: 5,
  GEO_READINESS: 7.5,
  AEO_READINESS: 7.5,
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function computeTechnicalSeoScore(crawl: CrawlResult): {
  score: CategoryScore;
  findings: DeterministicFinding[];
} {
  const findings: DeterministicFinding[] = [];
  let score = 100;

  if (crawl.homepageDisallowedByRobots) {
    findings.push({
      title: "Robots.txt blocking important pages",
      description: "The homepage is disallowed in robots.txt, preventing search engines from crawling it.",
      priority: "CRITICAL",
      category: "TECHNICAL_SEO",
    });
    score -= 40;
  }

  const homepage = crawl.pages.find((page) => page.url === `${crawl.domain}/`) ?? crawl.pages[0];
  if (homepage?.metaRobots?.includes("noindex")) {
    findings.push({
      title: "Homepage not indexable",
      description: 'The homepage has a meta robots "noindex" directive, blocking it from search results.',
      priority: "CRITICAL",
      category: "TECHNICAL_SEO",
    });
    score -= 40;
  }

  if (!crawl.robotsTxtFound) {
    findings.push({
      title: "No robots.txt found",
      description: "No robots.txt was found at the site root — search engines have no explicit crawl guidance.",
      priority: "LOW",
      category: "TECHNICAL_SEO",
    });
    score -= 5;
  }

  const pagesWithCanonical = crawl.pages.filter((page) => page.canonicalUrl).length;
  const canonicalCoverage = crawl.pages.length > 0 ? (pagesWithCanonical / crawl.pages.length) * 100 : 0;
  if (crawl.pages.length > 1 && canonicalCoverage < 50) {
    findings.push({
      title: "Missing canonical tags",
      description: `Only ${Math.round(canonicalCoverage)}% of crawled pages declare a canonical URL, risking duplicate-content dilution.`,
      priority: "CRITICAL",
      category: "TECHNICAL_SEO",
    });
    score -= 20;
  }

  return {
    score: {
      score: clampScore(score),
      reasoning: `${crawl.robotsTxtFound ? "robots.txt found" : "no robots.txt"}; ${Math.round(canonicalCoverage)}% canonical-tag coverage across ${crawl.pages.length} crawled page(s).`,
    },
    findings,
  };
}

export function computeOnPageSeoScore(crawl: CrawlResult): {
  score: CategoryScore;
  findings: DeterministicFinding[];
  thinPageUrls: string[];
} {
  const findings: DeterministicFinding[] = [];
  let score = 100;
  const pages = crawl.pages;

  const titleCounts = new Map<string, number>();
  for (const page of pages) {
    if (!page.title) continue;
    titleCounts.set(page.title, (titleCounts.get(page.title) ?? 0) + 1);
  }
  const duplicateTitleCount = Array.from(titleCounts.values()).filter((count) => count > 1).length;
  if (duplicateTitleCount > 0) {
    findings.push({
      title: "Duplicate titles",
      description: `${duplicateTitleCount} title(s) are reused across multiple crawled pages.`,
      priority: "HIGH",
      category: "ON_PAGE_SEO",
    });
    score -= 15;
  }

  const missingTitleCount = pages.filter((page) => !page.title).length;
  if (missingTitleCount > 0) {
    findings.push({
      title: "Missing page titles",
      description: `${missingTitleCount} crawled page(s) have no <title> tag.`,
      priority: "HIGH",
      category: "ON_PAGE_SEO",
    });
    score -= 15;
  }

  const longMetaDescriptionCount = pages.filter((page) => (page.metaDescription?.length ?? 0) > 160).length;
  if (longMetaDescriptionCount > 0) {
    findings.push({
      title: "Long meta descriptions",
      description: `${longMetaDescriptionCount} page(s) have a meta description over 160 characters, risking truncation in search results.`,
      priority: "MEDIUM",
      category: "ON_PAGE_SEO",
    });
    score -= 8;
  }

  const missingMetaDescriptionCount = pages.filter((page) => !page.metaDescription).length;
  if (missingMetaDescriptionCount > 0) {
    findings.push({
      title: "Missing meta descriptions",
      description: `${missingMetaDescriptionCount} crawled page(s) have no meta description.`,
      priority: "MEDIUM",
      category: "ON_PAGE_SEO",
    });
    score -= 8;
  }

  const headingIssueCount = pages.filter((page) => page.h1Count !== 1).length;
  if (headingIssueCount > 0) {
    findings.push({
      title: "Minor heading improvements",
      description: `${headingIssueCount} page(s) have zero or multiple H1 headings instead of exactly one.`,
      priority: "LOW",
      category: "ON_PAGE_SEO",
    });
    score -= 5;
  }

  const missingAltCount = pages.reduce((sum, page) => sum + (page.imageCount - page.imagesWithAlt), 0);
  const totalImageCount = pages.reduce((sum, page) => sum + page.imageCount, 0);
  if (missingAltCount > 0) {
    findings.push({
      title: "Missing alt attributes",
      description: `${missingAltCount} of ${totalImageCount} image(s) across crawled pages have no alt text.`,
      priority: "MEDIUM",
      category: "ON_PAGE_SEO",
    });
    score -= 8;
  }

  const thinPageUrls = pages.filter((page) => page.bodyText.length < 200).map((page) => page.url);

  return {
    score: {
      score: clampScore(score),
      reasoning: `${duplicateTitleCount} duplicate title(s), ${headingIssueCount} heading issue(s), ${missingAltCount}/${totalImageCount} images missing alt text.`,
    },
    findings,
    thinPageUrls,
  };
}

export function computeStructuredDataScore(crawl: CrawlResult): {
  score: CategoryScore;
  findings: DeterministicFinding[];
  detectedSchemaTypes: string[];
  missingSchemaTypes: string[];
} {
  const findings: DeterministicFinding[] = [];
  const detected = new Set<string>();
  crawl.pages.forEach((page) => page.jsonLdTypes.forEach((type) => detected.add(type)));

  const pagesWithAnySchema = crawl.pages.filter((page) => page.jsonLdTypes.length > 0).length;
  const coverage = crawl.pages.length > 0 ? (pagesWithAnySchema / crawl.pages.length) * 100 : 0;

  const missingSchemaTypes = RECOMMENDED_SCHEMA_TYPES.filter((type) => !detected.has(type));

  if (!detected.has("Organization") && !detected.has("LocalBusiness")) {
    findings.push({
      title: "Missing Organization schema",
      description: "No Organization or LocalBusiness structured data was found on the crawled pages.",
      priority: "HIGH",
      category: "STRUCTURED_DATA",
    });
  }
  if (!detected.has("FAQPage")) {
    findings.push({
      title: "Missing FAQ schema",
      description: "No FAQPage structured data was found — FAQ content isn't eligible for rich results.",
      priority: "HIGH",
      category: "STRUCTURED_DATA",
    });
  }

  return {
    score: {
      score: clampScore(coverage),
      reasoning: `${Math.round(coverage)}% of crawled pages have structured data; ${detected.size} schema type(s) detected: ${Array.from(detected).join(", ") || "none"}.`,
    },
    findings,
    detectedSchemaTypes: Array.from(detected),
    missingSchemaTypes,
  };
}

export function computeInternalLinkingScore(crawl: CrawlResult): {
  score: CategoryScore;
  findings: DeterministicFinding[];
  orphanPages: string[];
} {
  const findings: DeterministicFinding[] = [];
  const normalize = (url: string) => url.replace(/\/$/, "");

  const linkedTargets = new Set<string>();
  crawl.pages.forEach((page) => page.internalLinks.forEach((link) => linkedTargets.add(normalize(link))));

  const homepage = normalize(`${crawl.domain}/`);
  const orphanPages = crawl.pages
    .map((page) => normalize(page.url))
    .filter((url) => url !== homepage && !linkedTargets.has(url));

  const avgInternalLinks = average(crawl.pages.map((page) => page.internalLinks.length));
  const orphanRatio = crawl.pages.length > 0 ? orphanPages.length / crawl.pages.length : 0;

  if (orphanPages.length > 0) {
    findings.push({
      title: "Orphan pages detected",
      description: `${orphanPages.length} crawled page(s) aren't linked from any other page in this sample.`,
      priority: "MEDIUM",
      category: "INTERNAL_LINKING",
    });
  }

  if (avgInternalLinks < 3) {
    findings.push({
      title: "Weak internal links",
      description: `Crawled pages average only ${avgInternalLinks.toFixed(1)} internal links each.`,
      priority: "MEDIUM",
      category: "INTERNAL_LINKING",
    });
  }

  const linkDensityScore = Math.min(100, (avgInternalLinks / 10) * 100);
  const score = clampScore(linkDensityScore * (1 - orphanRatio));

  return {
    score: {
      score,
      reasoning: `Average ${avgInternalLinks.toFixed(1)} internal links per crawled page; ${orphanPages.length} orphaned within the sample.`,
    },
    findings,
    orphanPages,
  };
}

/** Weighted average over only the applicable categories — missing/null scores (e.g. Local SEO when not applicable) are excluded and weights renormalize. */
export function computeOverallScore(scores: Partial<Record<SeoCategory, number | null>>): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const category of SEO_CATEGORIES) {
    const score = scores[category];
    if (score === null || score === undefined) continue;
    const weight = CATEGORY_WEIGHTS[category];
    weightedSum += score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? clampScore(weightedSum / totalWeight) : 0;
}
