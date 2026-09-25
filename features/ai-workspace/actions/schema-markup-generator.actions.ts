"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { schemaMarkupInputSchema, type SchemaMarkupInput } from "@/features/ai-workspace/schemas/schema-markup-generator.schema";

/**
 * Verifies the SEO project belongs to the actor's company — the same
 * fetch-and-compare pattern content-brief.actions.ts/long-form-content.actions.ts
 * each already duplicate their own copy of, rather than sharing one (a
 * "use server" file may only export async functions, so a plain helper
 * can't be imported from either of those files here).
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  /*
   * C4.3 follow-up — a TRASHED project is rejected here too. The route only
   * ever lists live projects (listSeoProjectOptions) and the C4 contextual
   * action hides itself for one, but neither of those is the security
   * boundary: this function is. A crafted request naming a soft-deleted
   * project of the actor's own company used to pass.
   *
   * Truthy rather than `!== null`, matching content-rewriter.actions.ts and
   * meta-tag-optimizer.actions.ts — a caller or fixture may omit the field
   * entirely, and `undefined !== null` would wrongly reject a live row.
   */
  if (seoProject.deletedAt) return null;
  return seoProject;
}

/**
 * Same two-factor ownership shape content-rewriter.actions.ts and
 * meta-tag-optimizer.actions.ts already use: the row must belong to the
 * actor's company AND to the specific SEO project the request names.
 * Phase B M1 — company-only was not enough: this action's error message
 * has always said "for this SEO project", but a contentId from a different
 * project in the same company used to pass and get written onto the job
 * alongside an unrelated seoProjectId.
 */
async function getOwnedContent(contentId: string, companyId: string, seoProjectId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { seoProject: { select: { companyId: true } } },
  });
  if (!content || content.companyId !== companyId || content.seoProjectId !== seoProjectId) return null;
  // C4.3 follow-up — a trashed Content row reads back as "not found" here as
  // well, the same lifecycle rule content-rewriter.actions.ts and
  // meta-tag-optimizer.actions.ts already enforce. The route excludes
  // soft-deleted rows from its own list, but the server is the boundary.
  if (content.deletedAt) return null;
  return content;
}

/**
 * Background-job counterpart to the two existing tools' startXGenerationAction
 * — this tool has no synchronous/inline variant, matching how Meta Tag
 * Optimizer-style tools would; there's no UX reason to skip the job/poll
 * pattern for a call this shape. No save action exists for this tool: the
 * result is generate-and-display-and-copy only, never persisted (see
 * schema-markup-generator.service.ts's own comment on why).
 */
export async function startSchemaMarkupGenerationAction(input: SchemaMarkupInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = schemaMarkupInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  if (parsed.data.contentId) {
    const owned = await getOwnedContent(parsed.data.contentId, actor.companyId, seoProject.id);
    if (!owned) {
      return actionError("Content not found for this SEO project.");
    }
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "SCHEMA_MARKUP_GENERATION", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    contentId: parsed.data.contentId,
    taskType: "SCHEMA_MARKUP_GENERATION",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}
