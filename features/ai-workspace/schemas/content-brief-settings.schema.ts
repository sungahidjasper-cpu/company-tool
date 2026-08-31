import { z } from "zod";

import { optionalEmail, optionalString, optionalUrl } from "@/lib/zod-helpers";

/** Mirrors prisma's KeywordIntent enum values exactly — not a parallel enum, just a plain-zod copy since this form schema can't import a Prisma enum type directly the way the AI output schemas do. */
export const CONTENT_BRIEF_SEARCH_INTENTS = ["INFORMATIONAL", "NAVIGATIONAL", "COMMERCIAL", "TRANSACTIONAL"] as const;
export type ContentBriefSearchIntent = (typeof CONTENT_BRIEF_SEARCH_INTENTS)[number];

export const WORD_COUNT_TARGETS = [800, 1500, 2500, 5000] as const;
export type WordCountTarget = (typeof WORD_COUNT_TARGETS)[number];

export const READING_LEVELS = ["GENERAL", "INTERMEDIATE", "ADVANCED", "TECHNICAL"] as const;
export type ReadingLevel = (typeof READING_LEVELS)[number];

export const BRAND_VOICES = [
  "PROFESSIONAL",
  "CORPORATE",
  "FRIENDLY",
  "TECHNICAL",
  "LUXURY",
  "MEDICAL",
  "LEGAL",
  "LOCAL_BUSINESS",
  "ECOMMERCE",
  "AGENCY",
] as const;
export type BrandVoice = (typeof BRAND_VOICES)[number];

export const FAQ_STYLES = ["PEOPLE_ALSO_ASK", "CONVERSATIONAL", "SCHEMA_READY"] as const;
export type FaqStyle = (typeof FAQ_STYLES)[number];

export const contentBriefSectionsSchema = z.object({
  faq: z.boolean().default(true),
  conclusion: z.boolean().default(true),
  cta: z.boolean().default(false),
  keyTakeaways: z.boolean().default(false),
  internalLinks: z.boolean().default(true),
  externalSources: z.boolean().default(true),
  schemaSuggestions: z.boolean().default(true),
  statistics: z.boolean().default(true),
  examples: z.boolean().default(true),
});
export type ContentBriefSections = z.infer<typeof contentBriefSectionsSchema>;

export const contentBriefOutlineControlsSchema = z.object({
  h2Count: z.number().int().min(2).max(12).default(5),
  h3Count: z.number().int().min(0).max(24).default(0),
  maxHeadingDepth: z.union([z.literal(2), z.literal(3)]).default(2),
  includeComparisonTable: z.boolean().default(false),
  includeChecklist: z.boolean().default(false),
  includeNumberedProcess: z.boolean().default(false),
  includeProsCons: z.boolean().default(false),
});
export type ContentBriefOutlineControls = z.infer<typeof contentBriefOutlineControlsSchema>;

export const contentBriefFaqConfigSchema = z.object({
  count: z.number().int().min(1).max(15).default(5),
  style: z.enum(FAQ_STYLES).default("PEOPLE_ALSO_ASK"),
});
export type ContentBriefFaqConfig = z.infer<typeof contentBriefFaqConfigSchema>;

/**
 * User-supplied only — never AI-generated. Threaded into the prompt purely
 * as placement guidance (see content-brief.service.ts's buildPrompt); the
 * model is never asked to write CTA copy, a phone number, or a URL itself.
 */
export const contentBriefCtaSchema = z.object({
  title: optionalString(),
  text: optionalString(),
  buttonText: optionalString(),
  url: optionalUrl(),
  phone: optionalString(),
  email: optionalEmail(),
});
export type ContentBriefCta = z.infer<typeof contentBriefCtaSchema>;

/** Extra long-form article output toggles (Phase 21 §13) — kept separate from `sections` since these apply only at article-generation time, not to the brief itself. */
export const contentDraftOptionsSchema = z.object({
  imagePlaceholders: z.boolean().default(false),
  altTextSuggestions: z.boolean().default(false),
  featuredImagePrompt: z.boolean().default(false),
  socialSnippets: z.boolean().default(false),
  excerpt: z.boolean().default(false),
});
export type ContentDraftOptions = z.infer<typeof contentDraftOptionsSchema>;

export const contentBriefQualityControlsSchema = z.object({
  avoidCliches: z.boolean().default(true),
  avoidKeywordStuffing: z.boolean().default(true),
  includeStatistics: z.boolean().default(true),
  includeDefinitions: z.boolean().default(true),
  includeEeatSignals: z.boolean().default(true),
  optimizeForFeaturedSnippets: z.boolean().default(true),
  optimizeForAiOverviews: z.boolean().default(true),
  optimizeForGeo: z.boolean().default(true),
  optimizeForAeo: z.boolean().default(true),
  optimizeForSemanticSeo: z.boolean().default(true),
});
export type ContentBriefQualityControls = z.infer<typeof contentBriefQualityControlsSchema>;

/**
 * The full generation-configuration shape (Phase 21 §1). Plain zod (v3),
 * form-validated, distinct from the AI output schemas in
 * content-brief-output-builder.ts (zod/v4) — same split content-brief.schema.ts
 * already established between contentBriefInputSchema and
 * contentBriefOutputSchema.
 */
export const contentBriefSettingsSchema = z.object({
  secondaryKeywords: z.array(z.string()).default([]),
  searchIntent: z.enum(CONTENT_BRIEF_SEARCH_INTENTS).optional(),
  targetCountry: optionalString(),
  language: optionalString(),
  brandName: optionalString(),
  competitorUrls: z.array(z.string()).default([]),
  /** Presence flips the prompt from "write new content" to "optimize this existing content." */
  existingUrl: optionalUrl(),

  wordCount: z.union([z.literal(800), z.literal(1500), z.literal(2500), z.literal(5000)]).default(1500),
  readingLevel: z.enum(READING_LEVELS).default("GENERAL"),
  brandVoice: z.enum(BRAND_VOICES).default("PROFESSIONAL"),

  sections: contentBriefSectionsSchema.default({}),
  outline: contentBriefOutlineControlsSchema.default({}),
  faqConfig: contentBriefFaqConfigSchema.default({}),
  cta: contentBriefCtaSchema.default({}),
  qualityControls: contentBriefQualityControlsSchema.default({}),
  draftOptions: contentDraftOptionsSchema.default({}),
});
export type ContentBriefSettings = z.infer<typeof contentBriefSettingsSchema>;

export const DEFAULT_CONTENT_BRIEF_SETTINGS: ContentBriefSettings = contentBriefSettingsSchema.parse({});

/**
 * Phase 30 Stage 11 — the requester-supplied context fields that both
 * content-brief.service.ts's buildPrompt and long-form-content.service.ts's
 * buildPrompt need identically. Extracted here (not left duplicated in one
 * of those two files, and not folded into content-brief.service.ts's own,
 * larger buildSettingsClauses) because before this stage, long-form
 * generation silently never saw secondaryKeywords/searchIntent/
 * targetCountry/language/brandName/competitorUrls at all — only the brief
 * stage did. `existingUrl` is deliberately excluded: it only reframes the
 * BRIEF's own scope ("optimize this existing page" vs. "write new content"),
 * and by the time long-form runs, that framing is already baked into the
 * approved brief it's given — restating it here would be redundant, not
 * missing context.
 */
export function buildSharedContextClauses(settings: ContentBriefSettings): string[] {
  const lines: string[] = [];

  if (settings.secondaryKeywords.length > 0) {
    lines.push(`Secondary keywords to naturally incorporate: ${settings.secondaryKeywords.join(", ")}.`);
  }
  if (settings.searchIntent) {
    lines.push(`Requested search intent: ${settings.searchIntent}.`);
  }
  if (settings.targetCountry) lines.push(`Target country/market: ${settings.targetCountry}.`);
  if (settings.language) lines.push(`Write in this language: ${settings.language}.`);
  if (settings.brandName) lines.push(`Brand name: ${settings.brandName}.`);
  if (settings.competitorUrls.length > 0) {
    lines.push(`Competitor pages to differentiate from (for context only — do not copy): ${settings.competitorUrls.join(", ")}.`);
  }

  return lines;
}
