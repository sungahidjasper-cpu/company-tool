"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { computeInputHash, createAiGenerationJob, findActiveAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";
import { runAiGenerationJob } from "@/lib/jobs/ai-generation-job-runner";
import {
  filterOwnedContentIds,
  filterOwnedKeywordIds,
  getOwnedCalendar,
  getOwnedKeywordCluster,
} from "@/features/ai-workspace/services/content-calendar.repository";
import {
  checkDateRange,
  contentCalendarInputSchema,
  parseIsoDate,
  calendarEntryStatusSchema,
  saveContentCalendarSchema,
  type ContentCalendarInput,
  type SaveContentCalendarInput,
} from "@/features/ai-workspace/schemas/content-calendar.schema";

/**
 * Verifies the SEO project belongs to the actor's company and is not trashed —
 * the same fetch-and-compare pattern every AI Workspace actions file
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
 * Starts a schedule generation. Nothing is persisted here beyond the job
 * itself — the proposed schedule is reviewed and edited first, then saved by
 * saveContentCalendarAction.
 */
export async function startContentCalendarAction(input: ContentCalendarInput): Promise<ActionResult<{ jobId: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to generate AI content.");
  }

  const parsed = contentCalendarInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await getOwnedSeoProject(parsed.data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  // A cluster is only usable when it genuinely belongs to this project.
  if (parsed.data.keywordClusterId) {
    const cluster = await getOwnedKeywordCluster(parsed.data.keywordClusterId, seoProject.id);
    if (!cluster) {
      return actionError("Topic cluster not found for this SEO project.");
    }
  }

  const inputHash = computeInputHash(parsed.data);
  const existing = await findActiveAiGenerationJob(actor.companyId, "CONTENT_CALENDAR", inputHash);
  if (existing) {
    return actionSuccess({ jobId: existing.id });
  }

  const job = await createAiGenerationJob({
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    taskType: "CONTENT_CALENDAR",
    inputJson: parsed.data,
    inputHash,
    createdById: actor.id,
  });
  void runAiGenerationJob(job.id);
  return actionSuccess({ jobId: job.id });
}

/**
 * The approval gate. Nothing the generator produced is stored until the user
 * explicitly saves, and everything they send back is re-validated here: by the
 * time a reviewed schedule returns it is ordinary client state.
 *
 * Writes the calendar and its entries in ONE transaction, so a partially
 * saved plan can never exist.
 */
export async function saveContentCalendarAction(input: SaveContentCalendarInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to save a content calendar.");
  }

  const parsed = saveContentCalendarSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid calendar");
  }
  const data = parsed.data;

  const seoProject = await getOwnedSeoProject(data.seoProjectId, actor.companyId);
  if (!seoProject) {
    return actionError("SEO project not found.");
  }

  const range = checkDateRange(data.startDate, data.endDate);
  if (!range.ok) {
    return actionError(range.message);
  }

  if (data.keywordClusterId) {
    const cluster = await getOwnedKeywordCluster(data.keywordClusterId, seoProject.id);
    if (!cluster) {
      return actionError("Topic cluster not found for this SEO project.");
    }
  }

  /*
   * Every keyword and content link is re-verified against THIS project before
   * anything is written. A link the project does not own is refused outright
   * rather than quietly dropped: silently discarding an association the user
   * can see on screen would be a worse outcome than telling them.
   */
  const keywordIds = data.entries.map((entry) => entry.keywordId).filter((id): id is string => typeof id === "string");
  const ownedKeywordIds = await filterOwnedKeywordIds(keywordIds, seoProject.id);
  if (keywordIds.some((id) => !ownedKeywordIds.has(id))) {
    return actionError("One of the keywords does not belong to this SEO project.");
  }

  const contentIds = data.entries.map((entry) => entry.contentId).filter((id): id is string => typeof id === "string");
  const ownedContentIds = await filterOwnedContentIds(contentIds, seoProject.id);
  if (contentIds.some((id) => !ownedContentIds.has(id))) {
    return actionError("One of the linked pages does not belong to this SEO project.");
  }

  // Dates were validated by the schema; parseIsoDate is called again here so
  // the value written is a normalised UTC-midnight Date, not a string.
  const entryRows = data.entries.map((entry, index) => {
    const scheduledDate = parseIsoDate(entry.scheduledDate);
    if (!scheduledDate) throw new Error("unreachable: schema already validated the date");
    return {
      scheduledDate,
      topic: entry.topic.trim(),
      contentType: entry.contentType,
      role: entry.role,
      status: entry.status,
      keywordId: entry.keywordId ?? null,
      contentId: entry.contentId ?? null,
      keywordClusterId: data.keywordClusterId ?? null,
      notes: entry.notes?.trim() ? entry.notes.trim() : null,
      sortOrder: index,
    };
  });

  const calendar = await prisma.$transaction(async (tx) =>
    tx.contentCalendar.create({
      data: {
        seoProjectId: seoProject.id,
        createdById: actor.id,
        name: data.name.trim(),
        startDate: range.range.start,
        endDate: range.range.end,
        notes: data.notes?.trim() ? data.notes.trim() : null,
        entries: { create: entryRows },
      },
      select: { id: true },
    })
  );

  await logActivity({
    actorId: actor.id,
    action: "contentCalendar.created",
    companyId: seoProject.companyId,
    seoProjectId: seoProject.id,
    metadata: { calendarId: calendar.id, name: data.name.trim(), entryCount: entryRows.length },
  });

  revalidatePath("/ai/content-calendar");
  return actionSuccess({ id: calendar.id });
}

export type UpdateCalendarEntryStatusInput = {
  calendarId: string;
  entryId: string;
  status: SaveContentCalendarInput["entries"][number]["status"];
};

/**
 * Moves ONE entry to a new status — the only edit a saved calendar supports
 * for now, and the only way an entry ever reaches PUBLISHED. Nothing about a
 * date passing, or a page existing, changes a status on its own.
 *
 * Deliberately does not touch the linked Content row: marking a plan entry
 * published is a statement about the plan, not about the page.
 */
export async function updateCalendarEntryStatusAction(input: UpdateCalendarEntryStatusInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to change a content calendar.");
  }

  const parsed = calendarEntryStatusSchema.safeParse(input?.status);
  if (!parsed.success) {
    return actionError("That status is not recognised.");
  }

  const calendar = await getOwnedCalendar(input?.calendarId ?? "", actor.companyId);
  if (!calendar) {
    return actionError("Content calendar not found.");
  }
  // The entry must belong to THIS calendar — an entry id alone is never enough.
  const entry = calendar.entries.find((candidate) => candidate.id === input?.entryId);
  if (!entry) {
    return actionError("Calendar entry not found.");
  }

  await prisma.contentCalendarEntry.update({ where: { id: entry.id }, data: { status: parsed.data } });

  await logActivity({
    actorId: actor.id,
    action: "contentCalendar.entryStatusChanged",
    seoProjectId: calendar.seoProjectId,
    metadata: { calendarId: calendar.id, entryId: entry.id, status: parsed.data },
  });

  revalidatePath(`/ai/content-calendar/${calendar.id}`);
  return actionSuccess({ id: entry.id });
}

/**
 * Soft-deletes a calendar and its entries, matching how every other record in
 * this application is removed. Never a hard delete, so a mistake is
 * recoverable.
 */
export async function deleteContentCalendarAction(calendarId: string): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to delete a content calendar.");
  }

  const calendar = await getOwnedCalendar(calendarId, actor.companyId);
  if (!calendar) {
    return actionError("Content calendar not found.");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.contentCalendarEntry.updateMany({ where: { calendarId: calendar.id, deletedAt: null }, data: { deletedAt: now } });
    await tx.contentCalendar.update({ where: { id: calendar.id }, data: { deletedAt: now } });
  });

  await logActivity({
    actorId: actor.id,
    action: "contentCalendar.deleted",
    seoProjectId: calendar.seoProjectId,
    metadata: { calendarId: calendar.id, name: calendar.name },
  });

  revalidatePath("/ai/content-calendar");
  return actionSuccess({ id: calendar.id });
}
