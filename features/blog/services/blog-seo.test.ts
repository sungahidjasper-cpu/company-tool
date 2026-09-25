import { describe, expect, it } from "vitest";

import { markdownToHtml } from "@/features/ai-workspace/services/content-export.service";
import { SEO_DESCRIPTION_IDEAL, SEO_TITLE_IDEAL, bodyExcerpt, buildSearchPreview, guideLength, slugify } from "@/features/blog/services/blog-seo";

describe("length guidance", () => {
  it("1. reports an empty field as empty rather than as too short", () => {
    expect(guideLength("", SEO_TITLE_IDEAL, "SEO title").status).toBe("EMPTY");
    expect(guideLength("   ", SEO_TITLE_IDEAL, "SEO title").status).toBe("EMPTY");
  });

  it("2. flags short, good and long titles", () => {
    expect(guideLength("Too short", SEO_TITLE_IDEAL, "SEO title").status).toBe("SHORT");
    expect(guideLength("a".repeat(45), SEO_TITLE_IDEAL, "SEO title").status).toBe("GOOD");
    expect(guideLength("a".repeat(80), SEO_TITLE_IDEAL, "SEO title").status).toBe("LONG");
  });

  it("3. uses the description's own range, not the title's", () => {
    expect(guideLength("a".repeat(140), SEO_DESCRIPTION_IDEAL, "meta description").status).toBe("GOOD");
    expect(guideLength("a".repeat(140), SEO_TITLE_IDEAL, "SEO title").status).toBe("LONG");
  });

  it("4. always reports the real character count", () => {
    expect(guideLength("hello", SEO_TITLE_IDEAL, "SEO title").length).toBe(5);
  });

  it("5. the long message says what will happen, not just that it is long", () => {
    expect(guideLength("a".repeat(80), SEO_TITLE_IDEAL, "SEO title").message).toMatch(/truncate/i);
  });
});

describe("slugify", () => {
  it("6. makes a readable, URL-safe slug", () => {
    expect(slugify("Unlocking Self Storage Investments: Key Insights")).toBe("unlocking-self-storage-investments-key-insights");
  });

  it("7. collapses punctuation and trims stray separators", () => {
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
    expect(slugify("A — B")).toBe("a-b");
  });

  it("8. never returns anything needing escaping", () => {
    expect(slugify("Ünïcôde & <script>")).toMatch(/^[a-z0-9-]*$/);
  });

  it("9. caps the length and handles an empty title", () => {
    expect(slugify("word ".repeat(60)).length).toBeLessThanOrEqual(80);
    expect(slugify("")).toBe("");
  });
});

describe("search preview", () => {
  const base = { metaTitle: "", metaDescription: "", title: "Self storage tips", slug: "self-storage-tips", bodyExcerpt: "A practical guide.", siteDomain: "storagemoguls.com" };

  it("10. uses the SEO fields when they are filled in", () => {
    const preview = buildSearchPreview({ ...base, metaTitle: "Custom SEO title", metaDescription: "Custom description" });
    expect(preview.title).toBe("Custom SEO title");
    expect(preview.description).toBe("Custom description");
    expect(preview.usingFallbackTitle).toBe(false);
    expect(preview.usingFallbackDescription).toBe(false);
  });

  it("11. falls back to the article, and SAYS it is falling back", () => {
    const preview = buildSearchPreview(base);
    expect(preview.title).toBe("Self storage tips");
    expect(preview.description).toBe("A practical guide.");
    expect(preview.usingFallbackTitle).toBe(true);
    expect(preview.usingFallbackDescription).toBe(true);
  });

  it("12. builds the URL from the project domain and the slug", () => {
    expect(buildSearchPreview(base).url).toBe("storagemoguls.com/self-storage-tips");
  });

  it("13. tolerates a domain with a scheme or a trailing slash", () => {
    expect(buildSearchPreview({ ...base, siteDomain: "https://storagemoguls.com/" }).url).toBe("storagemoguls.com/self-storage-tips");
  });

  it("14. does not invent a domain it was not given", () => {
    expect(buildSearchPreview({ ...base, siteDomain: null }).url).toBe("example.com/self-storage-tips");
  });

  it("15. degrades honestly when there is nothing at all", () => {
    const preview = buildSearchPreview({ metaTitle: "", metaDescription: "", title: "", slug: "", bodyExcerpt: "", siteDomain: null });
    expect(preview.title).toBe("Untitled article");
    expect(preview.description).toBe("No description yet.");
  });
});

describe("bodyExcerpt", () => {
  it("16. takes the first real prose line, skipping headings and media", () => {
    const markdown = "# Title\n\n![alt](/api/files/a)\n\nThe first real sentence.\n\nMore.";
    expect(bodyExcerpt(markdown)).toBe("The first real sentence.");
  });

  it("17. strips Markdown decoration from what it shows", () => {
    expect(bodyExcerpt("This is **bold** and *italic* and `code`.")).toBe("This is bold and italic and code.");
  });

  it("18. keeps a link's text, not its syntax", () => {
    expect(bodyExcerpt("See [our guide](https://example.com) today.")).toBe("See our guide today.");
  });

  it("19. truncates politely", () => {
    const excerpt = bodyExcerpt("a".repeat(300));
    expect(excerpt.length).toBeLessThanOrEqual(180);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("20. returns nothing when the article has no prose yet", () => {
    expect(bodyExcerpt("# Only a heading")).toBe("");
    expect(bodyExcerpt("")).toBe("");
  });
});

describe("publishing keeps inline images", () => {
  it("21. an inline image publishes as a real img tag, not literal Markdown", () => {
    const html = markdownToHtml("![A storage unit](/api/files/abc)");
    expect(html).toBe('<img src="/api/files/abc" alt="A storage unit" />');
    expect(html).not.toContain("![");
  });

  it("22. a caption publishes as a figure with a figcaption", () => {
    expect(markdownToHtml('![Alt](/api/files/abc "The Reno site")')).toBe('<figure><img src="/api/files/abc" alt="Alt" /><figcaption>The Reno site</figcaption></figure>');
  });

  it("23. an unsafe image src is neutralized to its alt text", () => {
    const html = markdownToHtml("![Alt text](javascript:alert(1))");
    expect(html).not.toContain("<img");
    expect(html).toContain("Alt text");
  });

  it("24. quotes in alt text cannot break out of the attribute", () => {
    const html = markdownToHtml('![Say "hi" <b>](/api/files/abc)');
    expect(html).not.toMatch(/alt="[^"]*"[^/>]*"/);
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;b&gt;");
  });

  it("25. ordinary Markdown still publishes exactly as it did before", () => {
    expect(markdownToHtml("# Heading\n\nA paragraph.\n\n- one\n- two")).toBe("<h1>Heading</h1>\n<p>A paragraph.</p>\n<ul><li>one</li><li>two</li></ul>");
  });
});
