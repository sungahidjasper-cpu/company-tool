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
import { generateContentBrief } from "@/features/ai-workspace/services/content-brief.service";
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
