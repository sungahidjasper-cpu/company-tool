import { contentBriefInputSchema, contentBriefOutputSchema, type ContentBriefInput, type ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import type { ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { generateLongFormFromBriefContextSchema } from "@/features/ai-workspace/schemas/long-form-content.schema";

/**
 * Validators for AiGenerationJob.inputJson, read back from the database by
 * the job runner (lib/jobs/ai-generation-job-runner.ts) — the same
 * discipline buildBriefFromContentRow already applies to
 * Content.aiBriefDetails: never trust a JSON column as already-safe just
 * because something else validated it once, at write time.
 *
 * The CONTENT_BRIEF shape reuses contentBriefInputSchema directly. The
 * CONTENT_DRAFT shape can't be one plain zod schema the same way:
 * generateLongFormFromBriefContextSchema documents a real, confirmed
 * incompatibility where a plain zod (v3) object can't validate a nested
 * zod/v4 sub-schema (`keyValidator._parse is not a function`). So, exactly
 * like the pre-Phase-18 actions did, the "fromBrief" context and the brief
 * itself are validated separately here too.
 */

export type ContentBriefJobInput = ContentBriefInput;

export type LongFormJobInput =
  | { mode: "fromBrief"; seoProjectId: string; keywordId?: string; brief: ContentBriefOutput; settings?: ContentBriefSettings }
  | { mode: "fromContent"; contentId: string };

export type JobInputValidationResult<T> = { success: true; data: T } | { success: false; message: string };

export function validateContentBriefJobInput(input: unknown): JobInputValidationResult<ContentBriefJobInput> {
  const parsed = contentBriefInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

export function validateLongFormJobInput(input: unknown): JobInputValidationResult<LongFormJobInput> {
  if (!input || typeof input !== "object") {
    return { success: false, message: "Invalid input" };
  }
  const raw = input as Record<string, unknown>;

  if (raw.mode === "fromContent") {
    if (typeof raw.contentId !== "string" || raw.contentId.length === 0) {
      return { success: false, message: "Invalid input" };
    }
    return { success: true, data: { mode: "fromContent", contentId: raw.contentId } };
  }

  if (raw.mode === "fromBrief") {
    const parsedContext = generateLongFormFromBriefContextSchema.safeParse({
      seoProjectId: raw.seoProjectId,
      keywordId: raw.keywordId,
      settings: raw.settings,
    });
    if (!parsedContext.success) {
      return { success: false, message: parsedContext.error.issues[0]?.message ?? "Invalid input" };
    }
    const parsedBrief = contentBriefOutputSchema.safeParse(raw.brief);
    if (!parsedBrief.success) {
      return { success: false, message: "The brief is missing required fields — regenerate it before continuing." };
    }
    return {
      success: true,
      data: {
        mode: "fromBrief",
        seoProjectId: parsedContext.data.seoProjectId,
        keywordId: parsedContext.data.keywordId,
        brief: parsedBrief.data,
        settings: parsedContext.data.settings,
      },
    };
  }

  return { success: false, message: "Invalid input" };
}
