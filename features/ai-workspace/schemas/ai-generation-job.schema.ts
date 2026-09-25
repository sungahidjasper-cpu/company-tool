import { contentBriefInputSchema, contentBriefOutputSchema, type ContentBriefInput, type ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import type { ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { generateLongFormFromBriefContextSchema } from "@/features/ai-workspace/schemas/long-form-content.schema";
import { schemaMarkupInputSchema, type SchemaMarkupInput } from "@/features/ai-workspace/schemas/schema-markup-generator.schema";
import { internalLinkAnalyzerInputSchema, type InternalLinkAnalyzerInput } from "@/features/ai-workspace/schemas/internal-link-analyzer.schema";
import { socialSnippetGeneratorInputSchema, type SocialSnippetGeneratorInput } from "@/features/ai-workspace/schemas/social-snippet-generator.schema";
import { metaTagOptimizerInputSchema, type MetaTagOptimizerInput } from "@/features/ai-workspace/schemas/meta-tag-optimizer.schema";
import { contentRewriterInputSchema, type ContentRewriterInput } from "@/features/ai-workspace/schemas/content-rewriter.schema";
import { pressReleaseGeneratorInputSchema, type PressReleaseGeneratorInput } from "@/features/ai-workspace/schemas/press-release-generator.schema";
import { topicClusterPlannerInputSchema, type TopicClusterPlannerInput } from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";
import {
  competitorContentAnalysisJobInputSchema,
  type CompetitorContentAnalysisJobInput,
} from "@/features/ai-workspace/schemas/competitor-content-analysis.schema";
import { contentGapAnalysisJobInputSchema, type ContentGapAnalysisJobInput } from "@/features/ai-workspace/schemas/content-gap-analysis.schema";
import { emailNewsletterJobInputSchema, type EmailNewsletterJobInput } from "@/features/ai-workspace/schemas/email-newsletter.schema";
import { imageAltTextJobInputSchema, type ImageAltTextJobInput } from "@/features/ai-workspace/schemas/image-alt-text.schema";
import { contentCalendarJobInputSchema, type ContentCalendarJobInput } from "@/features/ai-workspace/schemas/content-calendar.schema";

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

export type SchemaMarkupJobInput = SchemaMarkupInput;

export type InternalLinkAnalyzerJobInput = InternalLinkAnalyzerInput;

export type SocialSnippetGeneratorJobInput = SocialSnippetGeneratorInput;

export type MetaTagOptimizerJobInput = MetaTagOptimizerInput;

export type ContentRewriterJobInput = ContentRewriterInput;

export type PressReleaseGeneratorJobInput = PressReleaseGeneratorInput;

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

export function validateSchemaMarkupJobInput(input: unknown): JobInputValidationResult<SchemaMarkupJobInput> {
  const parsed = schemaMarkupInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

export function validateInternalLinkAnalyzerJobInput(input: unknown): JobInputValidationResult<InternalLinkAnalyzerJobInput> {
  const parsed = internalLinkAnalyzerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

export function validateSocialSnippetGeneratorJobInput(input: unknown): JobInputValidationResult<SocialSnippetGeneratorJobInput> {
  const parsed = socialSnippetGeneratorInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

export function validateMetaTagOptimizerJobInput(input: unknown): JobInputValidationResult<MetaTagOptimizerJobInput> {
  const parsed = metaTagOptimizerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

export function validateContentRewriterJobInput(input: unknown): JobInputValidationResult<ContentRewriterJobInput> {
  const parsed = contentRewriterInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

export function validatePressReleaseGeneratorJobInput(input: unknown): JobInputValidationResult<PressReleaseGeneratorJobInput> {
  const parsed = pressReleaseGeneratorInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

/**
 * The ninth AI Workspace tool's job-input shape differs from every prior
 * one validated in this file: it's richer than its own form input
 * (contentGapAnalysisInputSchema is just {seoProjectId}), since the action
 * that creates the job also resolves and stores the specific
 * websiteAnalysisJobId it used — see content-gap-analysis.actions.ts.
 * Validated here against contentGapAnalysisJobInputSchema, the stored-shape
 * schema, not the form schema.
 */
export function validateContentGapAnalysisJobInput(input: unknown): JobInputValidationResult<ContentGapAnalysisJobInput> {
  const parsed = contentGapAnalysisJobInputSchema.safeParse(input);
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

/**
 * The tenth AI Workspace tool. Its stored job input is the same shape as its
 * form input (seed topic plus optional real keyword ids), so the form schema
 * is reused directly rather than declaring a second identical one.
 */
export function validateTopicClusterPlannerJobInput(input: unknown): JobInputValidationResult<TopicClusterPlannerInput> {
  const parsed = topicClusterPlannerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

/**
 * The eleventh AI Workspace tool. Its stored input is richer than its form
 * input: the action records the competitor ORIGINS it already validated (and
 * where each came from), so the dispatcher never re-derives an origin from raw
 * user text. Validated against the stored-shape schema, not the form schema —
 * the same precedent content-gap-analysis.schema.ts set.
 */
export function validateCompetitorContentAnalysisJobInput(input: unknown): JobInputValidationResult<CompetitorContentAnalysisJobInput> {
  const parsed = competitorContentAnalysisJobInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

/**
 * The twelfth AI Workspace tool. Its stored input is the same shape as its
 * form input — ids plus the user's own text, never any resolved Content
 * field, because the dispatcher re-fetches the authoritative Content row
 * itself rather than trusting stored JSON to describe it.
 */
export function validateEmailNewsletterJobInput(input: unknown): JobInputValidationResult<EmailNewsletterJobInput> {
  const parsed = emailNewsletterJobInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

/**
 * The thirteenth AI Workspace tool. Its stored input is ids plus the user's
 * own written description — never any resolved File or Content field,
 * because the dispatcher re-reads the authoritative File row itself.
 */
export function validateImageAltTextJobInput(input: unknown): JobInputValidationResult<ImageAltTextJobInput> {
  const parsed = imageAltTextJobInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}

/**
 * The fourteenth AI Workspace tool. Its stored input is ids, dates as plain
 * yyyy-MM-dd strings, and the user's own words — the dispatcher re-reads every
 * project record itself and re-derives the date range deterministically.
 */
export function validateContentCalendarJobInput(input: unknown): JobInputValidationResult<ContentCalendarJobInput> {
  const parsed = contentCalendarJobInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return { success: true, data: parsed.data };
}
