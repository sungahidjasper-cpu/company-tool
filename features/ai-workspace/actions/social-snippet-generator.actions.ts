"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { socialSnippetGeneratorInputSchema, type SocialSnippetGeneratorInput } from "@/features/ai-workspace/schemas/social-snippet-generator.schema";

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

/** Same ownership shape as internal-link-analyzer.actions.ts's own getOwnedContent, trimmed to only the fields this tool needs. */
async function getOwnedContent(contentId: string, companyId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { seoProject: { select: { companyId: true } } },
  });
  if (!content || content.seoProject.companyId !== companyId) return null;
  return content;
}

/**
 * Background-job counterpart to the other tools' startXGenerationAction —
 * no synchronous variant, matching Internal Link Analyzer's shape. No save
 * action exists for this tool: the result is generate-and-display-and-copy
 * only, never persisted or auto-inserted into any Content row.
 */
export async function startSocialSnippetGeneratorAction(input: SocialSnippetGeneratorInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = socialSnippetGeneratorInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const sourceContent = await getOwnedContent(parsed.data.contentId, actor.companyId);
  if (!sourceContent || sourceContent.seoProjectId !== seoProject.id) {
    return actionError("Content not found for this SEO project.");
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "SOCIAL_SNIPPET_GENERATION", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    contentId: sourceContent.id,
    taskType: "SOCIAL_SNIPPET_GENERATION",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}
