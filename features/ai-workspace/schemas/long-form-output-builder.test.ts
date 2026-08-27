import { describe, expect, it } from "vitest";

import { contentBriefSectionsSchema, contentDraftOptionsSchema } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { buildLongFormOutputSchema } from "@/features/ai-workspace/schemas/long-form-output-builder";

const ALL_SECTIONS_OFF = contentBriefSectionsSchema.parse({
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

const ALL_DRAFT_OPTIONS_OFF = contentDraftOptionsSchema.parse({
  imagePlaceholders: false,
  altTextSuggestions: false,
  featuredImagePrompt: false,
  socialSnippets: false,
  excerpt: false,
});

describe("buildLongFormOutputSchema", () => {
  it("always includes the base fields regardless of toggles", () => {
    const schema = buildLongFormOutputSchema(ALL_SECTIONS_OFF, ALL_DRAFT_OPTIONS_OFF);
    const keys = Object.keys(schema.shape);
    for (const base of ["introduction", "sections", "internalLinkPlacementSuggestions"]) {
      expect(keys).toContain(base);
    }
  });

  it("[Phase 30 Stage 4] omits sourcesReferenced when no knowledge-source context flag is passed", () => {
    const schema = buildLongFormOutputSchema(ALL_SECTIONS_OFF, ALL_DRAFT_OPTIONS_OFF);
    expect(Object.keys(schema.shape)).not.toContain("sourcesReferenced");
  });

  it("[Phase 30 Stage 4] omits sourcesReferenced when hasKnowledgeSourceContext is explicitly false", () => {
    const schema = buildLongFormOutputSchema(ALL_SECTIONS_OFF, ALL_DRAFT_OPTIONS_OFF, false);
    expect(Object.keys(schema.shape)).not.toContain("sourcesReferenced");
  });

  it("[Phase 30 Stage 4] includes sourcesReferenced only when hasKnowledgeSourceContext is true, independent of every other toggle", () => {
    const schema = buildLongFormOutputSchema(ALL_SECTIONS_OFF, ALL_DRAFT_OPTIONS_OFF, true);
    expect(Object.keys(schema.shape)).toContain("sourcesReferenced");
  });
});
