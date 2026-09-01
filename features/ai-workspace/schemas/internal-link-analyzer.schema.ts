import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { internalLinkSchema } from "@/features/ai-workspace/schemas/content-brief-output-builder";

/**
 * The generation-form input — a plain form-validated shape (regular zod),
 * matching content-brief.schema.ts's own v3-input/v4-output split.
 * contentId is REQUIRED, not optional: every recommendation this tool makes
 * is "add a link FROM this page TO another real page" — without a specific
 * source page there is no content to be contextually relevant to, and no
 * anchor-text placement to reason about. Analyzing an entire project's
 * many-to-many link opportunities at once is a materially larger task,
 * deliberately out of this v1's scope.
 */
export const internalLinkAnalyzerInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project"),
  contentId: z.string().min(1, "Select a page to analyze"),
});

export type InternalLinkAnalyzerInput = z.infer<typeof internalLinkAnalyzerInputSchema>;

/**
 * The PROVIDER-FACING output shape — deliberately loose (every field a
 * plain string, including priority) rather than reusing
 * content-brief-output-builder.ts's strict internalLinkSchema directly.
 * generateStructuredOutput/Streaming call schema.safeParse() internally
 * (lib/ai/structured-output.ts) and treat a failure as a retryable/
 * fallback-triggering attempt failure — if the provider-facing schema
 * enforced the real HIGH/MEDIUM/LOW enum, one cosmetically-off value (e.g.
 * "High") would fail the ENTIRE response and burn a wasted retry/fallback,
 * discarding otherwise-good recommendations. The strict internalLinkSchema
 * is reused instead as a deterministic POST-generation per-item filter in
 * the service (see generateInternalLinkRecommendations) — the same
 * "loose contract in, strict filter out" shape schema-markup-generator's
 * isValidJsonLd already established for the identical reason.
 */
export const internalLinkAnalysisProviderOutputSchema = zv4.object({
  recommendations: zv4
    .array(
      zv4.object({
        anchorText: zv4.string(),
        targetPage: zv4.string(),
        reason: zv4.string(),
        placement: zv4.string(),
        priority: zv4.string(),
      })
    )
    .default([]),
});

/**
 * The CANONICAL job-result shape — what actually lands in
 * AiGenerationJob.resultJson once the service's own strict, per-item
 * filtering (see internal-link-analyzer.service.ts's filterValidRecommendations)
 * has already run. Reuses the existing, strict internalLinkSchema directly
 * (real priority enum included) since every item here has already passed
 * that exact validation — this is a read-back/UI-parsing schema, not
 * another provider-facing contract.
 */
export const internalLinkAnalysisResultSchema = zv4.object({
  recommendations: zv4.array(internalLinkSchema).default([]),
});
export type InternalLinkAnalysisResult = zv4.infer<typeof internalLinkAnalysisResultSchema>;
