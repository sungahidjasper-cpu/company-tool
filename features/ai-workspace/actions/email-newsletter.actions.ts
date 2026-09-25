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
  emailNewsletterInputSchema,
  emailNewsletterJobResultSchema,
  formatEmailNewsletterAsMarkdown,
  hasEnoughSourceMaterial,
  INSUFFICIENT_SOURCE_MATERIAL_MESSAGE,
  type EmailNewsletterInput,
} from "@/features/ai-workspace/schemas/email-newsletter.schema";

/**
 * Verifies the SEO project belongs to the actor's company and is not
 * trashed — the same fetch-and-compare pattern every AI Workspace actions
 * file duplicates its own copy of (a "use server" file may only export async
 * functions, so a plain helper cannot be shared directly).
 */
async function getOwnedSeoProject(seoProjectId: string, companyId: string) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return null;
  // A trashed project is not a generatable project — the same rule every
  // other connected tool enforces. The picker lists only live projects, but
  // that is a convenience; this is the boundary.
  if (seoProject.deletedAt) return null;
  return seoProject;
}

/**
 * Re-fetches the source Content from the database and verifies it belongs to
 * the actor's company. The client's claim about which project or company a
 * content id belongs to is never trusted — only this query decides.
 *
 * The project MATCH is asserted by the caller, which compares
 * content.seoProjectId against the already-verified project, so a content id
 * from another project of the same company is refused too.
 */
async function getOwnedContent(contentId: string, companyId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { seoProject: { select: { companyId: true } } },
  });
  if (!content || content.companyId !== companyId) return null;
  // A trashed page is not a drafting source.
  if (content.deletedAt) return null;
  return content;
}

/**
 * The twelfth AI Workspace tool's generation action. Background-job only,
 * matching every recent tool's shape. No save action exists for this tool
 * and none is planned: the result is drafted, displayed and copied — never
 * persisted, never written back to Content, and never sent anywhere.
 */
export async function startEmailNewsletterAction(input: EmailNewsletterInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = emailNewsletterInputSchema.safeParse(input);
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

  /*
   * Refused BEFORE a job is created, so the user is never charged a
   * generation for material that cannot produce a grounded newsletter, and
   * never sees a provider or quality error for what is really a missing-input
   * situation. Checked against the RE-FETCHED row, not the client's claim
   * about it.
   */
  if (!hasEnoughSourceMaterial({ body: sourceContent.body, additionalContext: parsed.data.additionalContext })) {
    return actionError(INSUFFICIENT_SOURCE_MATERIAL_MESSAGE);
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "EMAIL_NEWSLETTER", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    contentId: sourceContent.id,
    taskType: "EMAIL_NEWSLETTER",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}

/**
 * The explicit "Save as Content" gate — this tool's own version of
 * saveLongFormAsNewContentAction, the established pattern for turning a
 * finished AI Workspace draft into a real, calendar-visible Content row.
 *
 * ONE FIELD, ON PURPOSE, same discipline social-publish.schema.ts's own
 * publishSocialPostTargetSchema documents: the browser supplies only which
 * job to save. The actual generated text is never trusted from client input
 * — it is re-read from the job row's own `resultJson`, so a request cannot
 * smuggle in different newsletter content than what this job actually
 * produced. companyId always comes from requireUser(), never the input.
 *
 * Creates a Content row and nothing else — the job row itself is left
 * exactly as it was, so this may be called more than once (e.g. two tabs, a
 * double click) and each call independently creates its own Content row,
 * the same "no idempotency layer" behavior saveLongFormAsNewContentAction
 * already has. The UI-level disabled-while-saving state is what actually
 * prevents an accidental double-submit.
 */
export async function saveEmailNewsletterAsContentAction(input: { jobId: string }): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to save content.");
  }

  if (typeof input?.jobId !== "string" || input.jobId.trim().length === 0) {
    return actionError("Generation job not found.");
  }

  const job = await getAiGenerationJob(input.jobId);
  if (!job || job.companyId !== actor.companyId || job.taskType !== "EMAIL_NEWSLETTER") {
    return actionError("Generation job not found.");
  }
  if (job.status !== "SUCCEEDED") {
    return actionError("This draft has not finished generating yet.");
  }

  const parsedResult = emailNewsletterJobResultSchema.safeParse(job.resultJson);
  if (!parsedResult.success || !parsedResult.data.result) {
    return actionError("This draft has no result to save — try generating again.");
  }
  const newsletter = parsedResult.data.result;

  if (!job.seoProjectId) {
    return actionError("SEO project not found.");
  }
  const seoProject = await getOwnedSeoProject(job.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const title = newsletter.subjectLine.trim() || newsletter.headline.trim() || "Untitled newsletter";

  const content = await prisma.content.create({
    data: {
      companyId: actor.companyId,
      clientId: seoProject.clientId ?? null,
      seoProjectId: seoProject.id,
      contentType: "NEWSLETTER",
      authorId: actor.id,
      title,
      status: "DRAFT",
      generatedByAi: true,
      body: formatEmailNewsletterAsMarkdown(newsletter),
      // The full canonical result, so subjectLine/previewText/reasoning — and
      // every other field — survive intact regardless of how the body above
      // was serialized. Never trusted from client input; this is the SAME
      // object just re-validated from the job's own stored resultJson.
      aiBriefDetails: newsletter,
    },
  });

  try {
    await logActivity({
      actorId: actor.id,
      action: "content.ai_email_newsletter_saved",
      companyId: actor.companyId,
      seoProjectId: seoProject.id,
      contentId: content.id,
      metadata: { title: content.title },
    });
  } catch (err) {
    console.error("Email Newsletter save: failed to record the activity log", {
      contentId: content.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  revalidatePath(`/seo/${seoProject.id}/content`);
  revalidatePath(`/seo/${seoProject.id}/content/${content.id}`);
  revalidatePath("/ai");
  return actionSuccess({ id: content.id });
}
