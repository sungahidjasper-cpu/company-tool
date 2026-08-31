import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { optionalString } from "@/lib/zod-helpers";

/**
 * The generation-form input — a plain form-validated shape (regular zod),
 * matching content-brief.schema.ts's own v3-input/v4-output split.
 * contentId is optional: with it, the model grounds its recommendations in
 * one specific existing page; without it, it recommends schema markup for
 * the business/website in general.
 */
export const schemaMarkupInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project"),
  contentId: optionalString(),
  notes: optionalString(),
});

export type SchemaMarkupInput = z.infer<typeof schemaMarkupInputSchema>;

/**
 * One recommended schema.org type, independently defined here rather than
 * imported from features/seo/schemas/seo-audit.schema.ts's (unexported)
 * structuredDataRecommendationSchema — that file is part of the Phase 30
 * Website Analysis grounding work and is left untouched; this is the same
 * {schemaType, reasoning, exampleJsonLd} shape, reused as a pattern, not as
 * a code dependency.
 */
export const schemaMarkupRecommendationSchema = zv4.object({
  schemaType: zv4.string(),
  reasoning: zv4.string(),
  exampleJsonLd: zv4.string(),
});
export type SchemaMarkupRecommendation = zv4.infer<typeof schemaMarkupRecommendationSchema>;

/**
 * The AI's structured-output shape (zod/v4 — generateStructuredOutput
 * requires it). Wrapped in a `recommendations` object rather than a bare
 * top-level array, matching every other AI Workspace output schema's shape
 * (content-brief.schema.ts, long-form-content.schema.ts).
 */
export const schemaMarkupOutputSchema = zv4.object({
  recommendations: zv4.array(schemaMarkupRecommendationSchema).default([]),
});
export type SchemaMarkupOutput = zv4.infer<typeof schemaMarkupOutputSchema>;
