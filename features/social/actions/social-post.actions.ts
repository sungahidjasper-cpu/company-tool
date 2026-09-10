"use server";

import { revalidatePath } from "next/cache";

import { contentRevalidatePaths } from "@/features/content-workspace/services/content-location";
import { validateScheduleRequest } from "@/features/content-workspace/services/content-scheduling";
import { assertSafePublicUrl } from "@/features/publishing/services/ssrf-guard.service";
import { deriveSocialPostTitle, inheritingPlatforms, validateComposerDraft, validateTargets, type TargetDraft } from "@/features/social/services/social-composer";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";
import { isUuid } from "@/lib/utils";

/**
 * Phase 6 — saving a social post.
 *
 * A social post IS a Content record with a SocialPost child, so it inherits
 * the Company → Client → SEO Project → Content ownership chain and Phase 5's
 * scheduling rather than establishing a second one.
 *
 * Nothing here publishes. There is no platform API in this system: a target
 * records which account the post is INTENDED for, and scheduling records when
 * it is intended to go out. No external service is contacted at any point.
 *
 * Every id in the input is client-supplied and treated as such — checked for
 * shape, then resolved through the actor's own company, with soft-delete
 * state re-checked on both the record and its project.
 */

export type SaveSocialPostInput = {
  /** Present when updating a post that already exists; absent when creating. */
  contentId?: string;
  /**
   * The client this post is for. REQUIRED — a social post targets a client's
   * own social accounts, so the client is the thing it genuinely belongs to.
   */
  clientId: string;
  /**
   * Optional SEO project context. A social post never needed one; it was only
   * ever required because Content could not exist without it.
   */
  seoProjectId?: string;
  caption: string;
  link: string;
  /** Social account ids the post targets. Verified against the project's client. */
  accountIds: string[];
  /**
   * Phase 7 — each account's own caption and link, keyed by account id.
   *
   * Absent, or `null` for a field, means that account inherits the post's
   * shared value. Ids not in `accountIds`, or not this client's, are dropped
   * with the account itself — this map cannot smuggle in a target.
   */
  platformOverrides?: Record<string, { caption?: string | null; link?: string | null }>;
  /** Supplied only when the user explicitly chooses to schedule. */
  schedule?: { dateIso: string; time: string; timeZone: string };
};

/** The client, scoped to the actor's company. A social post always has one. */
async function getOwnedClient(clientId: string, companyId: string) {
  if (!isUuid(clientId)) return null;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, companyId: true, deletedAt: true },
  });
  if (!client || client.companyId !== companyId) return null;
  return client;
}

/** Optional project context, scoped to the actor's company. */
async function getOwnedProject(seoProjectId: string, companyId: string) {
  if (!isUuid(seoProjectId)) return null;
  const project = await prisma.sEOProject.findUnique({
    where: { id: seoProjectId },
    select: { id: true, companyId: true, clientId: true, deletedAt: true },
  });
  if (!project || project.companyId !== companyId) return null;
  return project;
}

/**
 * The accounts a post may target: live accounts belonging to THIS project's
 * client and this company.
 *
 * A manipulated account id from another client simply does not come back, so
 * it can never be written — the filter is the boundary, not a check the
 * caller could skip.
 */
async function resolveOwnedAccounts(
  accountIds: readonly string[],
  companyId: string,
  clientId: string | null
): Promise<{ id: string; platform: SocialPlatform; handle: string; displayName: string | null }[]> {
  const candidates = [...new Set(accountIds.filter(isUuid))];
  if (candidates.length === 0 || !clientId) return [];
  /*
   * Phase 9 — `status: "ACTIVE"` is the right filter, and connectionState is
   * deliberately NOT one. This resolves which accounts a DRAFT may be written
   * for, and writing and scheduling are internal: nothing in this phase sends
   * a post anywhere, so requiring a real connection to plan one would break a
   * workflow without protecting anything. The composer displays each
   * account's connection state instead of guessing at it.
   *
   * When real publishing lands, the publish path — not this one — is what must
   * require connectionState = CONNECTED.
   */
  return prisma.socialAccount.findMany({
    where: { id: { in: candidates }, companyId, clientId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, platform: true, handle: true, displayName: true },
  });
}

export async function saveSocialPostAction(input: SaveSocialPostInput): Promise<ActionResult<{ contentId: string; scheduled: boolean }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to create social posts.");
  }

  const client = await getOwnedClient(input.clientId, actor.companyId);
  if (!client) return actionError("Client not found.");
  if (client.deletedAt !== null) return actionError("This client is in the trash. Restore it before creating content for it.");

  /*
   * The project is optional. When one IS supplied it must belong to the same
   * company AND to this same client — a project from another client can never
   * be attached, whatever the browser sends.
   */
  let project: { id: string; clientId: string | null; deletedAt: Date | null } | null = null;
  if (input.seoProjectId) {
    const resolved = await getOwnedProject(input.seoProjectId, actor.companyId);
    if (!resolved) return actionError("SEO project not found.");
    if (resolved.deletedAt !== null) return actionError("This SEO project is in the trash. Restore it before creating content in it.");
    if (resolved.clientId !== client.id) return actionError("That SEO project belongs to a different client.");
    project = resolved;
  }

  // Existing post: it must be this company's, and a social post at that.
  let existing: { id: string; status: string; deletedAt: Date | null; socialPostId: string | null } | null = null;
  if (input.contentId !== undefined) {
    if (!isUuid(input.contentId)) return actionError("Content not found.");
    const row = await prisma.content.findUnique({
      where: { id: input.contentId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        companyId: true,
        clientId: true,
        seoProjectId: true,
        socialPost: { select: { id: true } },
      },
    });
    // Company is the boundary; the client must also match so a post cannot be
    // moved between clients by editing the id in the URL.
    if (!row || row.companyId !== actor.companyId || row.clientId !== client.id) return actionError("Content not found.");
    if (row.deletedAt !== null) return actionError("This content is in the trash. Restore it before editing.");
    if (row.socialPost === null) return actionError("This content is not a social post.");
    existing = { id: row.id, status: row.status, deletedAt: row.deletedAt, socialPostId: row.socialPost.id };
  }

  /*
   * Only the accounts that genuinely belong to this project's client survive.
   * Every per-platform value is then keyed off THAT list, so an override for
   * a foreign or unselected account is dropped along with the account itself
   * rather than being written under an id the client does not own.
   */
  const ownedAccounts = await resolveOwnedAccounts(input.accountIds, actor.companyId, client.id);
  const ownedAccountIds = ownedAccounts.map((account) => account.id);

  const targets: TargetDraft[] = ownedAccounts.map((account) => {
    const override = input.platformOverrides?.[account.id];
    return {
      accountId: account.id,
      platform: account.platform,
      label: account.displayName?.trim() || account.handle,
      caption: typeof override?.caption === "string" ? override.caption : null,
      link: typeof override?.link === "string" ? override.link : null,
    };
  });

  /*
   * The shared caption only has to satisfy the platforms STILL INHERITING it.
   * A platform given its own caption stops constraining everyone else, which
   * is the point of customizing it — and the composer shows exactly the same
   * limit, because both read this from the same pure function.
   */
  const validation = validateComposerDraft(
    { caption: input.caption, link: input.link, accountIds: ownedAccountIds },
    inheritingPlatforms(targets)
  );
  if (!validation.ok) return actionError(validation.error);

  // Each customized target is judged against its own platform, and nothing else.
  const targetValidation = validateTargets(targets);
  if (!targetValidation.ok) return actionError(targetValidation.error);

  /*
   * Every link goes through the SAME SSRF guard the publishing paths use —
   * the shared one and each platform's own. They are only ever stored, never
   * fetched, but a stored link is offered to users to click and a
   * private-network address has no business being one. A per-platform link is
   * no less user-supplied than the shared one, so it gets the same check.
   */
  const link = input.link.trim();
  const linksToCheck = [link, ...targets.map((target) => (target.link ?? "").trim())].filter((value) => value.length > 0);
  for (const candidate of [...new Set(linksToCheck)]) {
    try {
      await assertSafePublicUrl(candidate);
    } catch {
      return actionError(candidate === link ? "That link is not a valid public URL." : `The link "${candidate}" is not a valid public URL.`);
    }
  }

  // A schedule is applied ONLY when the user explicitly asked for one.
  let scheduledInstant: Date | null = null;
  if (input.schedule) {
    const scheduleValidation = validateScheduleRequest({
      request: input.schedule,
      status: existing?.status === "SCHEDULED" ? "SCHEDULED" : "DRAFT",
      contentDeletedAt: existing?.deletedAt ?? null,
      // No project means nothing project-level can block the schedule.
      projectDeletedAt: project?.deletedAt ?? null,
      now: new Date(),
    });
    if (!scheduleValidation.ok) return actionError(scheduleValidation.error);
    scheduledInstant = scheduleValidation.instant;
  }

  const caption = input.caption.trim();
  /*
   * The record's name is DERIVED, never supplied. Nobody writing a post
   * should have to name a database row, so the caption — which already says
   * what the post is — names it. Derived here rather than in the browser so
   * the stored name always matches the stored caption.
   */
  const title = deriveSocialPostTitle(caption, new Date());

  /*
   * One transaction for the Content row, its social half and its targets, so
   * a post can never exist without its caption or with a stale target set.
   */
  const result = await prisma.$transaction(async (tx) => {
    const contentData = scheduledInstant
      ? { status: "SCHEDULED" as const, scheduledAt: scheduledInstant, scheduledTimezone: input.schedule!.timeZone }
      : { status: "DRAFT" as const, scheduledAt: null, scheduledTimezone: null };

    const content = existing
      ? await tx.content.update({ where: { id: existing.id }, data: { title, ...contentData } })
      : await tx.content.create({
          data: {
            companyId: actor.companyId,
            clientId: client.id,
            seoProjectId: project?.id ?? null,
            // The composer makes exactly one kind of thing.
            contentType: "SOCIAL_POST",
            authorId: actor.id,
            title,
            // A social post has no page of its own and no article body. The
            // caption lives on the SocialPost row, where it means what it says.
            url: null,
            body: null,
            ...contentData,
          },
        });

    const socialPost = existing?.socialPostId
      ? await tx.socialPost.update({ where: { id: existing.socialPostId }, data: { caption, link: link || null } })
      : await tx.socialPost.create({ data: { contentId: content.id, caption, link: link || null } });

    // Targets are replaced wholesale, so an unselected account never lingers.
    await tx.socialPostTarget.deleteMany({ where: { socialPostId: socialPost.id, socialAccountId: { notIn: ownedAccountIds.length ? ownedAccountIds : ["00000000-0000-0000-0000-000000000000"] } } });
    for (const target of targets) {
      /*
       * null is written deliberately, not skipped: it is how "this account
       * follows the shared caption" is stored, so resetting a customized
       * platform back to the shared text actually clears the stored one
       * instead of leaving a stale version behind.
       */
      const values = {
        caption: target.caption === null ? null : target.caption.trim(),
        link: target.link === null ? null : target.link.trim() || null,
      };
      await tx.socialPostTarget.upsert({
        where: { socialPostId_socialAccountId: { socialPostId: socialPost.id, socialAccountId: target.accountId } },
        create: { socialPostId: socialPost.id, socialAccountId: target.accountId, ...values },
        update: values,
      });
    }

    return { contentId: content.id };
  });

  await logActivity({
    actorId: actor.id,
    action: existing ? "content.social_post_updated" : "content.social_post_created",
    companyId: actor.companyId,
    seoProjectId: project?.id ?? undefined,
    clientId: client.id,
    contentId: result.contentId,
    metadata: {
      title,
      targets: ownedAccountIds.length,
      customizedTargets: targets.filter((target) => target.caption !== null || target.link !== null).length,
      ...(scheduledInstant ? { scheduledAt: scheduledInstant.toISOString(), timezone: input.schedule!.timeZone } : {}),
    },
  });

  contentRevalidatePaths({ id: result.contentId, seoProjectId: project?.id ?? null }).forEach((path) => revalidatePath(path));

  return actionSuccess({ contentId: result.contentId, scheduled: scheduledInstant !== null });
}
