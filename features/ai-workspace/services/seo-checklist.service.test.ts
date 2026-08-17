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
  it("counts whitespace-separated words", () => {
    expect(computeWordCount("one two three")).toBe(3);
  });

  it("returns 0 for an empty or whitespace-only string", () => {
    expect(computeWordCount("")).toBe(0);
    expect(computeWordCount("   \n  ")).toBe(0);
  });

  it("collapses multiple whitespace/newlines between words", () => {
    expect(computeWordCount("one\n\ntwo   three")).toBe(3);
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
