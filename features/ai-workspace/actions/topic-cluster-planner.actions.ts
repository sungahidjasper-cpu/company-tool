"use server";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import { topicClusterPlannerInputSchema, type TopicClusterPlannerInput } from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";

/**
 * Verifies the SEO project belongs to the actor's company AND is not
 * archived — the same fetch-and-compare pattern every other action file
 * duplicates its own copy of (a "use server" file may only export async
 * functions, so a plain helper can't be shared from one action file to
 * another). The soft-delete check is included from the start here, matching
 * the rule the connected tools now all enforce.
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  if (seoProject.deletedAt) return null;
  return seoProject;
}

/**
 * The tenth AI Workspace tool's start action.
 *
 * The seed topic is user input and is carried through as such. keywordIds,
 * by contrast, name real platform records: they are re-verified here against
 * the selected project (company + project + not soft-deleted) and any id
 * that doesn't resolve causes the request to be rejected rather than
 * silently ignored — a selection the user cannot actually own should not
 * quietly become a smaller selection.
 *
 * Generate-and-display only: no Content, Keyword, or KeywordCluster row is
 * created or modified anywhere in this tool.
 */
export async function startTopicClusterPlannerAction(input: TopicClusterPlannerInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = topicClusterPlannerInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  if (parsed.data.keywordIds.length > 0) {
    const uniqueIds = Array.from(new Set(parsed.data.keywordIds));
    const owned = await prisma.keyword.findMany({
      where: { id: { in: uniqueIds }, seoProjectId: seoProject.id, deletedAt: null },
      select: { id: true },
    });
    if (owned.length !== uniqueIds.length) {
      return actionError("One or more selected keywords could not be found in this SEO project.");
    }
  }

  const jobInput = {
    seoProjectId: seoProject.id,
    seedTopic: parsed.data.seedTopic,
    keywordIds: parsed.data.keywordIds,
    audience: parsed.data.audience,
    notes: parsed.data.notes,
  };

  const inputHash = computeInputHash(jobInput);
  const existing = await findActiveAiGenerationJob(actor.companyId, "TOPIC_CLUSTER_PLANNING", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    taskType: "TOPIC_CLUSTER_PLANNING",
    inputJson: jobInput,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}
