/**
 * Phase F.3 — deterministic hostname normalization and project/destination
 * compatibility.
 *
 * Pure functions only: no I/O, no DNS, no database. This decides whether a
 * URL "belongs to" an SEO project, which governs (a) whether a publishing
 * destination may be used for a project's content at all, and (b) whether a
 * CMS-returned URL may be recorded as that Content's public URL.
 *
 * Why this is separate from ssrf-guard.service.ts: that guard answers a
 * different question — "is it safe to send a request here" — and answers it
 * by resolving DNS. This module answers "does this host belong to this
 * project", which is a pure string/structure question. Keeping them apart
 * means the URL we merely RECORD never triggers a second DNS lookup, and the
 * SSRF guard is never weakened to accommodate a comparison it was not
 * designed for.
 */

/**
 * Hosts whose subdomains belong to DIFFERENT customers, not to whoever owns
 * the parent domain. On these, `someone-else.<suffix>` must never count as
 * "inside" a project whose domain is `<suffix>` — so subdomain expansion is
 * disabled and only an exact host match is accepted.
 *
 * Deliberately a short, hand-maintained constant rather than a public-suffix
 * list: a PSL would mean a new dependency, and the general problem is far
 * larger than the one real hazard here. Each entry is a platform that hands
 * every customer a subdomain of one shared parent:
 *
 * - wordpress.com / wpcomstaging.com — WordPress.com hosted and staging
 *   sites. These matter most: WordPress is currently the ONLY publishing
 *   provider, so a project domain of `wordpress.com` is entirely plausible,
 *   and without this guard `someone-elses-blog.wordpress.com` would be
 *   treated as part of the project.
 * - blogspot.com — Blogger.
 * - github.io — GitHub Pages.
 * - myshopify.com — Shopify stores.
 * - wixsite.com — Wix.
 * - weebly.com — Weebly.
 * - netlify.app / vercel.app / pages.dev — static hosting preview domains.
 *
 * An unlisted shared host degrades to an SEO-correctness problem (a project's
 * link inventory could include another customer's site), never to an
 * access-control one: publishing still requires valid, company-owned
 * credentials for the destination.
 */
export const SHARED_HOSTING_SUFFIXES: ReadonlySet<string> = new Set([
  "wordpress.com",
  "wpcomstaging.com",
  "blogspot.com",
  "github.io",
  "myshopify.com",
  "wixsite.com",
  "weebly.com",
  "netlify.app",
  "vercel.app",
  "pages.dev",
]);

/**
 * Reduces any of this app's URL-ish values to one comparable hostname, or
 * null when it cannot be reduced safely.
 *
 * Handles the real shapes present in the data: `SEOProject.domain` is
 * unvalidated free text and is usually a bare hostname
 * (`acme-plumbing.example.com`) but is sometimes a full URL
 * (`https://www.storagemoguls.com/`), while `PublishingConnection.baseUrl`
 * is always an absolute https URL.
 *
 * Uses `.hostname` and never `.host`, because `.host` includes the port —
 * `blog.example.com:8443` would otherwise never match `blog.example.com`.
 *
 * Returns null (fail closed) rather than guessing. A caller must treat null
 * as "not eligible", never as "no restriction".
 */
export function toComparableHost(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return null;

  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    // The value already carries a scheme yet failed to parse, so it is
    // malformed — not a bare hostname. Prefixing it would silently invent a
    // host (`http://` would become the host `http`), so fail closed instead.
    if (value.includes("://")) return null;
    try {
      // A bare hostname cannot be parsed on its own; give it a scheme purely
      // so the URL parser can extract the host. This also means a value
      // containing userinfo or a path is parsed properly rather than
      // string-matched — `example.com@evil.com` correctly yields `evil.com`.
      hostname = new URL(`https://${value}`).hostname;
    } catch {
      return null;
    }
  }

  let host = hostname.toLowerCase();
  // The fully-qualified form `example.com.` is the same host as `example.com`.
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host === "" ? null : host;
}

/** Removes one leading `www.`, applied to the PROJECT side only (see isHostWithinProjectDomain). */
function stripLeadingWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/**
 * Whether `candidate` (a URL or bare host) belongs to `projectDomain`.
 *
 * The comparison is a dot-boundary suffix test, never a bare `endsWith`.
 * A bare `endsWith(projectHost)` wrongly accepts `evil-example.com` and
 * `notexample.com` for a project at `example.com` — verified by the tests
 * accompanying this file. The leading dot is load-bearing.
 *
 * `www.` is stripped from the project host only; a `www.` candidate still
 * matches, because `www.example.com` ends with `.example.com`.
 *
 * A project host must have at least two labels, so a domain of `com` can
 * never make every `.com` site "internal".
 */
export function isHostWithinProjectDomain(candidate: string | null | undefined, projectDomain: string | null | undefined): boolean {
  const rawProjectHost = toComparableHost(projectDomain);
  if (!rawProjectHost) return false;

  const projectHost = stripLeadingWww(rawProjectHost);
  if (projectHost.split(".").length < 2) return false;

  const candidateHost = toComparableHost(candidate);
  if (!candidateHost) return false;

  if (candidateHost === projectHost) return true;

  // On a shared hosting parent, other customers live on sibling subdomains —
  // an exact match is the only safe answer.
  if (SHARED_HOSTING_SUFFIXES.has(projectHost)) return false;

  return candidateHost.endsWith(`.${projectHost}`);
}

/**
 * Whether a CMS-returned URL may be recorded as a Content public URL.
 *
 * Stricter than isHostWithinProjectDomain alone: the value must also be an
 * absolute https URL, because that is what a real public page URL looks like
 * and what every publishing destination is already required to be. A
 * provider response is never trusted merely because the provider returned it.
 *
 * No DNS lookup here by design — the destination was already SSRF-checked
 * before the request was sent, and this URL is only being recorded, not
 * fetched.
 */
export function isRecordablePublicUrl(rawUrl: string | null | undefined, projectDomain: string | null | undefined): boolean {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  return isHostWithinProjectDomain(parsed.href, projectDomain);
}
