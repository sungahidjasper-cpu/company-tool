"use server";

import { revalidatePath } from "next/cache";

import {
  addSocialAccountSchema,
  setSocialAccountStatusSchema,
  updateSocialAccountSchema,
  type AddSocialAccountInput,
  type SetSocialAccountStatusInput,
  type SocialAccountSummary,
  type UpdateSocialAccountInput,
} from "@/features/social/schemas/social-account.schema";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Phase 7 — managing a client's social accounts, from Settings.
 * Phase 9 — still without ever touching a credential.
 *
 * These live in SETTINGS, not the composer. Configuring who a client is on a
 * platform is administration; writing a post is not, and mixing the two is
 * how a composer ends up quietly creating half-configured accounts.
 *
 * NO CREDENTIAL IS STORED, ACCEPTED OR RETURNED BY THIS FILE. Phase 9 added
 * real connections, and they are deliberately somewhere else: connecting is
 * social-connection.actions.ts, credentials are SocialAccountCredential. What
 * remains here is identity and the user's own enable/disable switch.
 *
 * ADDING AN ACCOUNT NO LONGER IMPLIES A CONNECTION. It sets status = ACTIVE,
 * which now means only "the client wants this available in Cloud Compass";
 * connectionState stays at its NOT_CONNECTED default, because typing a handle
 * has not connected anything. Separating those two was the point of Phase 9.
 *
 * TENANCY — the rule every action here obeys: an account is reachable only
 * through the ACTOR'S OWN company, and only for a client of that company.
 * Both the client id and the account id arrive from the browser, so neither
 * is trusted: each is shape-checked, then re-read through `companyId` from
 * the session. A Company A account id, or a client from another company,
 * simply does not come back, so it can never be read or written.
 */

const SETTINGS_PATH = "/settings/clients";

/**
 * The one place the response shape is decided — there is no field here to
 * leak. Note what is selected FROM the credential relation: a count, and
 * nothing else. Not the payload, not the key version, not the scopes.
 */
const ACCOUNT_SELECT = {
  id: true,
  clientId: true,
  platform: true,
  handle: true,
  displayName: true,
  status: true,
  externalId: true,
  connectionState: true,
  connectedAt: true,
  lastCheckedAt: true,
  lastCheckError: true,
  _count: { select: { targets: true } },
  credential: { select: { id: true } },
} as const;

type AccountRow = {
  id: string;
  clientId: string;
  platform: SocialAccountSummary["platform"];
  handle: string;
  displayName: string | null;
  status: SocialAccountSummary["status"];
  externalId: string | null;
  connectionState: SocialAccountSummary["connectionState"];
  connectedAt: Date | null;
  lastCheckedAt: Date | null;
  lastCheckError: string | null;
  _count: { targets: number };
  credential: { id: string } | null;
};

function toSummary(row: AccountRow): SocialAccountSummary {
  return {
    id: row.id,
    clientId: row.clientId,
    platform: row.platform,
    handle: row.handle,
    displayName: row.displayName,
    status: row.status,
    connectionState: row.connectionState,
    externalId: row.externalId,
    connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    lastCheckError: row.lastCheckError,
    /* A boolean derived from the relation's presence. The credential itself is never read. */
    hasStoredCredential: row.credential !== null,
    targetCount: row._count.targets,
  };
}

/** The client, resolved through the actor's company. Null means "not yours" and "does not exist" alike. */
async function getOwnedClient(clientId: string, companyId: string) {
  if (!isUuid(clientId)) return null;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, companyId: true, name: true, deletedAt: true },
  });
  if (!client || client.companyId !== companyId) return null;
  return client;
}

/** The account, resolved through the actor's company. Same rule, one level down. */
async function getOwnedAccount(accountId: string, companyId: string) {
  if (!isUuid(accountId)) return null;
  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    select: { id: true, companyId: true, clientId: true, platform: true, handle: true, deletedAt: true },
  });
  if (!account || account.companyId !== companyId || account.deletedAt !== null) return null;
  return account;
}

/**
 * Every account configured for one client, including DISCONNECTED ones —
 * settings is where you see and change that state, so hiding it here would
 * make a disabled account look deleted.
 */
export async function listClientSocialAccountsAction(clientId: string): Promise<ActionResult<SocialAccountSummary[]>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) return actionError("You do not have permission to manage client social accounts.");

  const client = await getOwnedClient(clientId, actor.companyId);
  if (!client) return actionError("Client not found.");

  const rows = await prisma.socialAccount.findMany({
    where: { companyId: actor.companyId, clientId: client.id, deletedAt: null },
    select: ACCOUNT_SELECT,
    orderBy: [{ platform: "asc" }, { handle: "asc" }],
  });
  return actionSuccess(rows.map(toSummary));
}

export async function addSocialAccountAction(input: AddSocialAccountInput): Promise<ActionResult<SocialAccountSummary>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) return actionError("You do not have permission to manage client social accounts.");

  const parsed = addSocialAccountSchema.safeParse(input);
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { clientId, platform, handle, displayName } = parsed.data;

  const client = await getOwnedClient(clientId, actor.companyId);
  if (!client) return actionError("Client not found.");
  if (client.deletedAt !== null) return actionError("This client is in the trash. Restore it before configuring social accounts.");

  /*
   * The database's own [clientId, platform, handle] unique constraint is the
   * real guard; this read exists to explain the collision in words, including
   * the case where the row is soft-deleted and therefore invisible above.
   */
  const clash = await prisma.socialAccount.findFirst({
    where: { clientId: client.id, platform, handle },
    select: { id: true, deletedAt: true },
  });
  if (clash && clash.deletedAt === null) return actionError("That handle is already configured for this client on this platform.");

  /*
   * Re-adding something previously removed restores that row rather than
   * creating a second one, so its history — the posts that targeted it —
   * stays attached instead of colliding with the unique constraint.
   */
  const created = clash
    ? await prisma.socialAccount.update({
        where: { id: clash.id },
        /*
         * connectionState is deliberately NOT touched here. Re-adding a
         * removed account restores the identity row; it does not restore an
         * authorization, and a removed account's credential is long gone. If
         * it was connected once, the honest state is whatever the disconnect
         * left behind — never CONNECTED because a handle was typed again.
         */
        data: { deletedAt: null, status: "ACTIVE", displayName: displayName || null },
        select: ACCOUNT_SELECT,
      })
    : await prisma.socialAccount.create({
        data: { companyId: actor.companyId, clientId: client.id, platform, handle, displayName: displayName || null, status: "ACTIVE" },
        select: ACCOUNT_SELECT,
      });

  await logActivity({
    actorId: actor.id,
    action: "client.social_account_added",
    companyId: actor.companyId,
    clientId: client.id,
    metadata: { platform, handle },
  });

  revalidatePath(`${SETTINGS_PATH}/${client.id}/social-accounts`);
  return actionSuccess(toSummary(created));
}

export async function updateSocialAccountAction(input: UpdateSocialAccountInput): Promise<ActionResult<SocialAccountSummary>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) return actionError("You do not have permission to manage client social accounts.");

  const parsed = updateSocialAccountSchema.safeParse(input);
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { accountId, handle, displayName } = parsed.data;

  const account = await getOwnedAccount(accountId, actor.companyId);
  if (!account) return actionError("Social account not found.");

  /*
   * The platform is deliberately not editable: a Facebook page that becomes
   * an Instagram profile is a different account, and changing it in place
   * would silently repoint every post that already targets it.
   */
  const clash = await prisma.socialAccount.findFirst({
    where: { clientId: account.clientId, platform: account.platform, handle, deletedAt: null, NOT: { id: account.id } },
    select: { id: true },
  });
  if (clash) return actionError("That handle is already configured for this client on this platform.");

  const updated = await prisma.socialAccount.update({
    where: { id: account.id },
    data: { handle, displayName: displayName || null },
    select: ACCOUNT_SELECT,
  });

  await logActivity({
    actorId: actor.id,
    action: "client.social_account_updated",
    companyId: actor.companyId,
    clientId: account.clientId,
    metadata: { platform: account.platform, handle },
  });

  revalidatePath(`${SETTINGS_PATH}/${account.clientId}/social-accounts`);
  return actionSuccess(toSummary(updated));
}

/**
 * Enable or disable an account.
 *
 * Disabling removes it from the composer's choices for NEW posts and leaves
 * every existing post exactly as it is — no content is deleted, no schedule
 * is cancelled. Someone turning an account off is saying "stop using this",
 * not "erase what we already planned".
 */
export async function setSocialAccountStatusAction(input: SetSocialAccountStatusInput): Promise<ActionResult<SocialAccountSummary>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) return actionError("You do not have permission to manage client social accounts.");

  const parsed = setSocialAccountStatusSchema.safeParse(input);
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { accountId, status } = parsed.data;

  const account = await getOwnedAccount(accountId, actor.companyId);
  if (!account) return actionError("Social account not found.");

  const updated = await prisma.socialAccount.update({ where: { id: account.id }, data: { status }, select: ACCOUNT_SELECT });

  await logActivity({
    actorId: actor.id,
    action: status === "ACTIVE" ? "client.social_account_enabled" : "client.social_account_disabled",
    companyId: actor.companyId,
    clientId: account.clientId,
    metadata: { platform: account.platform, handle: account.handle },
  });

  revalidatePath(`${SETTINGS_PATH}/${account.clientId}/social-accounts`);
  return actionSuccess(toSummary(updated));
}

/**
 * Remove an account.
 *
 * Soft-delete, like every other record in this system, so history stays
 * readable. An account still targeted by a saved post is not removed at all —
 * that is a case for disabling it, and saying so is more useful than either
 * breaking the link or silently doing nothing.
 */
export async function removeSocialAccountAction(accountId: string): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) return actionError("You do not have permission to manage client social accounts.");

  const account = await getOwnedAccount(accountId, actor.companyId);
  if (!account) return actionError("Social account not found.");

  const targetCount = await prisma.socialPostTarget.count({ where: { socialAccountId: account.id } });
  if (targetCount > 0) {
    return actionError(
      `${targetCount} saved post${targetCount === 1 ? "" : "s"} already target${targetCount === 1 ? "s" : ""} this account. Disable it instead — that stops it being used for new posts without changing what is already planned.`
    );
  }

  /*
   * Removing an account destroys its authorization too. A soft-deleted row
   * that still owns a decryptable token would be a credential nothing on
   * screen can see or revoke, which is worse than either outcome on purpose.
   */
  await prisma.socialAccountCredential.deleteMany({ where: { socialAccountId: account.id, companyId: actor.companyId } });

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      deletedAt: new Date(),
      status: "DISCONNECTED",
      connectionState: "DISCONNECTED",
      disconnectedAt: new Date(),
      connectedAt: null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "client.social_account_removed",
    companyId: actor.companyId,
    clientId: account.clientId,
    metadata: { platform: account.platform, handle: account.handle },
  });

  revalidatePath(`${SETTINGS_PATH}/${account.clientId}/social-accounts`);
  return actionSuccess({ id: account.id });
}
