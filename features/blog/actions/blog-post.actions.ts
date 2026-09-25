"use server";

import { revalidatePath } from "next/cache";

import { validateScheduleRequest } from "@/features/content-workspace/services/content-scheduling";
import { MANUALLY_SELECTABLE_CONTENT_STATUSES } from "@/features/seo/schemas/content.schema";
import { createContentRevisionSnapshot } from "@/features/seo/services/content-revision.service";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { contentRevalidatePaths } from "@/features/content-workspace/services/content-location";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Phase 7 — saving an article from the Blog Studio.
 *
 * The article is an ordinary Content record: same table, same ownership
 * chain, same Phase 5 scheduling, same revision history. The studio is a
 * better way to write one, not a second kind of content.
 *
 * `body` arrives as Markdown — the format Content.body has always held — so
 * the AI tools, the WordPress publisher and the revision diff keep reading
 * exactly what they read before.
 */

const MAX_TITLE = 200;
const MAX_META_TITLE = 200;
const MAX_META_DESCRIPTION = 400;
const MAX_BODY = 400_000;

export type SaveBlogPostInput = {
  contentId?: string;
  /** The client this article is for. REQUIRED — it is what the article belongs to. */
  clientId: string;
  /**
   * Optional SEO project context. Only keywords need it: a project supplies
   * the keyword list, so without one the article simply has no keywords to
   * attach — everything else about a blog post is client-level.
   */
  seoProjectId?: string;
  title: string;
  /** Canonical Markdown, produced by serializeMarkdownBlocks. */
  body: string;
  metaTitle: string;
  metaDescription: string;
  /** The article's URL/slug as typed. Stored on Content.url. */
  url: string;
  authorId: string;
  keywordIds: string[];
  /** Company-owned tags. Filtered to this company's own before anything is written. */
  tagIds: string[];
  /**
   * An explicit editorial status. Omitted means "leave the status alone",
   * which is what Save draft does to a record that is already scheduled —
   * editing an article should not silently unschedule it.
   *
   * SCHEDULED is never accepted here: that value is only reachable through the
   * scheduling path, which supplies a date, a time and a zone.
   */
  status?: string;
  schedule?: { dateIso: string; time: string; timeZone: string };
};

async function getOwnedProject(seoProjectId: string, companyId: string) {
  if (!isUuid(seoProjectId)) return null;
  const project = await prisma.sEOProject.findUnique({
    where: { id: seoProjectId },
    select: { id: true, companyId: true, clientId: true, deletedAt: true },
  });
  if (!project || project.companyId !== companyId) return null;
  return project;
}

export async function saveBlogPostAction(input: SaveBlogPostInput): Promise<ActionResult<{ contentId: string; scheduled: boolean }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to write articles.");
  }

  const client = await prisma.client.findUnique({ where: { id: isUuid(input.clientId) ? input.clientId : "00000000-0000-0000-0000-000000000000" }, select: { id: true, companyId: true, deletedAt: true } });
  if (!client || client.companyId !== actor.companyId) return actionError("Client not found.");
  if (client.deletedAt !== null) return actionError("This client is in the trash. Restore it before creating content for it.");

  const project = input.seoProjectId ? await getOwnedProject(input.seoProjectId, actor.companyId) : null;
  if (input.seoProjectId && !project) return actionError("SEO project not found.");
  if (project && project.clientId !== client.id) return actionError("That SEO project belongs to a different client.");
  if (project && project.deletedAt !== null) return actionError("This SEO project is in the trash. Restore it before writing in it.");

  const title = input.title.trim();
  if (title.length < 2) return actionError("Give the article a title of at least 2 characters.");
  if (title.length > MAX_TITLE) return actionError(`Keep the title under ${MAX_TITLE} characters.`);
  if (input.body.length > MAX_BODY) return actionError("This article is too long to save.");
  if (input.metaTitle.length > MAX_META_TITLE) return actionError(`Keep the SEO title under ${MAX_META_TITLE} characters.`);
  if (input.metaDescription.length > MAX_META_DESCRIPTION) return actionError(`Keep the meta description under ${MAX_META_DESCRIPTION} characters.`);

  const url = input.url.trim();
  if (url.length > 0 && /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url)) {
    return actionError("A URL must be an http:// or https:// address, or a plain path.");
  }

  // An existing article must be this company's, live, and in this project.
  let existing: { id: string; status: string; title: string; metaTitle: string | null; metaDescription: string | null; body: string | null } | null = null;
  if (input.contentId !== undefined) {
    if (!isUuid(input.contentId)) return actionError("Content not found.");
    const row = await prisma.content.findUnique({
      where: { id: input.contentId },
      select: {
        id: true,
        status: true,
        title: true,
        metaTitle: true,
        metaDescription: true,
        body: true,
        deletedAt: true,
        companyId: true,
        clientId: true,
        seoProjectId: true,
        socialPost: { select: { id: true } },
      },
    });
    if (!row || row.companyId !== actor.companyId || row.clientId !== client.id) return actionError("Content not found.");
    if (row.deletedAt !== null) return actionError("This content is in the trash. Restore it before editing.");
    // A social post is a different kind of record with its own composer.
    if (row.socialPost !== null) return actionError("This content is a social post. Open it in the social composer instead.");
    existing = { id: row.id, status: row.status, title: row.title, metaTitle: row.metaTitle, metaDescription: row.metaDescription, body: row.body };
  }

  /*
   * Keywords are filtered to this project's own. A keyword id from another
   * project simply does not survive, so a manipulated value cannot attach
   * one article to another project's keyword.
   */
  const keywordIds = [...new Set(input.keywordIds.filter(isUuid))];
  const ownedKeywordIds =
    keywordIds.length === 0
      ? []
      : project === null
        ? [] // Keywords belong to a project; with no project there are none to attach.
        : (await prisma.keyword.findMany({ where: { id: { in: keywordIds }, seoProjectId: project.id }, select: { id: true } })).map((row) => row.id);

  /*
   * Tags are company-owned, so they are filtered by the ACTOR's company. A tag
   * id from another company simply does not come back and therefore cannot be
   * attached — the filter is the boundary, not a check a caller could skip.
   */
  const tagIds = [...new Set(input.tagIds.filter(isUuid))];
  const ownedTagIds =
    tagIds.length === 0
      ? []
      : (await prisma.tag.findMany({ where: { id: { in: tagIds }, companyId: actor.companyId }, select: { id: true } })).map((row) => row.id);

  /*
   * An explicit status is honoured only if a human may legitimately choose it.
   * MANUALLY_SELECTABLE_CONTENT_STATUSES excludes SCHEDULED for exactly this
   * reason, so a hand-crafted request cannot claim a schedule it has no date
   * for.
   */
  let requestedStatus: (typeof MANUALLY_SELECTABLE_CONTENT_STATUSES)[number] | null = null;
  if (input.status !== undefined && input.status !== "") {
    if (!(MANUALLY_SELECTABLE_CONTENT_STATUSES as readonly string[]).includes(input.status)) {
      return actionError("That is not a status you can set here. Use the scheduling controls to schedule this article.");
    }
    requestedStatus = input.status as (typeof MANUALLY_SELECTABLE_CONTENT_STATUSES)[number];
  }

  let scheduledInstant: Date | null = null;
  if (input.schedule) {
    const validation = validateScheduleRequest({
      request: input.schedule,
      status: existing?.status === "SCHEDULED" ? "SCHEDULED" : "DRAFT",
      contentDeletedAt: null,
      // No project means nothing project-level can block the schedule.
      projectDeletedAt: project?.deletedAt ?? null,
      now: new Date(),
    });
    if (!validation.ok) return actionError(validation.error);
    scheduledInstant = validation.instant;
  }

  const contentData = {
    title,
    body: input.body,
    metaTitle: input.metaTitle.trim() || null,
    metaDescription: input.metaDescription.trim() || null,
    url: url || null,
    authorId: isUuid(input.authorId) ? input.authorId : null,
    /*
     * Three cases, in order of authority:
     *  - a schedule was requested, so the record is SCHEDULED with its fields;
     *  - a status was chosen, so it takes effect and any schedule is cleared
     *    with it (a non-SCHEDULED row must never keep a scheduled instant);
     *  - neither, so an existing record keeps whatever it had and a new one
     *    starts as DRAFT.
     */
    ...(scheduledInstant
      ? { status: "SCHEDULED" as const, scheduledAt: scheduledInstant, scheduledTimezone: input.schedule!.timeZone }
      : requestedStatus
        ? { status: requestedStatus, scheduledAt: null, scheduledTimezone: null }
        : existing
          ? {}
          : { status: "DRAFT" as const, scheduledAt: null, scheduledTimezone: null }),
  };

  const result = await prisma.$transaction(async (tx) => {
    if (!existing) {
      const created = await tx.content.create({
        data: {
          companyId: actor.companyId,
          clientId: client.id,
          seoProjectId: project?.id ?? null,
          contentType: "BLOG_POST",
          ...contentData,
          keywords: ownedKeywordIds.length ? { connect: ownedKeywordIds.map((id) => ({ id })) } : undefined,
          tags: ownedTagIds.length ? { connect: ownedTagIds.map((id) => ({ id })) } : undefined,
        },
      });
      return { contentId: created.id, revised: false };
    }

    /*
     * The EXISTING revision service, in the same transaction as the write, so
     * the snapshot and the change roll back together. No second revision
     * system was introduced — this is the one the Content detail page and the
     * AI apply paths already use.
     */
    const changed = existing.title !== title || (existing.body ?? "") !== input.body || (existing.metaTitle ?? "") !== (contentData.metaTitle ?? "") || (existing.metaDescription ?? "") !== (contentData.metaDescription ?? "");
    if (changed) {
      await createContentRevisionSnapshot(tx, {
        contentId: existing.id,
        companyId: actor.companyId,
        title: existing.title,
        metaTitle: existing.metaTitle,
        metaDescription: existing.metaDescription,
        body: existing.body,
        changeSource: "MANUAL_EDIT",
        createdByUserId: actor.id,
      });
    }

    await tx.content.update({
      where: { id: existing.id },
      data: { ...contentData, keywords: { set: ownedKeywordIds.map((id) => ({ id })) }, tags: { set: ownedTagIds.map((id) => ({ id })) } },
    });
    return { contentId: existing.id, revised: changed };
  });

  await logActivity({
    actorId: actor.id,
    action: existing ? "content.updated" : "content.created",
    companyId: actor.companyId,
    seoProjectId: project?.id ?? undefined,
    clientId: client.id,
    contentId: result.contentId,
    metadata: { title, ...(scheduledInstant ? { scheduledAt: scheduledInstant.toISOString(), timezone: input.schedule!.timeZone } : {}) },
  });

  revalidatePath("/content");
  contentRevalidatePaths({ id: result.contentId, seoProjectId: project?.id ?? null }).forEach((path) => revalidatePath(path));

  return actionSuccess({ contentId: result.contentId, scheduled: scheduledInstant !== null });
}
