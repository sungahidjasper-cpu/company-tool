import { describe, expect, it } from "vitest";

import { formatBriefAsMarkdown, markdownToHtml } from "@/features/ai-workspace/services/content-export.service";

const BASE_BRIEF = {
  title: "Emergency Plumber in Austin",
  metaTitle: "Emergency Plumber Austin | Acme",
  metaDescription: "Fast 24/7 emergency plumbing in Austin.",
  outline: ["Introduction", "Signs of an emergency"],
  suggestedHeadings: ["What counts as an emergency?"],
  internalLinkSuggestions: [{ anchorText: "our services", targetPage: "/services", reason: "relevant", placement: "intro", priority: "MEDIUM" as const }],
  seoRecommendations: ["Use the keyword in the H1"],
  geoAeoNotes: "Use direct Q&A framing.",
  suggestedSearchIntent: "TRANSACTIONAL",
  conclusion: "Call us any time.",
  ctaPlacementSuggestion: "",
  externalSources: [{ type: "GOVERNMENT" as const, name: "CDC", description: "Cites public safety guidance." }],
  faq: [{ question: "Do you charge extra after hours?", answer: "No, our rate is flat." }],
  keyTakeaways: ["Act fast on burst pipes"],
  schemaSuggestions: [],
  statistics: [],
  examples: [],
  sourcesReferenced: [],
};

describe("formatBriefAsMarkdown", () => {
  it("includes the title, meta fields, and outline", () => {
    const markdown = formatBriefAsMarkdown(BASE_BRIEF);
    expect(markdown).toContain("# Emergency Plumber in Austin");
    expect(markdown).toContain("Emergency Plumber Austin | Acme");
    expect(markdown).toContain("- Introduction");
  });

  it("includes structured internal-link fields, never a fabricated URL", () => {
    const markdown = formatBriefAsMarkdown(BASE_BRIEF);
    expect(markdown).toContain("our services");
    expect(markdown).toContain("/services");
  });

  it("includes external sources by type/name/description only — never a url field", () => {
    const markdown = formatBriefAsMarkdown(BASE_BRIEF);
    expect(markdown).toContain("[GOVERNMENT] CDC");
    expect(markdown).toContain("Cites public safety guidance.");
  });

  it("omits a section entirely when its array is empty", () => {
    const markdown = formatBriefAsMarkdown({ ...BASE_BRIEF, faq: [] });
    expect(markdown).not.toContain("## FAQ");
  });

  it("includes the FAQ section when present", () => {
    const markdown = formatBriefAsMarkdown(BASE_BRIEF);
    expect(markdown).toContain("## FAQ");
    expect(markdown).toContain("Do you charge extra after hours?");
  });
});

describe("markdownToHtml", () => {
  it("converts a heading line to the matching <hN> tag", () => {
    expect(markdownToHtml("## Outline")).toBe("<h2>Outline</h2>");
    expect(markdownToHtml("# Title")).toBe("<h1>Title</h1>");
  });

  it("converts a '- item' list block into a <ul><li> list", () => {
    const html = markdownToHtml("- First\n- Second");
    expect(html).toBe("<ul><li>First</li><li>Second</li></ul>");
  });

  it("converts bold markdown to <strong>", () => {
    const html = markdownToHtml("**Meta title:** Something");
    expect(html).toContain("<strong>Meta title:</strong>");
  });

  it("converts a markdown link to an anchor tag", () => {
    const html = markdownToHtml("[Get a quote](https://example.com/contact)");
    expect(html).toContain('<a href="https://example.com/contact">Get a quote</a>');
  });

  it("neutralizes a javascript: link to plain text instead of rendering it as an anchor (previously identified issue)", () => {
    const html = markdownToHtml("[Click me](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Click me");
  });

  it("escapes a stray quote inside an otherwise-safe href so it can't break out of the attribute", () => {
    const html = markdownToHtml('[text](https://example.com/"onmouseover="evil)');
    expect(html).toContain('href="https://example.com/&quot;onmouseover=&quot;evil"');
  });

  it("escapes raw HTML-significant characters so injected markup can't break the page", () => {
    const html = markdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("wraps a plain paragraph block in <p>", () => {
    expect(markdownToHtml("Just a sentence.")).toBe("<p>Just a sentence.</p>");
  });
});
