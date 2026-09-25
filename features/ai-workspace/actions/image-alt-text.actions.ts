"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { getProjectImage } from "@/features/ai-workspace/services/project-image-inventory";
import {
  DESCRIPTION_REQUIRED_MESSAGE,
  hasEnoughImageEvidence,
  imageAltTextInputSchema,
  type ImageAltTextInput,
} from "@/features/ai-workspace/schemas/image-alt-text.schema";

/**
 * Verifies the SEO project belongs to the actor's company and is not trashed
 * — the same fetch-and-compare pattern every AI Workspace actions file
 * duplicates its own copy of (a "use server" file may only export async
 * functions, so a plain helper cannot be shared directly).
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  if (seoProject.deletedAt) return null;
  return seoProject;
}

/**
 * The thirteenth AI Workspace tool's generation action.
 *
 * Review-only: no save or apply action exists, and none can — the File model
 * carries no altText column, so there is no existing safe update path to
 * apply a result through. Nothing here writes to File or Content.
 */
export async function startImageAltTextAction(input: ImageAltTextInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = imageAltTextInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  /*
   * Scoped to the already-verified project, which is what makes this one
   * query sufficient: a file of another company can only reach this project
   * id by belonging to it, which it does not. Non-image, soft-deleted,
   * cross-project and trashed-Content files all return null here and are all
   * reported identically, so the response discloses nothing.
   */
  const image = await getProjectImage(parsed.data.fileId, seoProject.id);
  if (!image) {
    return actionError("Image not found for this SEO project.");
  }

  /*
   * Checked before a job is created, so the user is never charged a
   * generation — and never shown a provider or AI-quality error — for what is
   * simply a missing description. The provider cannot see the image, so
   * without this there is nothing to write alt text from.
   */
  if (!hasEnoughImageEvidence({ imageDescription: parsed.data.imageDescription })) {
    return actionError(DESCRIPTION_REQUIRED_MESSAGE);
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "IMAGE_ALT_TEXT", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    // The Content association, when the image has one — recorded so the job
    // is traceable to the page, never used as evidence of image contents.
    contentId: image.contentId ?? undefined,
    taskType: "IMAGE_ALT_TEXT",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}
