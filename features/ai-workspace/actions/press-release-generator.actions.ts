"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob, getAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import {
  formatPressReleaseAsMarkdown,
  pressReleaseGeneratorInputSchema,
  pressReleaseJobResultSchema,
  type PressReleaseGeneratorInput,
} from "@/features/ai-workspace/schemas/press-release-generator.schema";

/**
 * Verifies the SEO project belongs to the actor's company — the same
 * fetch-and-compare pattern every AI Workspace actions file duplicates its
 * own copy of (a "use server" file may only export async functions, so a
 * plain helper can't be shared directly).
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  return seoProject;
}

/**
 * Background-job counterpart to the other tools' startXGenerationAction —
 * no synchronous variant, matching every other tool's shape. Generation
 * only: this tool never reads or writes Content, and never creates a
 * ContentRevision — see press-release-generator.service.ts and
 * lib/jobs/ai-generation-job-runner.ts's dispatchPressReleaseGenerator,
 * neither of which touches either model at all. There is no contentId in
 * this action's input at all — no getOwnedContent helper exists in this
 * file because there is nothing to own beyond the SEO project.
 *
 * Never trusts any client-supplied companyId: companyId always comes from
 * the authenticated actor (requireUser()), never from the input object.
 */
export async function startPressReleaseGenerationAction(input: PressReleaseGeneratorInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = pressReleaseGeneratorInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "PRESS_RELEASE_GENERATION", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    taskType: "PRESS_RELEASE_GENERATION",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}

/**
 * The explicit "Save as Content" gate — this tool's own version of
 * saveEmailNewsletterAsContentAction / saveLongFormAsNewContentAction, the
 * established pattern for turning a finished AI Workspace draft into a real,
 * calendar-visible Content row.
 *
 * ONE FIELD, ON PURPOSE: the browser supplies only which job to save. The
 * actual generated text is never trusted from client input — it is re-read
 * from the job row's own `resultJson`. companyId always comes from
 * requireUser(), never the input.
 *
 * Creates a Content row and nothing else — no idempotency layer, same as
 * this pattern's other two implementations; the UI's disabled-while-saving
 * state is what actually prevents an accidental double-submit.
 */
export async function savePressReleaseAsContentAction(input: { jobId: string }): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to save content.");
  }

  if (typeof input?.jobId !== "string" || input.jobId.trim().length === 0) {
    return actionError("Generation job not found.");
  }

  const job = await getAiGenerationJob(input.jobId);
  if (!job || job.companyId !== actor.companyId || job.taskType !== "PRESS_RELEASE_GENERATION") {
    return actionError("Generation job not found.");
  }
  if (job.status !== "SUCCEEDED") {
    return actionError("This draft has not finished generating yet.");
  }

  const parsedResult = pressReleaseJobResultSchema.safeParse(job.resultJson);
  if (!parsedResult.success || parsedResult.data.result === null) {
    return actionError("This draft has no result to save — try generating again.");
  }
  const pressRelease = parsedResult.data.result;

  if (!job.seoProjectId) {
    return actionError("SEO project not found.");
  }
  const seoProject = await getOwnedSeoProject(job.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const title = pressRelease.headline.trim() || "Untitled press release";

  const content = await prisma.content.create({
    data: {
      companyId: actor.companyId,
      clientId: seoProject.clientId ?? null,
      seoProjectId: seoProject.id,
      contentType: "PRESS_RELEASE",
      authorId: actor.id,
      title,
      status: "DRAFT",
      generatedByAi: true,
      body: formatPressReleaseAsMarkdown(pressRelease),
      // The full canonical result, so subheadline/dateline/reasoning — and
      // every other field — survive intact regardless of how the body above
      // was serialized. Never trusted from client input; this is the SAME
      // object just re-validated from the job's own stored resultJson.
      aiBriefDetails: pressRelease,
    },
  });

  try {
    await logActivity({
      actorId: actor.id,
      action: "content.ai_press_release_saved",
      companyId: actor.companyId,
      seoProjectId: seoProject.id,
      contentId: content.id,
      metadata: { title: content.title },
    });
  } catch (err) {
    console.error("Press Release save: failed to record the activity log", {
      contentId: content.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath(`/seo/${seoProject.id}/content`);
  revalidatePath(`/seo/${seoProject.id}/content/${content.id}`);
  revalidatePath("/ai");
  return actionSuccess({ id: content.id });
}
