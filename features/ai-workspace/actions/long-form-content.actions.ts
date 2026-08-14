"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { LlmProviderError, describeLlmError } from "@/lib/ai/providers/errors";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import type { LongFormJobInput } from "@/features/ai-workspace/schemas/ai-generation-job.schema";
import { generateLongFormContent } from "@/features/ai-workspace/services/long-form-content.service";
import { contentBriefOutputSchema, type ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import {
  generateLongFormFromBriefContextSchema,
  longFormSaveFieldsSchema,
  type LongFormContentOutput,
  type LongFormSaveFields,
} from "@/features/ai-workspace/schemas/long-form-content.schema";

/** Same fetch-and-compare pattern as content-brief.actions.ts's helper of the same name — duplicated rather than imported, matching that file's own precedent of not cross-exporting these tiny checks. */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  return seoProject;
}

async function getOwnedKeyword(keywordId: string, seoProjectId: string) {
  const keyword = await prisma.keyword.findUnique({ where: { id: keywordId } });
  if (!keyword || keyword.seoProjectId !== seoProjectId) return null;
  return keyword;
}

/**
 * Verifies an existing Content row belongs to the actor's company — the
 * ownership check for the "already-saved brief" entry point. Run BEFORE
 * any AI call, same discipline as the fresh-flow checks above.
 */
async function getOwnedContent(contentId: string, companyId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { seoProject: { select: { id: true, name: true, domain: true, companyId: true } }, keywords: { select: { id: true, term: true, intent: true } } },
  });
  if (!content || content.seoProject.companyId !== companyId) return null;
  return content;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Reconstructs a ContentBriefOutput-shaped object from an already-saved
 * Content row (Phase 15's saveContentBriefAction is what originally wrote
 * these fields) — defensive read-time parse of the Json? column, mirroring
 * seo-audit.schema.ts's parseWebsiteAnalysisResult style: typeof-checked,
 * falls back to an empty/blank value rather than throwing on anything
 * unexpected. Returns null when the row has no brief to generate from.
 */
function buildBriefFromContentRow(content: {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  aiBriefDetails: unknown;
}): ContentBriefOutput | null {
  if (!content.metaTitle || !content.metaDescription || !content.aiBriefDetails || typeof content.aiBriefDetails !== "object") {
    return null;
  }
  const raw = content.aiBriefDetails as Record<string, unknown>;
  const brief = {
    title: content.title,
    metaTitle: content.metaTitle,
    metaDescription: content.metaDescription,
    outline: asStringArray(raw.outline),
    suggestedHeadings: asStringArray(raw.suggestedHeadings),
    internalLinkSuggestions: asStringArray(raw.internalLinkSuggestions),
    seoRecommendations: asStringArray(raw.seoRecommendations),
    geoAeoNotes: typeof raw.geoAeoNotes === "string" ? raw.geoAeoNotes : "",
    suggestedSearchIntent: typeof raw.suggestedSearchIntent === "string" ? raw.suggestedSearchIntent : "",
  };
  const parsed = contentBriefOutputSchema.safeParse(brief);
  return parsed.success ? parsed.data : null;
}

export type GenerateLongFormFromBriefInput = {
  seoProjectId: string;
  keywordId?: string;
  brief: ContentBriefOutput;
};

/**
 * Fresh flow — the brief is still in the caller's in-memory state (not yet
 * saved). No database write. "Regenerate" is just another call to this
 * same action.
 */
export async function generateLongFormFromBriefAction(input: GenerateLongFormFromBriefInput): Promise<ActionResult<LongFormContentOutput>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsedContext = generateLongFormFromBriefContextSchema.safeParse({ seoProjectId: input.seoProjectId, keywordId: input.keywordId });
  if (!parsedContext.success) {
    return actionError(parsedContext.error.issues[0]?.message ?? "Invalid input");
  }
  const parsedBrief = contentBriefOutputSchema.safeParse(input.brief);
  if (!parsedBrief.success) {
    return actionError("The brief is missing required fields — regenerate it before continuing.");
  }

  const seoProject = await getOwnedSeoProject(parsedContext.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  let keyword: { term: string; intent: string | null } | null = null;
  if (parsedContext.data.keywordId) {
    const owned = await getOwnedKeyword(parsedContext.data.keywordId, seoProject.id);
    if (!owned) {
      return actionError("Keyword not found for this SEO project.");
    }
    keyword = { term: owned.term, intent: owned.intent };
  }

  try {
    const article = await generateLongFormContent({
      seoProjectId: seoProject.id,
      companyId: actor.companyId,
      seoProjectName: seoProject.name,
      domain: seoProject.domain,
      brief: parsedBrief.data,
      keyword,
    });
    return actionSuccess(article);
  } catch (error) {
    const errorType = error instanceof LlmProviderError ? error.type : "UNKNOWN";
    return actionError(describeLlmError(errorType).message);
  }
}

/**
 * Already-saved-brief flow — loads the brief straight off a real Content
 * row (one Phase 15's saveContentBriefAction already wrote). Ownership is
 * verified BEFORE the brief is even read back, let alone before any AI
 * call. No database write.
 */
export async function generateLongFormFromContentAction(contentId: string): Promise<ActionResult<LongFormContentOutput>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const content = await getOwnedContent(contentId, actor.companyId);
  if (!content) {
    return actionError("Content not found.");
  }

  const brief = buildBriefFromContentRow(content);
  if (!brief) {
    return actionError("This content has no saved brief to generate an article from.");
  }

  const firstKeyword = content.keywords[0];
  const keyword = firstKeyword ? { term: firstKeyword.term, intent: firstKeyword.intent } : null;

  try {
    const article = await generateLongFormContent({
      seoProjectId: content.seoProject.id,
      companyId: actor.companyId,
      seoProjectName: content.seoProject.name,
      domain: content.seoProject.domain,
      brief,
      keyword,
    });
    return actionSuccess(article);
  } catch (error) {
    const errorType = error instanceof LlmProviderError ? error.type : "UNKNOWN";
    return actionError(describeLlmError(errorType).message);
  }
}

export type StartLongFormGenerationInput = LongFormJobInput;

/**
 * Phase 18 — the background-job counterpart to
 * generateLongFormFromBriefAction/generateLongFormFromContentAction above,
 * covering both entry points in one action (they're rows in the same
 * AiGenerationJob table, distinguished by inputJson.mode). Same
 * ownership/validation checks as the two functions it replaces in the UI;
 * both are left in place, unused, for a clean single-commit rollback.
 */
export async function startLongFormGenerationAction(input: StartLongFormGenerationInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  if (input.mode === "fromContent") {
    const content = await getOwnedContent(input.contentId, actor.companyId);
    if (!content) {
      return actionError("Content not found.");
    }
    const brief = buildBriefFromContentRow(content);
    if (!brief) {
      return actionError("This content has no saved brief to generate an article from.");
    }

    const inputJson: LongFormJobInput = { mode: "fromContent", contentId: content.id };
    const inputHash = computeInputHash(inputJson);
    const existing = await findActiveAiGenerationJob(actor.companyId, "CONTENT_DRAFT", inputHash);
    if (existing) {
      return actionSuccess({ jobId: existing.id });
    }

    const job = await createAiGenerationJob({
      companyId: actor.companyId,
      seoProjectId: content.seoProject.id,
      contentId: content.id,
      taskType: "CONTENT_DRAFT",
      inputJson,
      inputHash,
      createdById: actor.id,
    });
    void runAiGenerationJob(job.id);
    return actionSuccess({ jobId: job.id });
  }

  const parsedContext = generateLongFormFromBriefContextSchema.safeParse({ seoProjectId: input.seoProjectId, keywordId: input.keywordId });
  if (!parsedContext.success) {
    return actionError(parsedContext.error.issues[0]?.message ?? "Invalid input");
  }
  const parsedBrief = contentBriefOutputSchema.safeParse(input.brief);
  if (!parsedBrief.success) {
    return actionError("The brief is missing required fields — regenerate it before continuing.");
  }

  const seoProject = await getOwnedSeoProject(parsedContext.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }
  if (parsedContext.data.keywordId) {
    const owned = await getOwnedKeyword(parsedContext.data.keywordId, seoProject.id);
    if (!owned) {
      return actionError("Keyword not found for this SEO project.");
    }
  }

  const inputJson: LongFormJobInput = {
    mode: "fromBrief",
    seoProjectId: seoProject.id,
    keywordId: parsedContext.data.keywordId,
    brief: parsedBrief.data,
  };
  const inputHash = computeInputHash(inputJson);
  const existing = await findActiveAiGenerationJob(actor.companyId, "CONTENT_DRAFT", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    taskType: "CONTENT_DRAFT",
    inputJson,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}

export type SaveLongFormAsNewContentInput = LongFormSaveFields & {
  seoProjectId: string;
  keywordId?: string;
  brief: ContentBriefOutput;
};

/**
 * The approval gate for the fresh flow: creates exactly one new Content
 * row, DRAFT status, with the brief's fields plus whatever body text the
 * reviewer currently has (their edits, if any — see longFormSaveFieldsSchema's
 * comment on why body is taken as-is rather than re-derived from the
 * original AI output here). Nothing before this point ever touches the
 * database.
 */
export async function saveLongFormAsNewContentAction(input: SaveLongFormAsNewContentInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to save content.");
  }

  const parsedFields = longFormSaveFieldsSchema.safeParse(input);
  if (!parsedFields.success) {
    return actionError(parsedFields.error.issues[0]?.message ?? "Invalid input");
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
      title: parsedFields.data.title,
      status: "DRAFT",
      metaTitle: parsedFields.data.metaTitle,
      metaDescription: parsedFields.data.metaDescription,
      generatedByAi: true,
      body: parsedFields.data.body,
      aiBriefDetails: {
        outline: input.brief.outline,
        suggestedHeadings: input.brief.suggestedHeadings,
        internalLinkSuggestions: input.brief.internalLinkSuggestions,
        seoRecommendations: input.brief.seoRecommendations,
        geoAeoNotes: input.brief.geoAeoNotes,
        suggestedSearchIntent: input.brief.suggestedSearchIntent,
      },
      keywords: input.keywordId ? { connect: [{ id: input.keywordId }] } : undefined,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.ai_long_form_saved",
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    contentId: content.id,
    metadata: { title: content.title },
  });

  revalidatePath(`/seo/${seoProject.id}/content`);
  revalidatePath(`/seo/${seoProject.id}/content/${content.id}`);
  revalidatePath("/ai");
  return actionSuccess({ id: content.id });
}

export type UpdateLongFormContentInput = LongFormSaveFields & {
  contentId: string;
};

/**
 * The approval gate for the already-saved-brief flow: updates ONLY
 * title/metaTitle/metaDescription/body/generatedByAi on the one row
 * already confirmed to belong to the actor's company — seoProjectId,
 * keywords, authorId, status, publishedAt, aiBriefDetails, createdAt are
 * never listed in this update's data object, so Prisma leaves every one
 * of them untouched, regardless of what this action sets.
 */
export async function updateLongFormContentAction(input: UpdateLongFormContentInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to save content.");
  }

  const parsedFields = longFormSaveFieldsSchema.safeParse(input);
  if (!parsedFields.success) {
    return actionError(parsedFields.error.issues[0]?.message ?? "Invalid input");
  }

  const content = await getOwnedContent(input.contentId, actor.companyId);
  if (!content) {
    return actionError("Content not found.");
  }

  await prisma.content.update({
    where: { id: content.id },
    data: {
      title: parsedFields.data.title,
      metaTitle: parsedFields.data.metaTitle,
      metaDescription: parsedFields.data.metaDescription,
      generatedByAi: true,
      body: parsedFields.data.body,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "content.ai_long_form_saved",
    companyId: actor.companyId,
    seoProjectId: content.seoProject.id,
    contentId: content.id,
    metadata: { title: parsedFields.data.title },
  });

  revalidatePath(`/seo/${content.seoProject.id}/content`);
  revalidatePath(`/seo/${content.seoProject.id}/content/${content.id}`);
  return actionSuccess({ id: content.id });
}
