import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import Sitemapper from "sitemapper";

export type CrawledPage = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  bodyText: string;
  /** Technical SEO signals (Phase 10.5b) — all additive, feed the deterministic scoring service. */
  canonicalUrl: string | null;
  metaRobots: string | null;
  jsonLdTypes: string[];
  imageCount: number;
  imagesWithAlt: number;
  h1Count: number;
  /** Same-origin absolute URLs linked from this page — used for orphan-page detection. */
  internalLinks: string[];
};

export type CrawlResult = {
  domain: string;
  pages: CrawledPage[];
  sitemapUrls: string[];
  robotsTxtFound: boolean;
  homepageDisallowedByRobots: boolean;
  warnings: string[];
};

const USER_AGENT = "CloudCompassOS-SiteAnalyzer/1.0 (+https://cloudcompass.example.com/bot)";
const MAX_PAGES = 12;
const FETCH_TIMEOUT_MS = 10_000;
/** Politeness delay between fetches to the same host. */
const PER_HOST_DELAY_MS = 1_000;
/** Below this, a page is treated as JS-rendered (empty shell) rather than thin content. */
const MIN_BODY_TEXT_LENGTH = 40;

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function loadRobots(origin: string) {
  const robotsUrl = `${origin}/robots.txt`;
  const body = await fetchText(robotsUrl);
  if (!body) return null;
  return robotsParser(robotsUrl, body);
}

async function loadSitemapUrls(
  origin: string,
  robots: ReturnType<typeof robotsParser> | null
): Promise<string[]> {
  const declaredSitemaps = robots?.getSitemaps() ?? [];
  const sitemapUrl = declaredSitemaps[0] ?? `${origin}/sitemap.xml`;

  try {
    const sitemapper = new Sitemapper({
      url: sitemapUrl,
      timeout: FETCH_TIMEOUT_MS,
      requestHeaders: { "User-Agent": USER_AGENT },
    });
    const { sites } = await sitemapper.fetch();
    return sites as string[];
  } catch {
    return [];
  }
}

/** Extracts every "@type" value from a JSON-LD payload, including nested @graph entries. */
function extractJsonLdTypes(parsed: unknown, into: Set<string>): void {
  if (Array.isArray(parsed)) {
    parsed.forEach((entry) => extractJsonLdTypes(entry, into));
    return;
  }
  if (!parsed || typeof parsed !== "object") return;

  const obj = parsed as Record<string, unknown>;
  const type = obj["@type"];
  if (typeof type === "string") into.add(type);
  if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && into.add(t));

  if (Array.isArray(obj["@graph"])) extractJsonLdTypes(obj["@graph"], into);
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractPageContent(html: string, url: string): CrawledPage {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const headings = $("h1, h2")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 20);
  const h1Count = $("h1").length;

  const canonicalHref = $('link[rel="canonical"]').first().attr("href");
  const canonicalUrl = canonicalHref ? resolveUrl(canonicalHref, url) : null;
  const metaRobots = $('meta[name="robots"]').attr("content")?.trim().toLowerCase() || null;

  const jsonLdTypes = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      extractJsonLdTypes(JSON.parse($(el).text()), jsonLdTypes);
    } catch {
      // Malformed JSON-LD — skip rather than fail the whole page.
    }
  });

  const images = $("img");
  const imageCount = images.length;
  const imagesWithAlt = images.filter((_, el) => Boolean($(el).attr("alt")?.trim())).length;

  const pageOrigin = new URL(url).origin;
  const internalLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    const resolved = resolveUrl($(el).attr("href") ?? "", url);
    if (resolved && new URL(resolved).origin === pageOrigin) {
      internalLinks.add(resolved.split("#")[0]);
    }
  });

  $("script, style, nav, footer, noscript").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 3000);

  return {
    url,
    title,
    metaDescription,
    headings,
    bodyText,
    canonicalUrl,
    metaRobots,
    jsonLdTypes: Array.from(jsonLdTypes),
    imageCount,
    imagesWithAlt,
    h1Count,
    internalLinks: Array.from(internalLinks),
  };
}

/** Homepage + up to ~9 shallow (nav-like) pages + up to ~4 deeper (article-like) pages. */
function selectSamplePages(origin: string, sitemapUrls: string[]): string[] {
  const sameOrigin = sitemapUrls.filter((url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  });

  const homepage = `${origin}/`;
  const rest = sameOrigin.filter((url) => url !== homepage);
  const shallow = rest.filter((url) => new URL(url).pathname.split("/").filter(Boolean).length <= 1);
  const deep = rest.filter((url) => !shallow.includes(url));

  const picks = [homepage, ...shallow.slice(0, 9), ...deep.slice(0, 4)];
  return Array.from(new Set(picks)).slice(0, MAX_PAGES);
}

/**
 * robots.txt + sitemap.xml -> sample selection -> plain fetch + cheerio
 * extraction. No headless-browser fallback yet for JS-rendered pages (a
 * near-empty-body page is skipped and flagged in warnings instead) — see
 * the architecture doc's note that this is the rare path, deferred here.
 */
export async function crawlWebsite(domainInput: string): Promise<CrawlResult> {
  const warnings: string[] = [];
  const normalized = domainInput.startsWith("http") ? domainInput : `https://${domainInput}`;
  const origin = new URL(normalized).origin;

  const robots = await loadRobots(origin);
  if (!robots) {
    warnings.push("robots.txt not found or unreachable — proceeding without crawl restrictions.");
  }

  const sitemapUrls = await loadSitemapUrls(origin, robots);
  if (sitemapUrls.length === 0) {
    warnings.push("No sitemap found — falling back to the homepage only.");
  }

  const candidates = sitemapUrls.length > 0 ? selectSamplePages(origin, sitemapUrls) : [`${origin}/`];
  const homepageDisallowedByRobots = Boolean(robots?.isDisallowed(`${origin}/`, USER_AGENT));

  const pages: CrawledPage[] = [];
  for (const url of candidates) {
    if (robots?.isDisallowed(url, USER_AGENT)) continue;

    const html = await fetchText(url);
    if (!html) continue;

    const page = extractPageContent(html, url);
    if (page.bodyText.length < MIN_BODY_TEXT_LENGTH) {
      warnings.push(`${url}: extracted almost no text (likely JS-rendered) — skipped.`);
      continue;
    }

    pages.push(page);
    await new Promise((resolve) => setTimeout(resolve, PER_HOST_DELAY_MS));
  }

  if (pages.length === 0) {
    warnings.push("No pages could be crawled successfully.");
  }

  return {
    domain: origin,
    pages,
    sitemapUrls,
    robotsTxtFound: Boolean(robots),
    homepageDisallowedByRobots,
    warnings,
  };
}
