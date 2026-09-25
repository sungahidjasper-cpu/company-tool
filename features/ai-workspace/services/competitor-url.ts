/**
 * Competitor URL normalization — the first half of the competitor-URL security
 * boundary.
 *
 * Pure functions only: no DNS, no network, no database. This decides whether a
 * user-supplied string is even *shaped* like a URL we are willing to fetch, and
 * reduces it to the exact origin the crawler will be given. The second half —
 * proving the host is not internal/private — is `assertSafePublicUrl` in
 * features/publishing/services/ssrf-guard.service.ts, which resolves DNS and is
 * NOT duplicated here.
 *
 * Both halves are required. This module alone must never be treated as
 * sufficient SSRF protection: a public-looking hostname can still resolve to a
 * private address, which only the DNS-resolving guard can catch.
 */

export type CompetitorUrlResult =
  | { ok: true; /** The origin the crawler will actually be given. */ origin: string; hostname: string }
  | { ok: false; reason: string };

/** Schemes we are willing to fetch. Anything else is refused rather than coerced. */
const ALLOWED_PROTOCOLS = new Set(["https:"]);

/**
 * Normalizes a user-supplied competitor URL to a safe origin, or explains why
 * it cannot be used.
 *
 * Deliberate choices:
 *
 * - A bare hostname gets an `https://` prefix so `competitor.com` works, but a
 *   value that already carries a scheme is never re-prefixed — that would turn
 *   a malformed or unsupported-scheme string into a plausible-looking https URL
 *   and silently change what gets fetched.
 * - Only https is accepted, matching the policy assertSafePublicUrl already
 *   enforces for every other outbound request in this app. http is refused with
 *   a specific message rather than being upgraded, because upgrading would be
 *   this code deciding to fetch something the user did not ask for.
 * - The result is the ORIGIN, not the full URL. crawlWebsite works from an
 *   origin (it loads that site's robots.txt and sitemap), so carrying a path
 *   here would imply a precision the crawler does not have.
 * - Credentials in the URL are refused outright: `https://real.com@evil.com/`
 *   parses to host `evil.com`, and silently accepting it would fetch a
 *   different site than the one the user appears to have typed.
 */
export function normalizeCompetitorUrl(raw: string | null | undefined): CompetitorUrlResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "Enter a competitor URL." };
  }
  const value = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // No scheme at all — try it as a bare hostname. A value that already
    // carries "://" and still failed to parse is malformed, not a hostname.
    if (value.includes("://")) {
      return { ok: false, reason: "That competitor URL could not be read. Enter a full address such as https://example.com." };
    }
    try {
      parsed = new URL(`https://${value}`);
    } catch {
      return { ok: false, reason: "That competitor URL could not be read. Enter a full address such as https://example.com." };
    }
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "Remove the username or password from the competitor URL." };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    if (parsed.protocol === "http:") {
      return { ok: false, reason: "Only https competitor URLs are supported. Enter the https:// address for this site." };
    }
    return { ok: false, reason: "Only https competitor URLs are supported." };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "" || !hostname.includes(".")) {
    // A single-label host (e.g. "localhost", "intranet") is never a public
    // competitor site. The DNS guard would also refuse it; refusing here gives
    // a clearer message and avoids a pointless lookup.
    return { ok: false, reason: "Enter a public competitor website address, such as https://example.com." };
  }

  return { ok: true, origin: parsed.origin, hostname };
}

/**
 * Normalizes a list of competitor URLs, de-duplicating by origin so the same
 * site is never crawled twice in one run. Returns the first failure rather than
 * silently dropping a bad entry — a URL the user typed that we cannot use
 * should be reported, not ignored.
 */
export function normalizeCompetitorUrls(raws: readonly string[], limit: number): { ok: true; origins: string[] } | { ok: false; reason: string } {
  const origins: string[] = [];
  const seen = new Set<string>();

  for (const raw of raws) {
    const result = normalizeCompetitorUrl(raw);
    if (!result.ok) return result;
    if (seen.has(result.origin)) continue;
    seen.add(result.origin);
    origins.push(result.origin);
    if (origins.length >= limit) break;
  }

  if (origins.length === 0) return { ok: false, reason: "Enter at least one competitor URL." };
  return { ok: true, origins };
}
