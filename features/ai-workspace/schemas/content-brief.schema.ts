import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { optionalString } from "@/lib/zod-helpers";
import { externalSourceSchema, faqItemSchema, internalLinkSchema } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import { contentBriefSettingsSchema } from "@/features/ai-workspace/schemas/content-brief-settings.schema";

export const CONTENT_BRIEF_TYPES = ["BLOG_POST", "LANDING_PAGE", "PILLAR_PAGE", "OTHER"] as const;
export type ContentBriefType = (typeof CONTENT_BRIEF_TYPES)[number];

/**
 * The generation-form input — a plain form-validated shape (regular zod,
 * matching content.schema.ts's convention), distinct from the AI's own
 * output shape below (zod/v4, required by generateStructuredOutput).
 */
export const contentBriefInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project"),
  keywordId: optionalString(),
  contentType: z.enum(CONTENT_BRIEF_TYPES),
  notes: optionalString(),
  /** Phase 21 — optional so a caller that omits it reproduces Phase 20's fixed-shape behavior exactly (see DEFAULT_CONTENT_BRIEF_SETTINGS). */
  settings: contentBriefSettingsSchema.optional(),
});

export type ContentBriefInput = z.infer<typeof contentBriefInputSchema>;

/**
 * The AI's structured-output shape (zod/v4 — generateStructuredOutput
 * requires it, same reason seo-audit.schema.ts's schemas do). Every field
 * is display-only text/string-arrays; nothing here needs its own DB column
 * (see Content.aiBriefDetails), so this schema is intentionally flat rather
 * than mirroring seo-audit.schema.ts's nested factor objects.
 *
 * This is the CANONICAL shape used everywhere a brief is passed around
 * (review UI, save actions, long-form context, job validation) — a superset
 * of whatever a single generation request actually asked the model for.
 * Phase 21's modular sections (below `suggestedSearchIntent`) are all
 * optional/defaulted so a pre-Phase-21 saved row (missing every one of
 * these keys) and a narrow single-section regeneration result both still
 * validate against this same schema. The actual per-request generation
 * schema is narrower — see content-brief-output-builder.ts's
 * buildContentBriefOutputSchema, whose result is always a valid subset of
 * this one.
 */
export const contentBriefOutputSchema = zv4.object({
  title: zv4.string(),
  metaTitle: zv4.string(),
  metaDescription: zv4.string(),
  outline: zv4.array(zv4.string()),
  suggestedHeadings: zv4.array(zv4.string()),
  internalLinkSuggestions: zv4.array(internalLinkSchema).default([]),
  seoRecommendations: zv4.array(zv4.string()),
  geoAeoNotes: zv4.string(),
  suggestedSearchIntent: zv4.string(),
  conclusion: zv4.string().default(""),
  ctaPlacementSuggestion: zv4.string().default(""),
  externalSources: zv4.array(externalSourceSchema).default([]),
  faq: zv4.array(faqItemSchema).default([]),
  keyTakeaways: zv4.array(zv4.string()).default([]),
  schemaSuggestions: zv4.array(zv4.string()).default([]),
  statistics: zv4.array(zv4.string()).default([]),
  examples: zv4.array(zv4.string()).default([]),
});

export type ContentBriefOutput = zv4.infer<typeof contentBriefOutputSchema>;
