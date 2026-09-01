import { z } from "zod";
import { z as zv4 } from "zod/v4";

/**
 * V1 platform set — deliberately excludes Instagram (image-first; a
 * text-only "Instagram snippet" is a weak fit for the platform's actual
 * requirements, per the STEP 17 discovery report).
 */
export const SOCIAL_SNIPPET_PLATFORMS = ["X", "LINKEDIN", "FACEBOOK"] as const;
export type SocialSnippetPlatform = (typeof SOCIAL_SNIPPET_PLATFORMS)[number];

/**
 * Deterministic, real character limits per platform — never trust a
 * model-reported count (see the service's own filterValidSnippets, which
 * always recomputes from text.length). Facebook has no hard cap for v1: its
 * technical limit (63,206 chars) is functionally unlimited for a short
 * promotional snippet, so asserting a specific enforced number here would
 * be an unsupported claim rather than a real product constraint.
 */
export const SOCIAL_SNIPPET_CHARACTER_LIMITS: Record<SocialSnippetPlatform, number | null> = {
  X: 280,
  LINKEDIN: 3000,
  FACEBOOK: null,
};

/**
 * The generation-form input — a plain form-validated shape (regular zod),
 * matching internal-link-analyzer.schema.ts's own v3-input/v4-output split.
 * contentId is REQUIRED: every snippet promotes a specific, real article —
 * there is no content to be faithful to without one. At least one platform
 * must be selected.
 */
export const socialSnippetGeneratorInputSchema = z.object({
  seoProjectId: z.string().min(1, "Select an SEO project"),
  contentId: z.string().min(1, "Select content to promote"),
  platforms: z.array(z.enum(SOCIAL_SNIPPET_PLATFORMS)).min(1, "Select at least one platform"),
  notes: z.string().max(2000).optional(),
});

export type SocialSnippetGeneratorInput = z.infer<typeof socialSnippetGeneratorInputSchema>;

/**
 * The PROVIDER-FACING output shape — deliberately loose (platform as a
 * plain string, not the real enum) for the same reason
 * internal-link-analyzer.schema.ts's provider schema keeps priority as a
 * plain string: generateStructuredOutput/Streaming call schema.safeParse()
 * internally (lib/ai/structured-output.ts) and treat a failure as a
 * retryable/fallback-triggering attempt failure. One cosmetically-off
 * platform value (e.g. "Twitter" instead of "X") would otherwise fail the
 * ENTIRE response and burn a wasted retry/fallback, discarding otherwise-
 * good snippets. The real platform enum and the real, deterministic
 * character-limit check are applied afterward as a strict POST-generation
 * per-item filter in the service (see filterValidSnippets) — never trusting
 * a model-reported character count.
 */
export const socialSnippetProviderOutputSchema = zv4.object({
  snippets: zv4
    .array(
      zv4.object({
        platform: zv4.string(),
        text: zv4.string(),
      })
    )
    .default([]),
});

/**
 * The CANONICAL job-result shape — what lands in AiGenerationJob.resultJson
 * once the service's own strict, per-item filtering (see
 * social-snippet-generator.service.ts's filterValidSnippets) has already
 * run. characterCount is always the application's own computed text.length,
 * never a model-reported value — there is no such field on the provider
 * schema above for exactly that reason.
 */
export const socialSnippetSchema = zv4.object({
  platform: zv4.enum(SOCIAL_SNIPPET_PLATFORMS),
  text: zv4.string(),
  characterCount: zv4.number(),
});
export type SocialSnippet = zv4.infer<typeof socialSnippetSchema>;

export const socialSnippetGenerationResultSchema = zv4.object({
  snippets: zv4.array(socialSnippetSchema).default([]),
});
export type SocialSnippetGenerationResult = zv4.infer<typeof socialSnippetGenerationResultSchema>;
