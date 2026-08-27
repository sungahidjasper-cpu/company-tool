import { describe, expect, it } from "vitest";

import { contentBriefSectionsSchema } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import {
  buildContentBriefOutputSchema,
  externalSourceSchema,
  internalLinkSchema,
  normalizeArray,
  normalizeInternalLinkSuggestions,
  sourceReferenceSchema,
} from "@/features/ai-workspace/schemas/content-brief-output-builder";

const ALL_ON = contentBriefSectionsSchema.parse({
  faq: true,
  conclusion: true,
  cta: true,
  keyTakeaways: true,
  internalLinks: true,
  externalSources: true,
  schemaSuggestions: true,
  statistics: true,
  examples: true,
});

const ALL_OFF = contentBriefSectionsSchema.parse({
  faq: false,
  conclusion: false,
  cta: false,
  keyTakeaways: false,
  internalLinks: false,
  externalSources: false,
  schemaSuggestions: false,
  statistics: false,
  examples: false,
});

describe("buildContentBriefOutputSchema", () => {
  it("always includes the base fields regardless of toggles", () => {
    const schema = buildContentBriefOutputSchema(ALL_OFF);
    const keys = Object.keys(schema.shape);
    for (const base of ["title", "metaTitle", "metaDescription", "outline", "suggestedHeadings", "seoRecommendations", "geoAeoNotes", "suggestedSearchIntent"]) {
      expect(keys).toContain(base);
    }
  });

  it("omits every modular field when every section is disabled", () => {
    const schema = buildContentBriefOutputSchema(ALL_OFF);
    const keys = Object.keys(schema.shape);
    for (const modular of ["internalLinkSuggestions", "externalSources", "faq", "conclusion", "ctaPlacementSuggestion", "keyTakeaways", "schemaSuggestions", "statistics", "examples"]) {
      expect(keys).not.toContain(modular);
    }
  });

  it("includes every modular field when every section is enabled", () => {
    const schema = buildContentBriefOutputSchema(ALL_ON);
    const keys = Object.keys(schema.shape);
    for (const modular of ["internalLinkSuggestions", "externalSources", "faq", "conclusion", "ctaPlacementSuggestion", "keyTakeaways", "schemaSuggestions", "statistics", "examples"]) {
      expect(keys).toContain(modular);
    }
  });

  it("includes exactly one modular field when exactly one section is enabled", () => {
    const schema = buildContentBriefOutputSchema({ ...ALL_OFF, faq: true });
    const keys = Object.keys(schema.shape);
    expect(keys).toContain("faq");
    expect(keys).not.toContain("externalSources");
    expect(keys).not.toContain("conclusion");
  });

  it("never includes a raw CTA-copy field, regardless of the cta toggle — only ctaPlacementSuggestion", () => {
    const schema = buildContentBriefOutputSchema({ ...ALL_OFF, cta: true });
    const keys = Object.keys(schema.shape);
    expect(keys).toContain("ctaPlacementSuggestion");
    expect(keys).not.toContain("cta");
    expect(keys).not.toContain("ctaCopy");
  });

  it("[Phase 30 Stage 4] omits sourcesReferenced when no knowledge-source context flag is passed", () => {
    const schema = buildContentBriefOutputSchema(ALL_ON);
    expect(Object.keys(schema.shape)).not.toContain("sourcesReferenced");
  });

  it("[Phase 30 Stage 4] omits sourcesReferenced when hasKnowledgeSourceContext is explicitly false", () => {
    const schema = buildContentBriefOutputSchema(ALL_ON, false);
    expect(Object.keys(schema.shape)).not.toContain("sourcesReferenced");
  });

  it("[Phase 30 Stage 4] includes sourcesReferenced only when hasKnowledgeSourceContext is true, independent of every section toggle", () => {
    const schema = buildContentBriefOutputSchema(ALL_OFF, true);
    expect(Object.keys(schema.shape)).toContain("sourcesReferenced");
  });
});

describe("sourceReferenceSchema", () => {
  it("[Phase 30 Stage 4] requires a title", () => {
    const result = sourceReferenceSchema.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(false);
  });

  it("[Phase 30 Stage 4] accepts a null url", () => {
    const result = sourceReferenceSchema.safeParse({ title: "Google Search Central", url: null });
    expect(result.success).toBe(true);
  });

  it("[Phase 30 Stage 4] accepts a string url", () => {
    const result = sourceReferenceSchema.safeParse({ title: "Google Search Central", url: "https://developers.google.com/search" });
    expect(result.success).toBe(true);
  });

  it("[Phase 30 Stage 4] rejects a missing url entirely (must be explicitly string or null)", () => {
    const result = sourceReferenceSchema.safeParse({ title: "Google Search Central" });
    expect(result.success).toBe(false);
  });
});

describe("externalSourceSchema", () => {
  it("has no url field — the model can never populate a URL it cannot verify", () => {
    expect(Object.keys(externalSourceSchema.shape)).toEqual(["type", "name", "description"]);
  });

  it("rejects an entry with an unknown source type", () => {
    const result = externalSourceSchema.safeParse({ type: "BLOG", name: "Random blog", description: "x" });
    expect(result.success).toBe(false);
  });
});

describe("normalizeInternalLinkSuggestions", () => {
  it("converts a legacy bare string into a structured suggestion with only anchorText populated", () => {
    const result = normalizeInternalLinkSuggestions(["Link to the services page"]);
    expect(result).toEqual([{ anchorText: "Link to the services page", targetPage: "", reason: "", placement: "", priority: "MEDIUM" }]);
  });

  it("passes through an already-structured suggestion unchanged", () => {
    const structured = { anchorText: "our pricing", targetPage: "/pricing", reason: "relevant", placement: "conclusion", priority: "HIGH" as const };
    expect(normalizeInternalLinkSuggestions([structured])).toEqual([structured]);
  });

  it("drops a malformed structured entry rather than throwing", () => {
    expect(normalizeInternalLinkSuggestions([{ anchorText: "ok" }, "valid legacy string", 42])).toEqual([
      { anchorText: "valid legacy string", targetPage: "", reason: "", placement: "", priority: "MEDIUM" },
    ]);
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeInternalLinkSuggestions(undefined)).toEqual([]);
    expect(normalizeInternalLinkSuggestions(null)).toEqual([]);
  });

  it("drops empty-string legacy entries rather than producing a blank suggestion", () => {
    expect(normalizeInternalLinkSuggestions(["", "  ", "real anchor"])).toEqual([
      { anchorText: "real anchor", targetPage: "", reason: "", placement: "", priority: "MEDIUM" },
    ]);
  });
});

describe("normalizeArray", () => {
  it("returns validated items and falls back to [] for non-array input", () => {
    expect(normalizeArray(internalLinkSchema, undefined)).toEqual([]);
    const valid = [{ anchorText: "a", targetPage: "b", reason: "c", placement: "d", priority: "LOW" as const }];
    expect(normalizeArray(internalLinkSchema, valid)).toEqual(valid);
  });

  it("falls back to [] when any item fails schema validation, rather than throwing", () => {
    expect(normalizeArray(internalLinkSchema, [{ anchorText: "a" }])).toEqual([]);
  });
});
