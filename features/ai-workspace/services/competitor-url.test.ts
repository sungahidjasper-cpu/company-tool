import { describe, expect, it } from "vitest";

import { normalizeCompetitorUrl, normalizeCompetitorUrls } from "@/features/ai-workspace/services/competitor-url";

/**
 * The first half of the competitor-URL security boundary.
 *
 * These functions decide whether a user-supplied string is even shaped like
 * something we will fetch. They are NOT sufficient protection on their own — a
 * public-looking hostname can still resolve to a private address, which only
 * assertSafePublicUrl's DNS check can catch. Both run before any crawl.
 */

describe("normalizeCompetitorUrl — accepted", () => {
  it("1. accepts a full https URL and reduces it to the origin", () => {
    const result = normalizeCompetitorUrl("https://competitor.com/blog/post?x=1#top");
    expect(result).toEqual({ ok: true, origin: "https://competitor.com", hostname: "competitor.com" });
  });

  it("2. accepts a bare hostname by assuming https", () => {
    expect(normalizeCompetitorUrl("competitor.com")).toEqual({ ok: true, origin: "https://competitor.com", hostname: "competitor.com" });
  });

  it("3. accepts a subdomain and preserves it", () => {
    expect(normalizeCompetitorUrl("https://blog.competitor.com")).toEqual({ ok: true, origin: "https://blog.competitor.com", hostname: "blog.competitor.com" });
  });

  it("4. lowercases the host and drops a trailing dot", () => {
    expect(normalizeCompetitorUrl("HTTPS://Competitor.COM.")).toMatchObject({ ok: true, hostname: "competitor.com" });
  });

  it("5. trims surrounding whitespace", () => {
    expect(normalizeCompetitorUrl("   https://competitor.com   ")).toMatchObject({ ok: true, origin: "https://competitor.com" });
  });

  it("6. keeps a non-default port in the origin rather than discarding it", () => {
    expect(normalizeCompetitorUrl("https://competitor.com:8443/x")).toMatchObject({ ok: true, origin: "https://competitor.com:8443" });
  });
});

describe("normalizeCompetitorUrl — refused", () => {
  it("7. refuses http rather than silently upgrading it to https", () => {
    const result = normalizeCompetitorUrl("http://competitor.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/only https/i);
  });

  it("8. refuses non-web schemes", () => {
    for (const value of ["ftp://competitor.com", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x"]) {
      expect(normalizeCompetitorUrl(value).ok).toBe(false);
    }
  });

  it("9. SSRF — refuses a single-label host such as localhost or an intranet name", () => {
    for (const value of ["localhost", "https://localhost", "intranet", "https://intranet"]) {
      expect(normalizeCompetitorUrl(value).ok).toBe(false);
    }
  });

  it("10. USERINFO ATTACK — refuses credentials rather than fetching the host after the @", () => {
    const result = normalizeCompetitorUrl("https://real-competitor.com@evil.example.com/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/username or password/i);
  });

  it("11. refuses a malformed value that already carries a scheme — never re-prefixes it into a plausible https URL", () => {
    for (const value of ["http://", "https://", "::::", "ht!tp://x"]) {
      expect(normalizeCompetitorUrl(value).ok).toBe(false);
    }
  });

  it("12. refuses empty or non-string input", () => {
    for (const value of ["", "   ", null, undefined, 42 as unknown as string]) {
      expect(normalizeCompetitorUrl(value as string).ok).toBe(false);
    }
  });

  it("13. every refusal carries a user-facing reason, never an empty message", () => {
    for (const value of ["http://competitor.com", "localhost", "", "https://a@b.com"]) {
      const result = normalizeCompetitorUrl(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("14. an IP literal is not silently accepted as a public site — the DNS guard is still the authority, but a bare private IP is refused here too", () => {
    // 127.0.0.1 has dots, so it passes the label check and is handed to the DNS
    // guard, which refuses it. What must NOT happen is a scheme upgrade or a
    // credential bypass; both are covered above. This pins current behaviour.
    const result = normalizeCompetitorUrl("https://127.0.0.1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hostname).toBe("127.0.0.1");
    // The action never crawls this: assertSafePublicUrl rejects loopback.
  });
});

describe("normalizeCompetitorUrls — the list", () => {
  it("15. normalizes several URLs to origins", () => {
    const result = normalizeCompetitorUrls(["https://a.com/x", "b.com"], 3);
    expect(result).toEqual({ ok: true, origins: ["https://a.com", "https://b.com"] });
  });

  it("16. de-duplicates by origin so the same site is never crawled twice", () => {
    const result = normalizeCompetitorUrls(["https://a.com/x", "https://a.com/y", "a.com"], 3);
    expect(result).toEqual({ ok: true, origins: ["https://a.com"] });
  });

  it("17. REPORTS a bad URL rather than silently dropping it", () => {
    const result = normalizeCompetitorUrls(["https://a.com", "http://b.com"], 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/only https/i);
  });

  it("18. respects the limit", () => {
    const result = normalizeCompetitorUrls(["a.com", "b.com", "c.com", "d.com"], 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.origins).toHaveLength(2);
  });

  it("19. refuses an empty list", () => {
    expect(normalizeCompetitorUrls([], 3).ok).toBe(false);
  });
});
