"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  disconnectSocialAccountSchema,
  selectDiscoveredAccountSchema,
  startSocialConnectionSchema,
  type DisconnectSocialAccountInput,
  type PlatformConnectivity,
  type SelectDiscoveredAccountInput,
  type StartSocialConnectionInput,
} from "@/features/social/schemas/social-connection.schema";
import { SOCIAL_CONNECT_SELECTION_COOKIE } from "@/features/social/services/social-connect-cookie";
import {
  checkAccountConnection,
  completeConnectionFromSelection,
  disconnectAccount,
} from "@/features/social/services/social-connection.service";
import { createOAuthState, discardUnfinishedFlows } from "@/features/social/services/social-oauth-state.service";
import { resolveRedirectUri } from "@/features/social/services/social-oauth-redirect";
import { socialProviderFor } from "@/features/social/services/social-provider-registry";
import { ALL_PLATFORMS, platformDefinition } from "@/features/social/services/social-platforms";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

/**
 * Phase 9 — connect, reconnect and disconnect, from the browser's side.
 *
 * WHAT A BROWSER CAN AND CANNOT ASK FOR
 * -------------------------------------
 * It can ask to start a flow for one of its own clients, to finish one it
 * started, and to disconnect one of its own accounts. It cannot supply a
 * company (that comes from the session), a token (there is no parameter for
 * one), or a platform account id that has not been confirmed by the provider
 * during the flow it is finishing.
 *
 * NOTHING HERE RETURNS A CREDENTIAL. There is no return type in this file
 * with a token field, and the one value that is returned to a browser — an
 * authorization URL — is a public URL containing an app id, a redirect URI
 * and a random state. Never a secret.
 *
 * SETTINGS, NOT THE COMPOSER. Connecting is administration, same as Phase 7
 * decided for account configuration, and it needs the same permission.
 */

const SETTINGS_PATH = "/settings/clients";

/** The client, through the actor's company. Null means "not yours" and "does not exist" alike. */
async function getOwnedClient(clientId: string, companyId: string) {
  if (!isUuid(clientId)) return null;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, companyId: true, name: true, deletedAt: true },
  });
  if (!client || client.companyId !== companyId) return null;
  return client;
}

/**
 * Whether each platform can be connected here, and whether this deployment is
 * configured for it.
 *
 * `missingKeys` — the names of unset environment variables, never values — is
 * returned ONLY to someone who may manage client configuration. A normal user
 * gets the plain sentence and nothing about this server's setup.
 */
export async function listPlatformConnectivityAction(): Promise<ActionResult<PlatformConnectivity[]>> {
  const actor = await requireUser();
  const maySeeDiagnostics = Permissions.manageClients(actor.role);

  const rows: PlatformConnectivity[] = ALL_PLATFORMS.map((platform) => {
    const provider = socialProviderFor(platform);
    if (!provider) {
      return {
        platform,
        connectable: false,
        configured: false,
        summary: `Connecting ${platformDefinition(platform).name} is not available yet.`,
        missingKeys: [],
      };
    }

    const configuration = provider.describeConfiguration();
    if (configuration.configured) {
      const redirect = resolveRedirectUri(platform);
      if (!redirect.ok) {
        return {
          platform,
          connectable: true,
          configured: false,
          summary: `${platformDefinition(platform).name} connection is not configured yet.`,
          missingKeys: maySeeDiagnostics ? redirect.missingKeys : [],
        };
      }
      return { platform, connectable: true, configured: true, summary: null, missingKeys: [] };
    }

    return {
      platform,
      connectable: true,
      configured: false,
      summary: configuration.summary,
      missingKeys: maySeeDiagnostics ? configuration.missingKeys : [],
    };
  });

  return actionSuccess(rows);
}

/**
 * Starts an authorization and returns where to send the person.
 *
 * Returns a URL rather than redirecting so the caller can show a real error
 * instead of a browser landing on a provider's error page. Nothing is
 * persisted about the account here — a started flow that is abandoned leaves
 * one expiring state row and no account, which is the honest outcome.
 */
export async function startSocialConnectionAction(
  input: StartSocialConnectionInput
): Promise<ActionResult<{ authorizationUrl: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to connect client social accounts.");
  }

  const parsed = startSocialConnectionSchema.safeParse(input);
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { clientId, platform, accountId } = parsed.data;

  const client = await getOwnedClient(clientId, actor.companyId);
  if (!client) return actionError("Client not found.");
  if (client.deletedAt !== null) {
    return actionError("This client is in the trash. Restore it before connecting social accounts.");
  }

  const provider = socialProviderFor(platform);
  if (!provider) return actionError(`Connecting ${platformDefinition(platform).name} is not available yet.`);

  const configuration = provider.describeConfiguration();
  if (!configuration.configured) return actionError(configuration.summary);

  const redirect = resolveRedirectUri(platform);
  if (!redirect.ok) return actionError(`${platformDefinition(platform).name} connection is not configured yet.`);

  /*
   * An account id is optional and, when given, must be one of THIS client's
   * accounts on THIS platform. Re-read through the company, so a browser
   * cannot aim a reconnect at another company's row: an id that does not
   * resolve is dropped rather than trusted, and the flow proceeds as a fresh
   * connect.
   */
  let reconnectAccountId: string | null = null;
  if (accountId) {
    if (!isUuid(accountId)) return actionError("Social account not found.");
    const owned = await prisma.socialAccount.findFirst({
      where: { id: accountId, companyId: actor.companyId, clientId: client.id, platform, deletedAt: null },
      select: { id: true },
    });
    if (!owned) return actionError("Social account not found.");
    reconnectAccountId = owned.id;
  }

  /*
   * Phase 9B — start clean. Any earlier unfinished flow for this client and
   * platform is discarded first: never-consumed states are deleted so a
   * second press of Connect cannot leave two usable nonces alive, and an
   * abandoned page-picker keeps its audit row but loses its parked
   * authorization and its selection token.
   *
   * This is what makes Reconnect safe. It always authorizes afresh and can
   * never resume something older.
   */
  const discarded = await discardUnfinishedFlows({
    companyId: actor.companyId,
    clientId: client.id,
    platform,
  });
  if (discarded > 0) {
    logger.info("Discarded unfinished social connection attempts before starting a new one", {
      platform,
      discarded,
    });
  }

  const state = await createOAuthState({
    companyId: actor.companyId,
    clientId: client.id,
    platform,
    socialAccountId: reconnectAccountId,
    startedByUserId: actor.id,
  });

  const authorizationUrl = provider.buildAuthorizationUrl({ state, redirectUri: redirect.redirectUri });

  await logActivity({
    actorId: actor.id,
    action: reconnectAccountId !== null ? "client.social_reconnection_started" : "client.social_connection_started",
    companyId: actor.companyId,
    clientId: client.id,
    /* The platform and whether this is a reconnect. No token, no state value. */
    metadata: { platform, reconnect: reconnectAccountId !== null },
  });

  return actionSuccess({ authorizationUrl });
}

/**
 * Finishes a connection with the page the person chose.
 *
 * WHICH FLOW IS BEING FINISHED IS NOT UP TO THE BROWSER. The selection token
 * is read from the httpOnly cookie the callback set — script cannot read it,
 * so it cannot be swapped for someone else's — and the flow's company and
 * client come from the server-side row that token points at. The only thing
 * this accepts from the caller is which page was picked, and that is checked
 * against the provider again before anything is written.
 */
export async function selectDiscoveredAccountAction(
  input: SelectDiscoveredAccountInput
): Promise<ActionResult<{ clientId: string; displayName: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to connect client social accounts.");
  }

  const parsed = selectDiscoveredAccountSchema.safeParse(input);
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const cookieStore = await cookies();
  const selectionToken = cookieStore.get(SOCIAL_CONNECT_SELECTION_COOKIE)?.value;
  if (!selectionToken) {
    return actionError("This connection attempt is no longer valid. Start again from the client's social accounts.");
  }

  const outcome = await completeConnectionFromSelection({
    selectionToken,
    externalId: parsed.data.externalId,
    actorCompanyId: actor.companyId,
    actorId: actor.id,
  });

  /*
   * The cookie is cleared either way. On success it has been redeemed; on
   * failure it is either invalid already or points at a flow whose parked
   * authorization was just destroyed. Leaving it behind only invites a
   * confusing retry.
   */
  cookieStore.delete(SOCIAL_CONNECT_SELECTION_COOKIE);

  if (!outcome.ok) return actionError(outcome.message);

  await logActivity({
    actorId: actor.id,
    action: "client.social_account_connected",
    companyId: actor.companyId,
    clientId: outcome.data.clientId,
    /* The page's name and public id — never the credential. */
    metadata: { externalId: parsed.data.externalId, displayName: outcome.data.displayName },
  });

  revalidatePath(`${SETTINGS_PATH}/${outcome.data.clientId}/social-accounts`);
  return actionSuccess({ clientId: outcome.data.clientId, displayName: outcome.data.displayName });
}

/** Disconnects an account: destroys the authorization, keeps the account. */
export async function disconnectSocialAccountAction(
  input: DisconnectSocialAccountInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to connect client social accounts.");
  }

  const parsed = disconnectSocialAccountSchema.safeParse(input);
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  if (!isUuid(parsed.data.accountId)) return actionError("Social account not found.");

  const outcome = await disconnectAccount({
    socialAccountId: parsed.data.accountId,
    actorCompanyId: actor.companyId,
  });
  if (!outcome.ok) return actionError(outcome.message);

  await logActivity({
    actorId: actor.id,
    action: "client.social_account_disconnected",
    companyId: actor.companyId,
    clientId: outcome.data.clientId,
    metadata: {},
  });

  revalidatePath(`${SETTINGS_PATH}/${outcome.data.clientId}/social-accounts`);
  return actionSuccess({ id: outcome.data.socialAccountId });
}

/**
 * Re-checks a stored authorization against the provider.
 *
 * Offered because a connection can stop working with nothing happening in
 * Cloud Compass at all, and a screen that only ever says "Connected" would go
 * on saying it. The result is a fact from the provider, not a local guess.
 */
export async function checkSocialConnectionAction(
  accountId: string
): Promise<ActionResult<{ connectionState: "CONNECTED" | "NEEDS_RECONNECT" }>> {
  const actor = await requireUser();
  if (!Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to connect client social accounts.");
  }
  if (!isUuid(accountId)) return actionError("Social account not found.");

  const account = await prisma.socialAccount.findFirst({
    where: { id: accountId, companyId: actor.companyId },
    select: { clientId: true },
  });
  if (!account) return actionError("Social account not found.");

  const outcome = await checkAccountConnection({ socialAccountId: accountId, actorCompanyId: actor.companyId });
  if (!outcome.ok) return actionError(outcome.message);

  revalidatePath(`${SETTINGS_PATH}/${account.clientId}/social-accounts`);
  return actionSuccess(outcome.data);
}

/** Re-exported so a settings page can name a platform without a second import. */
export type { SocialPlatform };
