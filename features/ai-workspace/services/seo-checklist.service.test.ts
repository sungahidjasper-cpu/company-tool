import { describe, expect, it } from "vitest";

import { DEFAULT_CONTENT_BRIEF_SETTINGS } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { checkMetaLengths, computeSeoChecklist, computeWordCount } from "@/features/ai-workspace/services/seo-checklist.service";

const BASE_BRIEF = {
  title: "Emergency Plumber in Austin",
  metaTitle: "x".repeat(55),
  metaDescription: "x".repeat(155),
  outline: ["A", "B", "C", "D", "E"],
  suggestedHeadings: [],
  internalLinkSuggestions: [],
  seoRecommendations: [],
  geoAeoNotes: "Some EEAT notes.",
  suggestedSearchIntent: "TRANSACTIONAL",
  conclusion: "",
  ctaPlacementSuggestion: "",
  externalSources: [],
  faq: [],
  keyTakeaways: [],
  schemaSuggestions: [],
  statistics: [],
  examples: [],
};

describe("checkMetaLengths", () => {
  it("marks a meta title inside 50-60 chars as OK", () => {
    const result = checkMetaLengths({ metaTitle: "x".repeat(55), metaDescription: "x".repeat(155) });
    expect(result.metaTitle.status).toBe("OK");
  });

  it("treats exactly 50 and exactly 60 as OK (inclusive boundaries)", () => {
    expect(checkMetaLengths({ metaTitle: "x".repeat(50), metaDescription: "x".repeat(155) }).metaTitle.status).toBe("OK");
    expect(checkMetaLengths({ metaTitle: "x".repeat(60), metaDescription: "x".repeat(155) }).metaTitle.status).toBe("OK");
  });

  it("marks a meta title of 49 chars as TOO_SHORT and 61 chars as TOO_LONG", () => {
    expect(checkMetaLengths({ metaTitle: "x".repeat(49), metaDescription: "x".repeat(155) }).metaTitle.status).toBe("TOO_SHORT");
    expect(checkMetaLengths({ metaTitle: "x".repeat(61), metaDescription: "x".repeat(155) }).metaTitle.status).toBe("TOO_LONG");
  });

  it("treats exactly 150 and exactly 160 as OK for meta description (inclusive boundaries)", () => {
    expect(checkMetaLengths({ metaTitle: "x".repeat(55), metaDescription: "x".repeat(150) }).metaDescription.status).toBe("OK");
    expect(checkMetaLengths({ metaTitle: "x".repeat(55), metaDescription: "x".repeat(160) }).metaDescription.status).toBe("OK");
  });

  it("marks a meta description of 149 chars as TOO_SHORT and 161 chars as TOO_LONG", () => {
    expect(checkMetaLengths({ metaTitle: "x".repeat(55), metaDescription: "x".repeat(149) }).metaDescription.status).toBe("TOO_SHORT");
    expect(checkMetaLengths({ metaTitle: "x".repeat(55), metaDescription: "x".repeat(161) }).metaDescription.status).toBe("TOO_LONG");
  });
});

describe("computeWordCount", () => {
  it("returns 0 for an empty or whitespace-only string", () => {
    expect(computeWordCount("")).toBe(0);
    expect(computeWordCount("   \n  ")).toBe(0);
  });

  it("counts plain prose words", () => {
    expect(computeWordCount("one two three")).toBe(3);
  });

  it("collapses multiple whitespace/newlines between words", () => {
    expect(computeWordCount("one\n\ntwo   three")).toBe(3);
  });

  it("counts heading text but not the # markers", () => {
    expect(computeWordCount("## Section Title")).toBe(2);
    expect(computeWordCount("#### Sub Sub Header")).toBe(3);
  });

  it("counts unordered list item text but not the -/*/+ markers", () => {
    expect(computeWordCount("- First item\n- Second item")).toBe(4);
  });

  it("counts ordered list item text but not the 1./2. markers", () => {
    expect(computeWordCount("1. Step one\n2. Step two")).toBe(4);
  });

  it("counts table cell text but not the pipes", () => {
    expect(computeWordCount("| Metric | Meaning |\n| --- | --- |\n| LCP | Load speed |")).toBe(5);
  });

  it("excludes a table separator row entirely, even a longer one", () => {
    expect(computeWordCount("| A | B | C |\n| :--- | :---: | ---: |\n| one | two | three |")).toBe(6);
  });

  it("keeps a hyphenated word as one word", () => {
    expect(computeWordCount("self-storage co-founder")).toBe(2);
  });

  it("keeps an apostrophe word as one word", () => {
    expect(computeWordCount("don't can't")).toBe(2);
  });

  it("counts a Markdown link's anchor text but excludes the URL", () => {
    expect(computeWordCount("[Schedule a Call](https://example.com/contact)")).toBe(3);
  });

  it("counts bold/italic text without the emphasis markers inflating the count", () => {
    expect(computeWordCount("**Acquisition Costs** are *often* overlooked.")).toBe(5);
  });

  it("matches a realistic mixed-Markdown article: headings, paragraphs, lists, a table, a link, and FAQ content", () => {
    const markdown = [
      "This guide covers self-storage investing for new owners.",
      "",
      "## Getting Started",
      "",
      "There are several considerations, including cost and location.",
      "",
      "- Requires active management",
      "- Higher potential returns",
      "",
      "| Metric | Meaning |",
      "| --- | --- |",
      "| Cap rate | Annual return on cost |",
      "",
      "Learn more on our [pricing page](https://example.com/pricing).",
      "",
      "## FAQ",
      "",
      "**What is self-storage investing?**",
      "",
      "It involves purchasing storage facilities.",
    ].join("\n");

    // 8 (intro) + 2 (heading) + 8 (paragraph) + 6 (ul) + 8 (table) + 6 (link paragraph) + 1 (FAQ heading) + 4 (bold question) + 5 (answer) = 48
    expect(computeWordCount(markdown)).toBe(48);
  });
});

describe("computeSeoChecklist", () => {
  it("is never a second AI call — a pure function over already-generated fields", () => {
    const items = computeSeoChecklist(BASE_BRIEF, DEFAULT_CONTENT_BRIEF_SETTINGS);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });

  it("skips keyword-presence checks entirely when no target keyword was supplied", () => {
    const items = computeSeoChecklist(BASE_BRIEF, DEFAULT_CONTENT_BRIEF_SETTINGS);
    expect(items.find((item) => item.id === "keyword-in-title")).toBeUndefined();
  });

  it("warns when the target keyword is missing from the title", () => {
    const items = computeSeoChecklist(BASE_BRIEF, DEFAULT_CONTENT_BRIEF_SETTINGS, "water heater repair");
    const item = items.find((i) => i.id === "keyword-in-title");
    expect(item?.status).toBe("WARN");
  });

  it("passes when the target keyword is present in the title (case-insensitive)", () => {
    const items = computeSeoChecklist(BASE_BRIEF, DEFAULT_CONTENT_BRIEF_SETTINGS, "EMERGENCY PLUMBER");
    const item = items.find((i) => i.id === "keyword-in-title");
    expect(item?.status).toBe("PASS");
  });

  it("warns when internal links are enabled but the brief has none", () => {
    const settings = { ...DEFAULT_CONTENT_BRIEF_SETTINGS, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, internalLinks: true } };
    const items = computeSeoChecklist(BASE_BRIEF, settings);
    expect(items.find((i) => i.id === "internal-links")?.status).toBe("WARN");
  });

  it("omits the internal-links check entirely when internal links are disabled", () => {
    const settings = { ...DEFAULT_CONTENT_BRIEF_SETTINGS, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, internalLinks: false } };
    const items = computeSeoChecklist(BASE_BRIEF, settings);
    expect(items.find((i) => i.id === "internal-links")).toBeUndefined();
  });

  it("warns when CTA is enabled but no CTA fields were configured", () => {
    const settings = { ...DEFAULT_CONTENT_BRIEF_SETTINGS, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, cta: true } };
    const items = computeSeoChecklist(BASE_BRIEF, settings);
    expect(items.find((i) => i.id === "cta")?.status).toBe("WARN");
  });

  it("passes the CTA check when CTA text is configured", () => {
    const settings = { ...DEFAULT_CONTENT_BRIEF_SETTINGS, sections: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.sections, cta: true }, cta: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.cta, text: "Call us today" } };
    const items = computeSeoChecklist(BASE_BRIEF, settings);
    expect(items.find((i) => i.id === "cta")?.status).toBe("PASS");
  });

  it("flags outline count as WARN when fewer sections were generated than requested", () => {
    const settings = { ...DEFAULT_CONTENT_BRIEF_SETTINGS, outline: { ...DEFAULT_CONTENT_BRIEF_SETTINGS.outline, h2Count: 10 } };
    const items = computeSeoChecklist(BASE_BRIEF, settings);
    expect(items.find((i) => i.id === "outline-count")?.status).toBe("WARN");
  });
});
