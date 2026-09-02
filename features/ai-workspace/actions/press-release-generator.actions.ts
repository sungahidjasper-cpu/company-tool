"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { pressReleaseGeneratorInputSchema, type PressReleaseGeneratorInput } from "@/features/ai-workspace/schemas/press-release-generator.schema";

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
