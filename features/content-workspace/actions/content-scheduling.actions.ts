"use server";

import { revalidatePath } from "next/cache";

import {
  CLEARED_SCHEDULE,
  STATUS_AFTER_SCHEDULE_CANCELLED,
  formatScheduledFor,
  validateScheduleRequest,
} from "@/features/content-workspace/services/content-scheduling";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Phase 5 — the only two operations that may write scheduling state.
 *
 * Nothing else in the workspace writes it: clicking a date, opening the
 * creation panel, choosing a time and picking a content type are all pure
 * navigation. A schedule exists only because someone pressed a button that
 * called one of these.
 *
 * Ownership is re-derived here from the authenticated actor every time. The
 * contentId is a client-supplied string and is treated as one: it is checked
 * for shape, then resolved through the actor's own company, and the project's
 * and record's soft-delete state are both re-checked. No URL parameter, no
 * hidden field and no client value grants access to anything.
 */

/** Company-scoped lookup. Returns null for a malformed id, another company's row, or a missing row. */
async function getOwnedContent(contentId: string, companyId: string) {
  if (!isUuid(contentId)) return null;
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      title: true,
      status: true,
      deletedAt: true,
      scheduledAt: true,
      scheduledTimezone: true,
      seoProjectId: true,
      companyId: true,
      seoProject: { select: { id: true, companyId: true, deletedAt: true } },
    },
  });
  if (!content || content.companyId !== companyId) return null;
  return content;
}

export type ScheduleContentInput = {
  contentId: string;
  /** The wall-clock date the user chose, as YYYY-MM-DD. */
  dateIso: string;
  /** The wall-clock time the user chose, as HH:MM (24h). */
  time: string;
  /** The IANA zone the user chose. Validated against the runtime, never trusted. */
  timeZone: string;
};

export async function scheduleContentAction(input: ScheduleContentInput): Promise<ActionResult<{ scheduledFor: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to schedule content.");
  }

  const content = await getOwnedContent(input.contentId, actor.companyId);
  if (!content) return actionError("Content not found.");

  const validation = validateScheduleRequest({
    request: { dateIso: input.dateIso, time: input.time, timeZone: input.timeZone },
    status: content.status,
    contentDeletedAt: content.deletedAt,
    // No project means nothing project-level can block the schedule.
    projectDeletedAt: content.seoProject?.deletedAt ?? null,
    now: new Date(),
  });
  if (!validation.ok) return actionError(validation.error);

  /*
   * The write is guarded by the state it was validated against. If the row
   * changed underneath us — published or trashed by someone else between the
   * read and the write — the guard matches nothing and the schedule is
   * refused rather than applied to a row that has moved on.
   *
   * publishedAt is deliberately absent from the update: a schedule is an
   * intention, and writing a publication date for it would be a lie.
   */
  const applied = await prisma.$transaction(async (tx) => {
    const guarded = await tx.content.updateMany({
      where: { id: content.id, deletedAt: null, status: content.status },
      data: {
        status: "SCHEDULED",
        scheduledAt: validation.instant,
        scheduledTimezone: input.timeZone,
      },
    });
    return guarded.count === 1;
  });

  if (!applied) return actionError("This content changed while you were scheduling it. Reload and try again.");

  const scheduledFor = formatScheduledFor(validation.instant, input.timeZone);

  await logActivity({
    actorId: actor.id,
    action: "content.scheduled",
    companyId: actor.companyId,
    seoProjectId: content.seoProjectId ?? undefined,
    contentId: content.id,
    metadata: { scheduledAt: validation.instant.toISOString(), timezone: input.timeZone, from: content.status },
  });

  revalidatePath("/content");
  revalidatePath(`/seo/${content.seoProjectId}/content/${content.id}`);
  revalidatePath(`/seo/${content.seoProjectId}/content`);
  return actionSuccess({ scheduledFor });
}

export async function cancelContentScheduleAction(input: { contentId: string }): Promise<ActionResult> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to change content scheduling.");
  }

  const content = await getOwnedContent(input.contentId, actor.companyId);
  if (!content) return actionError("Content not found.");
  if (content.status !== "SCHEDULED") return actionError("This content is not scheduled.");

  /*
   * Cancelling returns the content to DRAFT and clears BOTH schedule fields
   * together, so a row can never be left claiming a schedule it no longer
   * has. publishedAt is untouched — cancelling a schedule has nothing to say
   * about whether something was ever published.
   */
  const cancelled = await prisma.$transaction(async (tx) => {
    const guarded = await tx.content.updateMany({
      where: { id: content.id, status: "SCHEDULED" },
      data: { status: STATUS_AFTER_SCHEDULE_CANCELLED, ...CLEARED_SCHEDULE },
    });
    return guarded.count === 1;
  });

  if (!cancelled) return actionError("This content changed while you were cancelling. Reload and try again.");

  await logActivity({
    actorId: actor.id,
    action: "content.schedule_cancelled",
    companyId: actor.companyId,
    seoProjectId: content.seoProjectId ?? undefined,
    contentId: content.id,
    metadata: { previousScheduledAt: content.scheduledAt?.toISOString() ?? null, previousTimezone: content.scheduledTimezone },
  });

  revalidatePath("/content");
  revalidatePath(`/seo/${content.seoProjectId}/content/${content.id}`);
  revalidatePath(`/seo/${content.seoProjectId}/content`);
  return actionSuccess();
}
