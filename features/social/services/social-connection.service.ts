import "server-only";

import {
  claimPendingAuthorization,
  clearPendingAuthorization,
  selectionHashOf,
} from "@/features/social/services/social-oauth-state.service";
import {
  deleteSocialCredential,
  readAccessToken,
  storeSocialCredential,
} from "@/features/social/services/social-credential.service";
import { socialProviderFor } from "@/features/social/services/social-provider-registry";
import type { DiscoveredAccount } from "@/features/social/services/social-provider";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Phase 9 — the connection lifecycle, provider-neutral.
 *
 * Every transition a connection can make lives here, so the rule that matters
 * is enforced in one readable place:
 *
 *   connectionState becomes CONNECTED only after a provider has actually
 *   answered. There is no other assignment of CONNECTED in this codebase.
 *
 * OWNERSHIP. Every function takes a companyId that came from the session, and
 * re-reads the account through it. An account id from a browser is a claim,
 * not a fact; a Company A id simply does not come back, so it can be neither
 * read nor written. The client is checked too, because a social account
 * belongs to a client and connecting Client A's page under Client B would be
 * a cross-client leak even inside one company.
 *
 * WHAT IS NOT HERE. Publishing. Nothing in this file posts anything to any
 * platform, and no provider method it calls does either.
 */

export type ConnectionOutcome<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Finishes a connection: the person has chosen one of the pages the PROVIDER
 * offered, and this attaches it.
 *
 * The order matters and is the whole point:
 *   1. redeem the single-use selection token — nothing proceeds without it
 *   2. re-ask the provider whether this authorization really manages that page
 *   3. only then write identity, encrypt the credential, and set CONNECTED
 *
 * Step 2 is what makes an external id impossible to type: a page id that the
 * provider does not confirm is refused, so the only way a row gets an
 * externalId is a provider having named it.
 */
export async function completeConnectionFromSelection(input: {
  selectionToken: string;
  externalId: string;
  /** From the session. Must match the flow's own company or nothing happens. */
  actorCompanyId: string;
  actorId: string;
}): Promise<ConnectionOutcome<{ socialAccountId: string; clientId: string; displayName: string }>> {
  const claim = await claimPendingAuthorization(input.selectionToken);
  if (!claim.ok) {
    logger.warn("Social connection selection refused", { reason: claim.reason });
    return { ok: false, message: "This connection attempt is no longer valid. Start again from the client's social accounts." };
  }

  const { context, pending } = claim;
  const selectionHash = selectionHashOf(input.selectionToken);

  /*
   * The flow's company came from the row; the actor's came from the session.
   * They must be the same person's company. A mismatch means a selection
   * token is being redeemed by someone it was not issued to — refused, and
   * the parked authorization is destroyed rather than left for a retry.
   */
  if (context.companyId !== input.actorCompanyId) {
    await clearPendingAuthorization(selectionHash);
    logger.warn("Social connection selection rejected: company mismatch");
    return { ok: false, message: "This connection attempt is no longer valid. Start again from the client's social accounts." };
  }

  const provider = socialProviderFor(context.platform);
  if (!provider) {
    await clearPendingAuthorization(selectionHash);
    return { ok: false, message: "That platform cannot be connected yet." };
  }

  const resolved = await provider.resolveAccountCredential({
    accessToken: pending.authorization.accessToken,
    externalId: input.externalId,
  });
  if (!resolved.ok) {
    await clearPendingAuthorization(selectionHash);
    return { ok: false, message: resolved.failure.message };
  }

  const chosen = pending.discovered.find((account) => account.externalId === input.externalId);
  /*
   * The provider confirmed the page above, so this is only about the NAME to
   * show. Falling back to the external id is honest when the list no longer
   * has it; making up a name would not be.
   */
  const displayName = chosen?.name ?? input.externalId;
  const handle = chosen?.handle ?? deriveHandleFallback(chosen?.name ?? input.externalId);

  const client = await prisma.client.findUnique({
    where: { id: context.clientId },
    select: { id: true, companyId: true },
  });
  if (!client || client.companyId !== input.actorCompanyId) {
    await clearPendingAuthorization(selectionHash);
    return { ok: false, message: "Client not found." };
  }

  let socialAccountId: string;
  try {
    socialAccountId = await prisma.$transaction(async (tx) => {
      /*
       * Reattach rather than duplicate, in priority order:
       *   1. the account this flow was started to reconnect
       *   2. an account already carrying this provider's id for this company
       *   3. an account this client configured by hand for this platform,
       *      which is exactly how "Catawba Yaupon, added by hand" becomes the
       *      same row once it is really connected — no second entry, no lost
       *      history, and the posts already targeting it stay attached
       */
      const existing =
        (context.socialAccountId
          ? await tx.socialAccount.findFirst({
              where: { id: context.socialAccountId, companyId: input.actorCompanyId, clientId: client.id },
              select: { id: true, clientId: true },
            })
          : null) ??
        (await tx.socialAccount.findFirst({
          where: { companyId: input.actorCompanyId, platform: context.platform, externalId: input.externalId },
          select: { id: true, clientId: true },
        })) ??
        (await tx.socialAccount.findFirst({
          where: {
            companyId: input.actorCompanyId,
            clientId: client.id,
            platform: context.platform,
            externalId: null,
            deletedAt: null,
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, clientId: true },
        }));

      /*
       * REVIEW FINDING (Phase 9B pre-commit review). @@unique([companyId,
       * platform, externalId]) is scoped to the COMPANY, not the client, so
       * the priority-2 lookup above can match a row belonging to a DIFFERENT
       * client than the one this flow is for. Priorities 1 and 3 already
       * filter on clientId: client.id in their own where clauses, so this can
       * only ever fire from priority 2 — reattaching there without this check
       * would silently refresh another client's credential while reporting
       * success for THIS client. Thrown, not returned, so it is caught by the
       * same catch block below that already anticipates a unique-constraint
       * collision on create — same message, now reached deterministically
       * instead of only on a race.
       */
      if (existing && existing.clientId !== client.id) {
        throw new Error("Selected Page already belongs to a different client in this company.");
      }

      const connectedRow = existing
        ? await tx.socialAccount.update({
            where: { id: existing.id },
            data: {
              externalId: input.externalId,
              displayName,
              connectionState: "CONNECTED",
              connectedAt: new Date(),
              lastCheckedAt: new Date(),
              lastCheckError: null,
              disconnectedAt: null,
              /*
               * Reconnecting re-enables the user's switch: someone completing
               * an authorization is plainly saying they want to use this. It
               * is also un-done with one click, unlike the authorization.
               */
              status: "ACTIVE",
              deletedAt: null,
            },
            select: { id: true },
          })
        : await tx.socialAccount.create({
            data: {
              companyId: input.actorCompanyId,
              clientId: client.id,
              platform: context.platform,
              externalId: input.externalId,
              displayName,
              handle,
              status: "ACTIVE",
              connectionState: "CONNECTED",
              connectedAt: new Date(),
              lastCheckedAt: new Date(),
            },
            select: { id: true },
          });

      return connectedRow.id;
    });
  } catch (error) {
    await clearPendingAuthorization(selectionHash);
    logger.error("Social connection could not be saved", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, message: "That account could not be connected. It may already be connected to another client." };
  }

  /*
   * The credential is written after the account exists and OUTSIDE the
   * transaction above deliberately: if this fails, the account is left
   * CONNECTED-but-credential-less, which the next check turns into
   * NEEDS_RECONNECT — a state a person can fix. The alternative, encrypting
   * inside the transaction, risks a stored token with no row to own it.
   */
  try {
    await storeSocialCredential({
      socialAccountId,
      companyId: input.actorCompanyId,
      accessToken: resolved.authorization.accessToken,
      expiresAt: resolved.authorization.expiresAt,
      grantedScopes: resolved.authorization.grantedScopes,
    });
  } catch (error) {
    await prisma.socialAccount.update({
      where: { id: socialAccountId },
      data: {
        connectionState: "NEEDS_RECONNECT",
        lastCheckedAt: new Date(),
        lastCheckError: "The authorization could not be stored securely.",
      },
    });
    await clearPendingAuthorization(selectionHash);
    logger.error("Social credential could not be stored", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, message: "That account could not be connected securely. Try connecting again." };
  }

  await clearPendingAuthorization(selectionHash);

  return { ok: true, data: { socialAccountId, clientId: client.id, displayName } };
}

/**
 * Disconnects an account.
 *
 * Destroys the authorization and KEEPS the identity. Those are different
 * things: the credential row is deleted so nothing decryptable remains, while
 * the SocialAccount — the client's own record of who they are on the platform,
 * and the thing existing posts point at — stays exactly where it was. Deleting
 * it would silently break saved posts, which is not what "disconnect" means.
 *
 * The user's own `status` switch is untouched as well. Someone disconnecting
 * has said nothing about whether they still want the account listed.
 */
export async function disconnectAccount(input: {
  socialAccountId: string;
  actorCompanyId: string;
}): Promise<ConnectionOutcome<{ socialAccountId: string; clientId: string }>> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: input.socialAccountId },
    select: { id: true, companyId: true, clientId: true, deletedAt: true },
  });
  if (!account || account.companyId !== input.actorCompanyId || account.deletedAt !== null) {
    return { ok: false, message: "Social account not found." };
  }

  await deleteSocialCredential(account.id, input.actorCompanyId);

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      connectionState: "DISCONNECTED",
      disconnectedAt: new Date(),
      connectedAt: null,
      lastCheckError: null,
      /*
       * externalId is KEPT. It is public identity, it is what lets a
       * reconnect land on this same row instead of creating a duplicate, and
       * clearing it would throw away the one true fact the provider gave us.
       */
    },
  });

  return { ok: true, data: { socialAccountId: account.id, clientId: account.clientId } };
}

/**
 * Asks the provider whether a stored authorization still works, and records
 * the answer.
 *
 * This is the only thing that can move an account from CONNECTED to
 * NEEDS_RECONNECT, and it does so on a real provider response or a real
 * expiry — never on a hardcoded lifetime. A provider that answers happily
 * leaves the account CONNECTED with a fresh lastCheckedAt.
 */
export async function checkAccountConnection(input: {
  socialAccountId: string;
  actorCompanyId: string;
}): Promise<ConnectionOutcome<{ connectionState: "CONNECTED" | "NEEDS_RECONNECT" }>> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: input.socialAccountId },
    select: { id: true, companyId: true, platform: true, externalId: true, connectionState: true },
  });
  if (!account || account.companyId !== input.actorCompanyId) {
    return { ok: false, message: "Social account not found." };
  }
  if (account.connectionState !== "CONNECTED" && account.connectionState !== "NEEDS_RECONNECT") {
    return { ok: false, message: "This account is not connected, so there is nothing to check." };
  }

  const provider = socialProviderFor(account.platform);
  if (!provider) return { ok: false, message: "That platform cannot be connected yet." };

  const credential = await prisma.socialAccountCredential.findUnique({
    where: { socialAccountId: account.id },
    select: { expiresAt: true },
  });
  if (!credential) {
    return finishCheck(account.id, "NEEDS_RECONNECT", "No stored authorization was found.");
  }
  if (credential.expiresAt && credential.expiresAt <= new Date()) {
    return finishCheck(account.id, "NEEDS_RECONNECT", "The platform's authorization has expired.");
  }

  const accessToken = await readAccessToken(account.id, input.actorCompanyId);
  if (!accessToken) {
    return finishCheck(account.id, "NEEDS_RECONNECT", "The stored authorization could not be read.");
  }

  const listed = await provider.listManageableAccounts({ accessToken });
  if (!listed.ok) {
    return finishCheck(account.id, "NEEDS_RECONNECT", listed.failure.message);
  }
  if (account.externalId && !listed.accounts.some((row) => row.externalId === account.externalId)) {
    return finishCheck(account.id, "NEEDS_RECONNECT", "This account no longer has access to that page.");
  }

  return finishCheck(account.id, "CONNECTED", null);
}

/**
 * Writes a check's outcome. `lastCheckError` only ever receives one of the
 * short, human sentences above — never a decrypted value, never a raw
 * provider body.
 */
async function finishCheck(
  socialAccountId: string,
  connectionState: "CONNECTED" | "NEEDS_RECONNECT",
  lastCheckError: string | null
): Promise<ConnectionOutcome<{ connectionState: "CONNECTED" | "NEEDS_RECONNECT" }>> {
  await prisma.socialAccount.update({
    where: { id: socialAccountId },
    data: { connectionState, lastCheckedAt: new Date(), lastCheckError },
  });
  return { ok: true, data: { connectionState } };
}

/**
 * A handle for a brand-new account the provider named but gave no handle for.
 *
 * Marked as derived, not passed off as the platform's own: Meta's Pages
 * response carries no guaranteed username, and this column is display text
 * (the schema says so). A person can correct it in settings; the externalId
 * beside it remains the real identity.
 */
function deriveHandleFallback(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length >= 2 ? slug.slice(0, 80) : "page";
}

/** Public read of what a provider offered, for the page-selection screen. */
export type { DiscoveredAccount };
