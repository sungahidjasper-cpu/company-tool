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
import { createContentRevisionSnapshot } from "@/features/seo/services/content-revision.service";
import { contentBriefOutputSchema, type ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import { externalSourceSchema, faqItemSchema, normalizeArray, normalizeInternalLinkSuggestions, sourceReferenceSchema } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import { contentBriefSettingsSchema, type ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
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
  // Phase B M2 — a trashed page is neither a valid generation source nor a
  // valid write target; the pickers already exclude these when listing.
  if (content.deletedAt) return null;
  return content;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Same as ai-generation-job-runner.ts's identical helper — see buildBriefFromContentRow's comment on why this is duplicated rather than shared. */
function readBriefSettingsFromContentRow(aiBriefDetails: unknown): ContentBriefSettings | undefined {
  if (!aiBriefDetails || typeof aiBriefDetails !== "object") return undefined;
  const raw = (aiBriefDetails as Record<string, unknown>).briefSettings;
  const parsed = contentBriefSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
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
    internalLinkSuggestions: normalizeInternalLinkSuggestions(raw.internalLinkSuggestions),
    seoRecommendations: asStringArray(raw.seoRecommendations),
    geoAeoNotes: typeof raw.geoAeoNotes === "string" ? raw.geoAeoNotes : "",
    suggestedSearchIntent: typeof raw.suggestedSearchIntent === "string" ? raw.suggestedSearchIntent : "",
    conclusion: typeof raw.conclusion === "string" ? raw.conclusion : "",
    ctaPlacementSuggestion: typeof raw.ctaPlacementSuggestion === "string" ? raw.ctaPlacementSuggestion : "",
    externalSources: normalizeArray(externalSourceSchema, raw.externalSources),
    faq: normalizeArray(faqItemSchema, raw.faq),
    keyTakeaways: asStringArray(raw.keyTakeaways),
    schemaSuggestions: asStringArray(raw.schemaSuggestions),
    statistics: asStringArray(raw.statistics),
    examples: asStringArray(raw.examples),
    sourcesReferenced: normalizeArray(sourceReferenceSchema, raw.sourcesReferenced),
  };
  const parsed = contentBriefOutputSchema.safeParse(brief);
  return parsed.success ? parsed.data : null;
}

export type GenerateLongFormFromBriefInput = {
  seoProjectId: string;
  keywordId?: string;
  brief: ContentBriefOutput;
  settings?: ContentBriefSettings;
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

  const parsedContext = generateLongFormFromBriefContextSchema.safeParse({
    seoProjectId: input.seoProjectId,
    keywordId: input.keywordId,
    settings: input.settings,
  });
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
      settings: parsedContext.data.settings,
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
      settings: readBriefSettingsFromContentRow(content.aiBriefDetails),
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

  const parsedContext = generateLongFormFromBriefContextSchema.safeParse({
    seoProjectId: input.seoProjectId,
    keywordId: input.keywordId,
    settings: input.settings,
  });
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
    settings: parsedContext.data.settings,
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
  settings?: ContentBriefSettings;
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

  // Phase B M3 — longFormSaveFieldsSchema covers the four Content columns
  // but never the brief that is persisted into aiBriefDetails below, which
  // was written straight from unvalidated client input. Validated here with
  // the same contentBriefOutputSchema this file already uses at :136.
  const parsedBrief = contentBriefOutputSchema.safeParse(input?.brief);
  if (!parsedBrief.success) {
    return actionError("The brief is missing required fields — regenerate it before saving.");
  }
  const parsedSettings = input?.settings === undefined ? undefined : contentBriefSettingsSchema.safeParse(input.settings);
  if (parsedSettings && !parsedSettings.success) {
    return actionError("The brief settings are invalid — regenerate the brief before saving.");
  }
  const brief = parsedBrief.data;
  const settings = parsedSettings?.data;

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
        outline: brief.outline,
        suggestedHeadings: brief.suggestedHeadings,
        internalLinkSuggestions: brief.internalLinkSuggestions,
        seoRecommendations: brief.seoRecommendations,
        geoAeoNotes: brief.geoAeoNotes,
        suggestedSearchIntent: brief.suggestedSearchIntent,
        conclusion: brief.conclusion,
        ctaPlacementSuggestion: brief.ctaPlacementSuggestion,
        externalSources: brief.externalSources,
        faq: brief.faq,
        keyTakeaways: brief.keyTakeaways,
        schemaSuggestions: brief.schemaSuggestions,
        statistics: brief.statistics,
        examples: brief.examples,
        briefSettings: settings,
      },
      keywords: input.keywordId ? { connect: [{ id: input.keywordId }] } : undefined,
    },
  });

  // Phase B B3.5 — best-effort, same reasoning as updateLongFormContentAction:
  // the Content row already exists by this point, so a logging failure must
  // not report the save as failed.
  try {
    await logActivity({
      actorId: actor.id,
      action: "content.ai_long_form_saved",
      companyId: actor.companyId,
      seoProjectId: seoProject.id,
      contentId: content.id,
      metadata: { title: content.title },
    });
  } catch (err) {
    console.error("Long-Form save: failed to record the activity log", {
      contentId: content.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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

  const newTitle = parsedFields.data.title;
  const newMetaTitle = parsedFields.data.metaTitle;
  const newMetaDescription = parsedFields.data.metaDescription;
  const newBody = parsedFields.data.body;

  // Phase 25 Stage 2 — same snapshot-before-overwrite discipline as
  // content.actions.ts's updateContent, with changeSource: AI_REGENERATION
  // since this is the AI-regeneration write-back path, not a manual edit.
  // See updateContent's comment for why the explicit lock-then-read here is
  // necessary (not just createContentRevisionSnapshot's own internal lock)
  // and why its subsequent re-lock is a harmless no-op, not a second real
  // lock.
  const preflight = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${content.id} FOR UPDATE`;
    const current = await tx.content.findUnique({ where: { id: content.id } });
    // Phase B M2 — re-checked inside the lock: the page can be trashed
    // between the ownership check and this write (stale editor screen).
    if (!current || current.deletedAt) {
      return { kind: "not_found" as const };
    }

    if (
      current.title !== newTitle ||
      current.metaTitle !== newMetaTitle ||
      current.metaDescription !== newMetaDescription ||
      current.body !== newBody
    ) {
      await createContentRevisionSnapshot(tx, {
        contentId: content.id,
        companyId: actor.companyId,
        title: current.title,
        metaTitle: current.metaTitle,
        metaDescription: current.metaDescription,
        body: current.body,
        changeSource: "AI_REGENERATION",
        createdByUserId: actor.id,
      });
    }

    await tx.content.update({
      where: { id: content.id },
      data: {
        title: newTitle,
        metaTitle: newMetaTitle,
        metaDescription: newMetaDescription,
        generatedByAi: true,
        body: newBody,
      },
    });
    return { kind: "updated" as const };
  });

  if (preflight.kind === "not_found") {
    return actionError("Content not found.");
  }

  // Phase B B3.5 — the Content write above has already committed. Activity
  // logging is best-effort telemetry, so a logging failure must never turn a
  // successful, already-persisted save into a reported failure. Same
  // try/catch shape applyContentRewriteAction and applyMetaTagSuggestionAction
  // already use for their own post-commit logs.
  try {
    await logActivity({
      actorId: actor.id,
      action: "content.ai_long_form_saved",
      companyId: actor.companyId,
      seoProjectId: content.seoProject.id,
      contentId: content.id,
      metadata: { title: parsedFields.data.title },
    });
  } catch (err) {
    console.error("Long-Form update: failed to record the activity log", {
      contentId: content.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath(`/seo/${content.seoProject.id}/content`);
  revalidatePath(`/seo/${content.seoProject.id}/content/${content.id}`);
  return actionSuccess({ id: content.id });
}
