import { z } from "zod";

import { optionalString } from "@/lib/zod-helpers";
import { BRAND_VOICES } from "@/features/ai-workspace/schemas/content-brief-settings.schema";

/**
 * Reuses BRAND_VOICES verbatim (content-brief-settings.schema.ts) rather
 * than defining a parallel vocabulary — a Brand Profile's brandVoice and a
 * per-request ContentBriefSettings.brandVoice must always mean the same
 * thing, or the (not-yet-built) precedence logic between them would be
 * comparing incompatible values.
 *
 * Deliberately z.string() + .refine(), not z.enum(BRAND_VOICES): an enum
 * narrows the OUTPUT type to a literal union, which would force every
 * caller (the form, this action, its tests) to split zod's input type from
 * its output type just to keep "" assignable during a blank submission —
 * the same transform-then-refine shape optionalNumericString already uses
 * in lib/zod-helpers.ts, applied here instead of a fresh pattern.
 */
const optionalBrandVoice = () =>
  z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || (BRAND_VOICES as readonly string[]).includes(value), {
      message: "Not a recognized brand voice",
    });

/**
 * competitorUrls stays a plain comma-separated string end-to-end through
 * this schema (input type === output type, same simplicity as every other
 * field here) — split into a real string[] in brand-profile.actions.ts
 * immediately before the Prisma write, the same place
 * updateCompanyAiLimitsAction converts its own numeric strings. Not
 * URL-validated per-entry, matching ContentBriefSettings.competitorUrls'
 * own looseness (a plain z.array(z.string()), no .url() check there either).
 */
export const brandProfileSchema = z.object({
  brandName: optionalString(),
  brandVoice: optionalBrandVoice(),
  targetAudience: optionalString(),
  productsServices: optionalString(),
  targetCountry: optionalString(),
  language: optionalString(),
  competitorUrls: optionalString(),
});

export type BrandProfileInput = z.infer<typeof brandProfileSchema>;
