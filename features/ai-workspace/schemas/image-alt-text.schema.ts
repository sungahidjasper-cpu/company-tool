import { z } from "zod";
import { z as zv4 } from "zod/v4";

import { optionalString } from "@/lib/zod-helpers";

/**
 * The generation-form input.
 *
 * `imageDescription` is the tool's authoritative evidence, because the
 * provider architecture is TEXT-ONLY — the model never sees the image. It is
 * required for a meaningful image and irrelevant for a decorative one, which
 * is enforced by the superRefine below rather than by making the field
 * unconditionally required.
 *
 * There is deliberately no `altText`, `fileName` or `mimeType` field: the
 * server re-reads all of that from the File row, so the client cannot
 * describe a file into being something it is not.
 */
export const imageAltTextInputSchema = z
  .object({
    seoProjectId: z.string().min(1, "Select an SEO project").uuid("Invalid SEO project id"),
    fileId: z.string().min(1, "Select an image").uuid("Invalid image id"),
    imageDescription: z.string().max(2000, "Keep the image description under 2000 characters").optional(),
    additionalContext: optionalString(),
  })
  .superRefine((value, ctx) => {
    if ((value.imageDescription ?? "").trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imageDescription"], message: DESCRIPTION_REQUIRED_MESSAGE });
    }
  });
export type ImageAltTextInput = z.infer<typeof imageAltTextInputSchema>;

/** The stored job input — the same shape. Ids and the user's own words only; the dispatcher re-reads the File row itself. */
export const imageAltTextJobInputSchema = imageAltTextInputSchema;
export type ImageAltTextJobInput = z.infer<typeof imageAltTextJobInputSchema>;

/**
 * The PROVIDER-FACING output — deliberately loose, following the
 * "loose contract in, strict deterministic filter out; reject, never repair"
 * doctrine. Nothing here is trusted until buildImageAltTextResult has run.
 */
export const imageAltTextProviderOutputSchema = zv4.object({
  altText: zv4.string(),
  reasoning: zv4.string(),
  accessibilityNote: zv4.string().default(""),
});
export type ImageAltTextProviderOutput = zv4.infer<typeof imageAltTextProviderOutputSchema>;

/**
 * The CANONICAL result. `altText` is the only field that is the deliverable;
 * `reasoning` is a reviewer note and is never copied, and `lengthGuidance` is
 * deterministic advice rather than a rejection — a long alt text that is
 * genuinely needed for accessibility is kept, and simply flagged.
 */
export const imageAltTextResultSchema = zv4.object({
  altText: zv4.string(),
  reasoning: zv4.string(),
  accessibilityNote: zv4.string(),
  /** Deterministic, code-computed note when the alt text is longer than is usually helpful. Empty when it is a comfortable length. */
  lengthGuidance: zv4.string(),
  characterCount: zv4.number(),
});
export type ImageAltTextResult = zv4.infer<typeof imageAltTextResultSchema>;

/** `result: null` is a genuine SUCCEEDED outcome — "the output could not be turned into grounded, accessible alt text" — not a job failure. */
export const imageAltTextJobResultSchema = zv4.object({
  result: imageAltTextResultSchema.nullable(),
});
export type ImageAltTextJobResult = zv4.infer<typeof imageAltTextJobResultSchema>;

/**
 * Shown when the user has selected an image but written no description.
 *
 * It explains WHY the description is needed — the model cannot see the image
 * — rather than presenting it as an arbitrary required field, and it never
 * suggests the AI failed, because nothing has been generated yet.
 */
export const DESCRIPTION_REQUIRED_MESSAGE =
  "Describe what the image shows. The AI cannot see the image, so your description is what the alt text is based on.";

/**
 * The single source of truth for "is there enough evidence to write alt
 * text?", shared by the server action and the picker so the button and the
 * boundary cannot drift apart.
 *
 * Only the user's own description counts. Content context and Brand Profile
 * deliberately do NOT satisfy this: an article about self-storage is not
 * evidence that a particular image shows a storage unit, and treating it as
 * such is exactly the invention this tool must not commit.
 */
export function hasEnoughImageEvidence(input: { imageDescription?: string | null }): boolean {
  return (input.imageDescription ?? "").trim().length > 0;
}

/**
 * The recommendation for a DECORATIVE image.
 *
 * Computed in code and returned without any AI call: the correct answer is
 * fixed by the accessibility standard, so asking a language model for it
 * would add cost, latency and the risk of it inventing a description for an
 * image that must not have one.
 */
export const DECORATIVE_ALT_TEXT = "";

export const DECORATIVE_RECOMMENDATION =
  'Use an empty alt attribute: alt="". A decorative image carries no information the surrounding text does not already give, so an empty alt tells screen readers to skip it. Leaving the attribute off entirely is not the same — some screen readers then read the file name aloud.';

export type DecorativeRecommendation = {
  altText: typeof DECORATIVE_ALT_TEXT;
  recommendation: string;
};

export function buildDecorativeRecommendation(): DecorativeRecommendation {
  return { altText: DECORATIVE_ALT_TEXT, recommendation: DECORATIVE_RECOMMENDATION };
}
