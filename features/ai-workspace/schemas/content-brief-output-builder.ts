import { z as zv4 } from "zod/v4";

import type { ContentBriefSections } from "@/features/ai-workspace/schemas/content-brief-settings.schema";

export const EXTERNAL_SOURCE_TYPES = ["GOVERNMENT", "RESEARCH", "INDUSTRY_ASSOCIATION", "STATISTIC"] as const;

/**
 * Phase 21 §15 — the subset of fields regeneration currently supports.
 * Lives here (a plain schema module) rather than in content-brief.actions.ts
 * itself: a "use server" file may only export async functions, so a plain
 * constant array can't be exported from there directly.
 */
export const REGENERATE_BRIEF_FIELDS = ["title", "metaTitle", "metaDescription", "outline", "faq", "cta"] as const;
export type RegenerateBriefField = (typeof REGENERATE_BRIEF_FIELDS)[number];

export const internalLinkSchema = zv4.object({
  anchorText: zv4.string(),
  targetPage: zv4.string(),
  reason: zv4.string(),
  placement: zv4.string(),
  priority: zv4.enum(["HIGH", "MEDIUM", "LOW"]),
});
export type InternalLinkSuggestion = zv4.infer<typeof internalLinkSchema>;

/**
 * Deliberately has no `url` field. The model has no way to verify a real
 * URL, so the trust boundary is enforced at the type level rather than by
 * instruction alone — it can only ever suggest what KIND of source to add
 * (type + a named real-world source like "CDC" or "Pew Research Center")
 * and why (description); a human supplies the actual verified link before
 * publishing. See content-brief.service.ts's buildPrompt for the matching
 * "never invent a URL" instruction.
 */
export const externalSourceSchema = zv4.object({
  type: zv4.enum(EXTERNAL_SOURCE_TYPES),
  name: zv4.string(),
  description: zv4.string(),
});
export type ExternalSourceSuggestion = zv4.infer<typeof externalSourceSchema>;

export const faqItemSchema = zv4.object({
  question: zv4.string(),
  answer: zv4.string(),
});
export type FaqItem = zv4.infer<typeof faqItemSchema>;

const BASE_OUTPUT_SHAPE = {
  title: zv4.string(),
  metaTitle: zv4.string(),
  metaDescription: zv4.string(),
  outline: zv4.array(zv4.string()),
  suggestedHeadings: zv4.array(zv4.string()),
  seoRecommendations: zv4.array(zv4.string()),
  geoAeoNotes: zv4.string(),
  suggestedSearchIntent: zv4.string(),
};

/**
 * Builds the AI structured-output schema for exactly the sections the user
 * enabled. generateStructuredOutput has always accepted an arbitrary zod
 * schema per call, so this is just a new caller of an existing mechanism —
 * a disabled section is never included in the request schema at all, so
 * the model is never asked (and never spends tokens) to produce it.
 * `cta` never appears here — see contentBriefCtaSchema's comment.
 */
export function buildContentBriefOutputSchema(sections: ContentBriefSections) {
  const shape: Record<string, zv4.ZodTypeAny> = { ...BASE_OUTPUT_SHAPE };

  if (sections.internalLinks) shape.internalLinkSuggestions = zv4.array(internalLinkSchema);
  if (sections.externalSources) shape.externalSources = zv4.array(externalSourceSchema);
  if (sections.faq) shape.faq = zv4.array(faqItemSchema);
  if (sections.conclusion) shape.conclusion = zv4.string();
  /** Placement/framing guidance only — never the CTA's actual copy, which stays purely user-supplied (contentBriefCtaSchema). */
  if (sections.cta) shape.ctaPlacementSuggestion = zv4.string();
  if (sections.keyTakeaways) shape.keyTakeaways = zv4.array(zv4.string());
  if (sections.schemaSuggestions) shape.schemaSuggestions = zv4.array(zv4.string());
  if (sections.statistics) shape.statistics = zv4.array(zv4.string());
  if (sections.examples) shape.examples = zv4.array(zv4.string());

  return zv4.object(shape);
}

/**
 * Legacy Content.aiBriefDetails rows store internalLinkSuggestions as a
 * plain string[] (Phase 15). A bare string becomes a structured suggestion
 * with only anchorText populated — never re-invented, never dropped, so an
 * old row keeps displaying with blank secondary fields until regenerated.
 */
export function normalizeInternalLinkSuggestions(value: unknown): InternalLinkSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): InternalLinkSuggestion[] => {
    if (typeof item === "string") {
      return item.trim().length > 0 ? [{ anchorText: item, targetPage: "", reason: "", placement: "", priority: "MEDIUM" }] : [];
    }
    const parsed = internalLinkSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Defensive read of a Json array column against a zod/v4 item schema — falls back to [] rather than throwing, same discipline as every other Json-column reader in this feature. */
export function normalizeArray<T>(schema: zv4.ZodType<T>, value: unknown): T[] {
  const parsed = zv4.array(schema).safeParse(value);
  return parsed.success ? parsed.data : [];
}
