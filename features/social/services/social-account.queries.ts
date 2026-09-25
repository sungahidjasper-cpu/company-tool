import "server-only";

import type { SocialConnectionState } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Phase 6 — SERVER-ONLY reads of a client's social accounts.
 *
 * Kept apart from the pure composer rules so the client bundle never pulls in
 * Prisma, the same split the content workspace already uses.
 *
 * Every query is scoped by company AND client. A social account belongs to a
 * client, so a project with no client genuinely has no accounts — that is an
 * honest empty result, not a missing feature.
 */

/**
 * One account the composer may write for.
 *
 * The NAME is now the only misleading thing left about it, and it is kept for
 * continuity: "connected" here has always meant "available to select", which
 * Phase 9 renamed in the data as `status`. What genuinely changed is that
 * `connectionState` now travels alongside, so the composer can show the
 * difference between an account that is merely configured and one that is
 * really connected instead of assuming they are the same.
 */
export type ConnectedAccount = {
  id: string;
  platform: string;
  handle: string;
  /** The page/profile name, when the client settings recorded one. */
  displayName: string | null;
  /**
   * Whether Cloud Compass has actually connected to the platform for this
   * account. Composer copy reads this; nothing in the composer treats a
   * NOT_CONNECTED account as connected.
   */
  connectionState: SocialConnectionState;
};

/**
 * The accounts a post for this project may target.
 *
 * Availability is the user's own switch: soft-deleted and disabled accounts
 * are excluded, because an account someone turned off must not appear
 * selectable. Returns [] when the project has no client.
 *
 * WHY connectionState IS NOT A FILTER HERE. Scheduling in Cloud Compass is
 * internal — Phase 9 adds no publishing, and a scheduled post is not sent
 * anywhere. Hiding NOT_CONNECTED accounts would therefore break the writing
 * and planning workflow that already works, for no safety gain. Instead the
 * state comes back with each account and the composer states it plainly, so
 * nobody can mistake a configured account for a connected one. The moment
 * real publishing exists, THAT is what must require CONNECTED — and it will
 * read this same field.
 */
export async function listConnectedAccounts(companyId: string, clientId: string | null): Promise<ConnectedAccount[]> {
  if (!clientId) return [];
  const rows = await prisma.socialAccount.findMany({
    where: { companyId, clientId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, platform: true, handle: true, displayName: true, connectionState: true },
    orderBy: [{ platform: "asc" }, { handle: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    platform: String(row.platform),
    handle: row.handle,
    displayName: row.displayName,
    connectionState: row.connectionState,
  }));
}

/** The saved social post for a Content record, with its targets. Null when the record is not a social post. */
export async function getSocialPostForContent(contentId: string, companyId: string) {
  const post = await prisma.socialPost.findUnique({
    where: { contentId },
    select: {
      id: true,
      caption: true,
      link: true,
      firstComment: true,
      content: {
        select: {
          id: true,
          title: true,
          status: true,
          scheduledAt: true,
          scheduledTimezone: true,
          companyId: true,
          clientId: true,
          client: { select: { id: true, name: true } },
          seoProjectId: true,
          seoProject: { select: { id: true, name: true, companyId: true, clientId: true, client: { select: { id: true, name: true } } } },
        },
      },
      /*
       * caption/link are this target's OWN version, and null means it
       * inherits the post's shared one. Reading them back is what lets the
       * composer reopen a post with each platform's tab exactly as it was
       * left — customized ones customized, inheriting ones still following.
       */
      targets: {
        select: {
          id: true,
          socialAccountId: true,
          caption: true,
          link: true,
          firstComment: true,
          /*
           * Phase 10A — the real outcome of the one real publish attempt this
           * target may have had, if any. Read straight through, never derived:
           * "PUBLISHED" here means a provider already confirmed it.
           */
          publication: { select: { status: true, externalPostId: true, externalUrl: true, failureMessage: true } },
          /* First Comment — this target's own comment-publishing result, if a publish was ever attempted. */
          comment: { select: { status: true, externalCommentId: true, failureMessage: true } },
        },
      },
    },
  });
  if (!post || post.content.companyId !== companyId) return null;
  return post;
}
