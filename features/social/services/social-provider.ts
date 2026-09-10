import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 9 — what a social platform has to be able to do before Cloud Compass
 * can honestly say it is connected.
 *
 * Provider-NEUTRAL on purpose. Facebook is the first provider, not the shape
 * every other platform must be bent into: each method below is something
 * every OAuth 2.0 authorization-code provider genuinely has, and anything
 * Meta-specific (page tokens, Graph versions, the `accounts` edge) stays
 * inside the Meta implementation.
 *
 * There is exactly ONE implementation today. `socialProviderFor` returns null
 * for every other platform, and the UI says so in words rather than offering
 * a Connect button that cannot work.
 *
 * PURE TYPES AND A REGISTRY LOOKUP — no secrets are read in this file, so it
 * is safe for a client component to import the types from it.
 */

/** What one page/profile the provider says a person manages looks like. */
export type DiscoveredAccount = {
  /** The provider's own id. The real identity — never typed by a person. */
  externalId: string;
  /** The name as the provider reports it. */
  name: string;
  /**
   * A public handle/username when the provider actually returns one. Null,
   * not a guess: Meta's Pages response has no guaranteed username field, and
   * inventing one from the name would put fiction in an identity column.
   */
  handle: string | null;
};

/** The result of exchanging an authorization code. No field here is ever returned to a browser. */
export type ProviderAuthorization = {
  /** The user-level token, used to discover which accounts they manage. */
  accessToken: string;
  /** What the provider itself stated, or null when it stated nothing. */
  expiresAt: Date | null;
  /** Permissions the provider says were granted. Not secret. */
  grantedScopes: string[];
};

/**
 * Whether the environment holds what this provider needs.
 *
 * `missingKeys` is a DEVELOPER diagnostic. It names environment variables,
 * never their values, and the settings UI shows only the plain-language
 * `summary` — a normal user has no business learning which specific secret an
 * administrator has not configured yet.
 */
export type ProviderConfiguration =
  | { configured: true }
  | { configured: false; summary: string; missingKeys: string[] };

export type ProviderFailure = {
  /**
   * Safe to show. Provider error text is deliberately NOT passed through
   * verbatim, because a provider may echo request parameters back.
   */
  message: string;
  /** For the server log only. */
  logDetail?: string;
};

export type SocialProvider = {
  platform: SocialPlatform;

  /** The permissions this provider is asked for, so a reviewer can see them in one place. */
  readonly scopes: readonly string[];

  describeConfiguration(): ProviderConfiguration;

  /**
   * Where to send the person to authorize. Must embed `state` and the exact
   * pre-registered redirect URI, and must never embed a client secret.
   */
  buildAuthorizationUrl(input: { state: string; redirectUri: string }): string;

  /** Server-side code → token exchange. The code never reaches the browser. */
  exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<{ ok: true; authorization: ProviderAuthorization } | { ok: false; failure: ProviderFailure }>;

  /** The accounts the authorized person actually manages, straight from the provider. */
  listManageableAccounts(input: {
    accessToken: string;
  }): Promise<{ ok: true; accounts: DiscoveredAccount[] } | { ok: false; failure: ProviderFailure }>;

  /**
   * The credential to STORE for one chosen account. Separate from
   * `exchangeAuthorizationCode` because they are not always the same token —
   * Meta stores a per-Page token, not the user token used for discovery.
   */
  resolveAccountCredential(input: {
    accessToken: string;
    externalId: string;
  }): Promise<{ ok: true; authorization: ProviderAuthorization } | { ok: false; failure: ProviderFailure }>;
};

/** Platforms with a real implementation. Everything else is honestly "not built yet". */
export const CONNECTABLE_PLATFORMS: readonly SocialPlatform[] = ["FACEBOOK"];

export function isConnectablePlatform(platform: SocialPlatform): boolean {
  return CONNECTABLE_PLATFORMS.includes(platform);
}
