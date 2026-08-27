import { z as zv4 } from "zod/v4";

import { faqItemSchema, internalLinkSchema, sourceReferenceSchema } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import type { ContentBriefSections, ContentDraftOptions } from "@/features/ai-workspace/schemas/content-brief-settings.schema";

const BASE_LONG_FORM_SHAPE = {
  introduction: zv4.string(),
  sections: zv4.array(
    zv4.object({
      heading: zv4.string(),
      body: zv4.string(),
    })
  ),
  /** Informational for the human reviewer only — never written into the saved body (see formatLongFormContentAsMarkdown). Structured the same way as the brief's own internalLinkSuggestions (content-brief-output-builder.ts). */
  internalLinkPlacementSuggestions: zv4.array(internalLinkSchema),
};

/**
 * Long-form's equivalent of buildContentBriefOutputSchema — narrows the
 * article's structured-output schema to exactly the sections/draft options
 * the user enabled for this generation. `conclusion` and `faq` were
 * unconditional in Phase 16; they're now gated by the same `sections`
 * toggles the brief uses, since both come from the same settings object.
 *
 * `hasKnowledgeSourceContext` mirrors buildContentBriefOutputSchema's own
 * parameter of the same name — a runtime fact (whether buildPrompt was
 * actually given supplied-source context), not a user-facing toggle.
 */
export function buildLongFormOutputSchema(sections: ContentBriefSections, draftOptions: ContentDraftOptions, hasKnowledgeSourceContext?: boolean) {
  const shape: Record<string, zv4.ZodTypeAny> = { ...BASE_LONG_FORM_SHAPE };

  if (sections.conclusion) shape.conclusion = zv4.string();
  if (sections.faq) shape.faq = zv4.array(faqItemSchema);
  if (sections.keyTakeaways) shape.keyTakeaways = zv4.array(zv4.string());
  if (draftOptions.imagePlaceholders) shape.imagePlaceholders = zv4.array(zv4.string());
  if (draftOptions.altTextSuggestions) shape.altTextSuggestions = zv4.array(zv4.string());
  if (draftOptions.featuredImagePrompt) shape.featuredImagePrompt = zv4.string();
  if (draftOptions.socialSnippets) shape.socialSnippets = zv4.array(zv4.string());
  if (draftOptions.excerpt) shape.excerpt = zv4.string();
  if (hasKnowledgeSourceContext) shape.sourcesReferenced = zv4.array(sourceReferenceSchema);

  return zv4.object(shape);
}
