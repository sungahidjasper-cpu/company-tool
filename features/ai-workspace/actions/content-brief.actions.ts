"use server";

import { revalidatePath } from "next/cache";
import { z as zv4 } from "zod/v4";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { LlmProviderError, describeLlmError } from "@/lib/ai/providers/errors";
import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { buildPrompt, CONTENT_BRIEF_SYSTEM_PROMPT, generateContentBrief, PROMPT_VERSION } from "@/features/ai-workspace/services/content-brief.service";
import { faqItemSchema, type RegenerateBriefField } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import type { ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import {
  contentBriefInputSchema,
  type ContentBriefInput,
  type ContentBriefOutput,
} from "@/features/ai-workspace/schemas/content-brief.schema";

/**
 * Verifies the SEO project belongs to the actor's company — the same
 * fetch-and-compare pattern content.actions.ts already uses everywhere,
 * done here BEFORE any AI call is attempted, not just before the eventual
 * save. Returns the project (name/domain needed for the prompt) or null.
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  return seoProject;
}

/**
 * Verifies the keyword belongs to the given (already-owned) SEO project —
 * a keywordId for a different project or a different company's data must
 * never reach the prompt.
 */
async function getOwnedKeyword(keywordId: string, seoProjectId: string) {
  const keyword = await prisma.keyword.findUnique({ where: { id: keywordId } });
  if (!keyword || keyword.seoProjectId !== seoProjectId) return null;
  return keyword;
}

/**
 * Generates a candidate brief and returns it — this performs NO database
 * write. The candidate lives only in the caller's form state until
 * saveContentBriefAction is explicitly invoked; "Regenerate" is just
 * another call to this same action.
 */
export async function generateContentBriefAction(input: ContentBriefInput): Promise<ActionResult<ContentBriefOutput>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = contentBriefInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  let keyword: { term: string; intent: string | null } | null = null;
  if (parsed.data.keywordId) {
    const owned = await getOwnedKeyword(parsed.data.keywordId, seoProject.id);
    if (!owned) {
      return actionError("Keyword not found for this SEO project.");
    }
    keyword = { term: owned.term, intent: owned.intent };
  }

  try {
    const brief = await generateContentBrief({
      seoProjectId: seoProject.id,
      companyId: actor.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      contentType: parsed.data.contentType,
      keyword,
      notes: parsed.data.notes,
    });
    return actionSuccess(brief);
  } catch (error) {
    const errorType = error instanceof LlmProviderError ? error.type : "UNKNOWN";
    return actionError(describeLlmError(errorType).message);
  }
}

/**
 * Phase 18 — the background-job counterpart to generateContentBriefAction
 * above. Same ownership/validation checks, same eventual AI call — but
 * instead of awaiting the AI call inline (10-20s+, longer with Phase 17
 * retries), this creates an AiGenerationJob row, kicks off
 * runAiGenerationJob unawaited, and returns the job id immediately for the
 * caller to poll via getAiGenerationJobAction. generateContentBriefAction
 * itself is left in place (unused by the UI after this phase) rather than
 * deleted, for a clean single-commit rollback if this needs reverting.
 */
export async function startContentBriefGenerationAction(input: ContentBriefInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = contentBriefInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  if (parsed.data.keywordId) {
    const owned = await getOwnedKeyword(parsed.data.keywordId, seoProject.id);
    if (!owned) {
      return actionError("Keyword not found for this SEO project.");
    }
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "CONTENT_BRIEF", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    taskType: "CONTENT_BRIEF",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}

export type SaveContentBriefInput = {
  seoProjectId: string;
  keywordId?: string;
  brief: ContentBriefOutput;
  /** Phase 21 — the settings this brief was generated with, persisted so a later regeneration/long-form session can reconstruct the same toggles. Omitted for pre-Phase-21 callers. */
  settings?: ContentBriefSettings;
};

/**
 * The approval gate: nothing from generateContentBriefAction is persisted
 * until this is explicitly called. Always creates a new Content row
 * (status DRAFT) — further edits after saving go through the existing
 * Content edit page/actions, not through this feature.
 */
export async function saveContentBriefAction(input: SaveContentBriefInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to save content.");
  }

  const seoProject = await getOwnedSeoProject(input.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  if (input.keywordId) {
    const owned = await getOwnedKeyword(input.keywordId, seoProject.id);
    if (!owned) {
      return actionError("Keyword not found for this SEO project.");
    }
  }

  const content = await prisma.content.create({
    data: {
      seoProjectId: seoProject.id,
      authorId: actor.id,
      title: input.brief.title,
      status: "DRAFT",
      metaTitle: input.brief.metaTitle,
      metaDescription: input.brief.metaDescription,
      generatedByAi: true,
      aiBriefDetails: {
        outline: input.brief.outline,
        suggestedHeadings: input.brief.suggestedHeadings,
        internalLinkSuggestions: input.brief.internalLinkSuggestions,
        seoRecommendations: input.brief.seoRecommendations,
        geoAeoNotes: input.brief.geoAeoNotes,
        suggestedSearchIntent: input.brief.suggestedSearchIntent,
        conclusion: input.brief.conclusion,
        ctaPlacementSuggestion: input.brief.ctaPlacementSuggestion,
        externalSources: input.brief.externalSources,
        faq: input.brief.faq,
        keyTakeaways: input.brief.keyTakeaways,
        schemaSuggestions: input.brief.schemaSuggestions,
        statistics: input.brief.statistics,
        examples: input.brief.examples,
        briefSettings: input.settings,
      },
      keywords: input.keywordId ? { connect: [{ id: input.keywordId }] } : undefined,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.ai_brief_saved",
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    contentId: content.id,
    metadata: { title: content.title },
  });

  revalidatePath(`/seo/${seoProject.id}/content`);
  revalidatePath("/ai");
  return actionSuccess({ id: content.id });
}

/**
 * Phase 21 §12 — renders the exact prompt a real generation would send,
 * WITHOUT calling any provider (zero cost, instant). Gated behind the
 * existing SUPER_ADMIN-only Permissions.manageCompanies check (reused, not
 * a new permission) — same visibility pattern as Phase 19's
 * CompanyAiLimitsForm.
 */
export async function previewContentBriefPromptAction(input: ContentBriefInput): Promise<ActionResult<{ prompt: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageCompanies(actor.role)) {
    return actionError("Only Super Admins can preview the AI prompt.");
  }

  const parsed = contentBriefInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  let keyword: { term: string; intent: string | null } | null = null;
  if (parsed.data.keywordId) {
    const owned = await getOwnedKeyword(parsed.data.keywordId, seoProject.id);
    if (!owned) {
      return actionError("Keyword not found for this SEO project.");
    }
    keyword = { term: owned.term, intent: owned.intent };
  }

  const prompt = buildPrompt({
    seoProjectId: seoProject.id,
    companyId: actor.companyId,
    seoProjectName: seoProject.name,
    domain: seoProject.domain,
    contentType: parsed.data.contentType,
    keyword,
    notes: parsed.data.notes,
    settings: parsed.data.settings,
  });
  return actionSuccess({ prompt });
}

/**
 * Phase 21 §15 — deliberately a field→narrow-schema map rather than one
 * hardcoded function per field, so a future AI Workspace tool can reuse
 * the same "narrow dynamic schema + synchronous single call" pattern by
 * adding its own map entry rather than a new mechanism. The model is never
 * asked for CTA copy — see contentBriefCtaSchema's comment.
 */
export type { RegenerateBriefField };

const REGENERATE_FIELD_SCHEMAS: Record<RegenerateBriefField, () => zv4.ZodTypeAny> = {
  title: () => zv4.object({ title: zv4.string() }),
  metaTitle: () => zv4.object({ metaTitle: zv4.string() }),
  metaDescription: () => zv4.object({ metaDescription: zv4.string() }),
  outline: () => zv4.object({ outline: zv4.array(zv4.string()) }),
  faq: () => zv4.object({ faq: zv4.array(faqItemSchema) }),
  cta: () => zv4.object({ ctaPlacementSuggestion: zv4.string() }),
};

export type RegenerateBriefFieldInput = {
  seoProjectId: string;
  keywordId?: string;
  contentType: ContentBriefInput["contentType"];
  notes?: string;
  currentBrief: ContentBriefOutput;
  field: RegenerateBriefField;
};

/**
 * Regenerates exactly one field of an already-generated brief, in place —
 * a materially smaller/faster call than a full brief (narrow schema,
 * shorter prompt), so this stays synchronous rather than job-backed (no
 * polling-UX needed for a call this fast). Reuses taskType "CONTENT_BRIEF"
 * — this is the same underlying activity, not a new task class; AiUsageLog
 * still tracks its cost.
 */
export async function regenerateBriefFieldAction(input: RegenerateBriefFieldInput): Promise<ActionResult<ContentBriefOutput>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const seoProject = await getOwnedSeoProject(input.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  let keyword: { term: string; intent: string | null } | null = null;
  if (input.keywordId) {
    const owned = await getOwnedKeyword(input.keywordId, seoProject.id);
    if (!owned) {
      return actionError("Keyword not found for this SEO project.");
    }
    keyword = { term: owned.term, intent: owned.intent };
  }

  const basePrompt = buildPrompt({
    seoProjectId: seoProject.id,
    companyId: actor.companyId,
    seoProjectName: seoProject.name,
    domain: seoProject.domain,
    contentType: input.contentType,
    keyword,
    notes: input.notes,
  });

  const prompt = `${basePrompt}

Here is the CURRENT brief, already generated and under human review:
${JSON.stringify(input.currentBrief, null, 2)}

Regenerate ONLY the "${input.field}" field above. Keep it consistent with everything else in the current brief. Do not change or comment on any other field.`;

  try {
    const patch = await generateStructuredOutput(REGENERATE_FIELD_SCHEMAS[input.field](), {
      system: CONTENT_BRIEF_SYSTEM_PROMPT,
      prompt,
      maxTokens: 800,
      taskType: "CONTENT_BRIEF",
      promptVersion: PROMPT_VERSION,
      seoProjectId: seoProject.id,
      companyId: actor.companyId,
    });
    return actionSuccess({ ...input.currentBrief, ...(patch as Partial<ContentBriefOutput>) });
  } catch (error) {
    const errorType = error instanceof LlmProviderError ? error.type : "UNKNOWN";
    return actionError(describeLlmError(errorType).message);
  }
}
