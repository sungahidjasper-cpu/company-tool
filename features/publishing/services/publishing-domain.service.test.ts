import { describe, expect, it } from "vitest";

import {
  isHostWithinProjectDomain,
  isRecordablePublicUrl,
  SHARED_HOSTING_SUFFIXES,
  toComparableHost,
} from "@/features/publishing/services/publishing-domain.service";

/**
 * Phase F.3 — the security boundary that decides whether a URL belongs to an
 * SEO project. Both the "may this destination publish this project's content"
 * check and the "may this CMS-returned URL become Content.url" check rest on
 * these functions, so the negative cases matter more than the positive ones.
 */

describe("toComparableHost — normalization", () => {
  it("1. reduces a bare project hostname (the most common real value)", () => {
    expect(toComparableHost("acme-plumbing.example.com")).toBe("acme-plumbing.example.com");
  });

  it("2. reduces a full https project URL with www and a trailing slash (the other real value in our data)", () => {
    expect(toComparableHost("https://www.storagemoguls.com/")).toBe("www.storagemoguls.com");
  });

  it("3. lowercases the host", () => {
    expect(toComparableHost("HTTPS://BLOG.Example.COM/Path")).toBe("blog.example.com");
  });

  it("4. drops a trailing dot (the fully-qualified form)", () => {
    expect(toComparableHost("example.com.")).toBe("example.com");
    expect(toComparableHost("https://blog.example.com./x")).toBe("blog.example.com");
  });

  it("5. ignores the port — uses hostname, never host", () => {
    expect(toComparableHost("https://blog.example.com:8443/x")).toBe("blog.example.com");
  });

  it("6. ignores path, query and fragment", () => {
    expect(toComparableHost("https://example.com/a/b?c=d#e")).toBe("example.com");
  });

  it("7. parses userinfo correctly rather than string-matching it — this is why raw string comparison is unsafe", () => {
    expect(toComparableHost("https://example.com@evil.com/")).toBe("evil.com");
  });

  it("8. fails closed on malformed or empty input", () => {
    for (const value of ["", "   ", null, undefined, "http://", "::::"]) {
      expect(toComparableHost(value as string)).toBeNull();
    }
  });

  it("9. converts internationalised domains to punycode consistently", () => {
    expect(toComparableHost("café.com")).toBe("xn--caf-dma.com");
  });
});

describe("isHostWithinProjectDomain — allowed cases", () => {
  it("10. exact host", () => {
    expect(isHostWithinProjectDomain("https://example.com", "example.com")).toBe(true);
  });

  it("11. www connection against a bare project domain", () => {
    expect(isHostWithinProjectDomain("https://www.example.com", "example.com")).toBe(true);
  });

  it("12. apex connection against a www project domain — www is stripped from the project side", () => {
    expect(isHostWithinProjectDomain("https://example.com", "https://www.example.com/")).toBe(true);
  });

  it("13. genuine subdomains", () => {
    expect(isHostWithinProjectDomain("https://blog.example.com", "example.com")).toBe(true);
    expect(isHostWithinProjectDomain("https://shop.example.com", "example.com")).toBe(true);
  });

  it("14. nested subdomain", () => {
    expect(isHostWithinProjectDomain("https://a.b.example.com", "example.com")).toBe(true);
  });

  it("15. uppercase, trailing slash, port and trailing dot all still match", () => {
    expect(isHostWithinProjectDomain("https://BLOG.Example.COM:8443/x/", "EXAMPLE.com.")).toBe(true);
  });

  it("16. the real Storage Moguls project shape matches its own apex and subdomains", () => {
    const projectDomain = "https://www.storagemoguls.com/";
    expect(isHostWithinProjectDomain("https://www.storagemoguls.com/blog/post", projectDomain)).toBe(true);
    expect(isHostWithinProjectDomain("https://storagemoguls.com", projectDomain)).toBe(true);
    expect(isHostWithinProjectDomain("https://blog.storagemoguls.com", projectDomain)).toBe(true);
  });
});

describe("isHostWithinProjectDomain — attacks and rejections", () => {
  it("17. ATTACK prefix-suffix: evil-example.com is NOT inside example.com (a bare endsWith would wrongly allow this)", () => {
    expect(isHostWithinProjectDomain("https://evil-example.com", "example.com")).toBe(false);
  });

  it("18. ATTACK bare suffix: notexample.com is NOT inside example.com (a bare endsWith would wrongly allow this too)", () => {
    expect(isHostWithinProjectDomain("https://notexample.com", "example.com")).toBe(false);
  });

  it("19. ATTACK deceptive suffix: example.com.evil.com is NOT inside example.com", () => {
    expect(isHostWithinProjectDomain("https://example.com.evil.com", "example.com")).toBe(false);
    expect(isHostWithinProjectDomain("https://www.example.com.evil.com", "example.com")).toBe(false);
  });

  it("20. ATTACK userinfo: https://example.com@evil.com/ resolves to evil.com and is rejected", () => {
    expect(isHostWithinProjectDomain("https://example.com@evil.com/", "example.com")).toBe(false);
  });

  it("21. an unrelated domain is rejected", () => {
    expect(isHostWithinProjectDomain("https://anothercompany.com", "example.com")).toBe(false);
  });

  it("22. a homograph lookalike punycodes differently and fails closed", () => {
    expect(isHostWithinProjectDomain("https://exаmple.com", "example.com")).toBe(false);
  });

  it("23. a malformed project domain fails closed — never 'no restriction'", () => {
    for (const bad of ["", "   ", null, undefined, "http://"]) {
      expect(isHostWithinProjectDomain("https://example.com", bad as string)).toBe(false);
    }
  });

  it("24. a malformed candidate fails closed", () => {
    for (const bad of ["", "   ", null, undefined]) {
      expect(isHostWithinProjectDomain(bad as string, "example.com")).toBe(false);
    }
  });

  it("25. MINIMUM LABELS: a single-label project domain can never make every site internal", () => {
    expect(isHostWithinProjectDomain("https://someone-elses-site.com", "com")).toBe(false);
    expect(isHostWithinProjectDomain("https://com", "com")).toBe(false);
  });
});

describe("isHostWithinProjectDomain — shared hosting protection", () => {
  it("26. WORDPRESS CASE: another customer's wordpress.com subdomain is NOT inside a wordpress.com project", () => {
    expect(isHostWithinProjectDomain("https://someone-elses-blog.wordpress.com", "wordpress.com")).toBe(false);
  });

  it("27. the project's own exact shared host still matches", () => {
    expect(isHostWithinProjectDomain("https://wordpress.com", "wordpress.com")).toBe(true);
  });

  it("28. a project ON a shared host keeps full use of its own subdomain", () => {
    // The project domain is the customer's own subdomain, not the shared parent.
    expect(isHostWithinProjectDomain("https://mysite.wordpress.com", "mysite.wordpress.com")).toBe(true);
    expect(isHostWithinProjectDomain("https://someone-else.wordpress.com", "mysite.wordpress.com")).toBe(false);
  });

  it("29. every listed shared suffix rejects a sibling customer subdomain", () => {
    for (const suffix of SHARED_HOSTING_SUFFIXES) {
      expect(isHostWithinProjectDomain(`https://someone-else.${suffix}`, suffix)).toBe(false);
    }
  });

  it("30. the shared list covers the WordPress hosted and staging cases, since WordPress is the only provider", () => {
    expect(SHARED_HOSTING_SUFFIXES.has("wordpress.com")).toBe(true);
    expect(SHARED_HOSTING_SUFFIXES.has("wpcomstaging.com")).toBe(true);
  });

  it("31. an ordinary domain is unaffected by the shared-host rule", () => {
    expect(isHostWithinProjectDomain("https://blog.example.com", "example.com")).toBe(true);
  });
});

describe("isRecordablePublicUrl — what may become Content.url", () => {
  it("32. accepts an absolute https URL on the project's own domain", () => {
    expect(isRecordablePublicUrl("https://www.example.com/blog/my-post/", "example.com")).toBe(true);
  });

  it("33. accepts a URL on a genuine subdomain", () => {
    expect(isRecordablePublicUrl("https://blog.example.com/my-post", "example.com")).toBe(true);
  });

  it("34. REJECTS http:// — a public page URL must be https, matching what destinations already require", () => {
    expect(isRecordablePublicUrl("http://www.example.com/post", "example.com")).toBe(false);
  });

  it("35. REJECTS a relative path — the value must be absolute", () => {
    expect(isRecordablePublicUrl("/blog/my-post", "example.com")).toBe(false);
  });

  it("36. REJECTS a URL on an unrelated domain, even though the CMS returned it", () => {
    expect(isRecordablePublicUrl("https://evil.com/post", "example.com")).toBe(false);
  });

  it("37. REJECTS the deceptive-suffix and userinfo forms", () => {
    expect(isRecordablePublicUrl("https://example.com.evil.com/post", "example.com")).toBe(false);
    expect(isRecordablePublicUrl("https://example.com@evil.com/post", "example.com")).toBe(false);
  });

  it("38. REJECTS a non-http(s) scheme", () => {
    expect(isRecordablePublicUrl("javascript:alert(1)", "example.com")).toBe(false);
    expect(isRecordablePublicUrl("ftp://example.com/x", "example.com")).toBe(false);
  });

  it("39. REJECTS malformed or empty values", () => {
    for (const bad of ["", "   ", null, undefined, "not a url"]) {
      expect(isRecordablePublicUrl(bad as string, "example.com")).toBe(false);
    }
  });

  it("40. REJECTS everything when the project domain itself is unusable", () => {
    expect(isRecordablePublicUrl("https://example.com/post", "")).toBe(false);
  });
});
