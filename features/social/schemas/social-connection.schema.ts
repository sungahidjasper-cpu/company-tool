import { z } from "zod";

import { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 9 — the inputs a browser may send about a connection.
 *
 * READ THE ABSENCES. There is no token field, no page-id field, no
 * companyId and no clientId-plus-accountId pair that could disagree:
 *
 *  - Starting a flow takes a client and a platform. The company comes from
 *    the session, never from here.
 *  - Selecting a page takes the id of a page the PROVIDER offered during this
 *    flow, checked against the provider again before anything is stored — so
 *    a typed page id cannot stand in for an authorization. Which flow is
 *    being finished comes from an httpOnly cookie, not from the request body.
 *  - Disconnecting takes an account id and nothing else.
 *
 * Every id is shape-checked here and then re-read server-side through the
 * actor's own company. Shape validation is not authorization.
 */

const platformEnum = z.enum(Object.values(SocialPlatform) as [SocialPlatform, ...SocialPlatform[]]);

export const startSocialConnectionSchema = z.object({
  clientId: z.string().min(1, "Choose a client."),
  platform: platformEnum,
  /**
   * Set when reconnecting one existing account, so the flow reattaches to it
   * instead of creating a second row for the same page.
   */
  accountId: z.string().min(1).optional(),
});

export const disconnectSocialAccountSchema = z.object({
  accountId: z.string().min(1),
});

/**
 * Note what is NOT here: the selection token. It lives in an httpOnly cookie
 * the callback set, so the server reads it itself — a browser cannot send a
 * token it cannot read, and there is no parameter through which one could be
 * substituted.
 */
export const selectDiscoveredAccountSchema = z.object({
  /** One of the ids the provider itself returned. Verified against the provider before use. */
  externalId: z.string().min(1).max(128),
});

export type StartSocialConnectionInput = z.input<typeof startSocialConnectionSchema>;
export type DisconnectSocialAccountInput = z.input<typeof disconnectSocialAccountSchema>;
export type SelectDiscoveredAccountInput = z.input<typeof selectDiscoveredAccountSchema>;

/**
 * Whether a platform can be connected at all, and whether this deployment is
 * configured for it. Server-derived; a client component only renders it.
 *
 * `missingKeys` is present only for a user who may manage configuration, and
 * names environment variables — never values. A normal user sees `summary`.
 */
export type PlatformConnectivity = {
  platform: SocialPlatform;
  /** False when Cloud Compass has no real provider for this platform yet. */
  connectable: boolean;
  /** False when the provider exists but this deployment lacks its credentials. */
  configured: boolean;
  /** One plain sentence, safe for anyone to read. Null when everything is in place. */
  summary: string | null;
  /** Developer diagnostic. Empty unless the viewer may manage configuration. */
  missingKeys: string[];
};
