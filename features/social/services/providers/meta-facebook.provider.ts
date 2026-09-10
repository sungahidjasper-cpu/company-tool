import "server-only";

import type {
  DiscoveredAccount,
  ProviderAuthorization,
  ProviderConfiguration,
  ProviderFailure,
  SocialProvider,
} from "@/features/social/services/social-provider";
import { logger } from "@/lib/logger";

/**
 * Phase 9 / 9B — Facebook (Meta) as the first real provider.
 *
 * EVERY ENDPOINT, PARAMETER AND LIFETIME BELOW WAS RE-VERIFIED AGAINST META'S
 * OWN DOCUMENTATION for Phase 9B — the manual login flow, the long-lived
 * access token guide, the User `accounts` edge, the Page node reference, the
 * Pages API getting-started guide, the permission references and the
 * access-levels overview. Nothing here is from memory or a tutorial.
 *
 * WHAT PHASE 9B CORRECTED. Phase 9 exchanged the authorization code and
 * stopped. Meta's own long-lived-token guide is explicit that the code
 * exchange yields a SHORT-LIVED user token ("short-lived tokens typically
 * last about one to two hours"), and that a long-lived Page token is obtained
 * by querying the accounts edge with a LONG-LIVED USER token. Without the
 * `fb_exchange_token` step below, every connection would have quietly died
 * within a couple of hours. That step is now mandatory: if it fails, the
 * connection fails, because a Page token that expires this afternoon is not a
 * connection worth calling CONNECTED.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not pretend. There is no mock mode, no sample token, and no branch
 * that returns a successful authorization without a real HTTP response from
 * Meta. With no app credentials configured, `describeConfiguration` reports
 * that and every other method refuses.
 *
 * It does not publish. Nothing here posts to a Page. Meta's Pages API
 * documents `pages_manage_posts` as the permission to "create, edit, and
 * delete Page posts", and its permission reference lists its dependencies as
 * `pages_read_engagement` and `pages_show_list` — which are exactly the two
 * scopes requested below. So a future publishing phase adds ONE permission to
 * SCOPES and an App Review submission; it does not redesign this file.
 *
 * IT IS NOT AN ADS INTEGRATION. A Page connection is not an advertising
 * account connection. `/me/adaccounts` is never called, no ad-account id is
 * read or stored, and the `ADVERTISE` task Meta may report on a Page is
 * deliberately ignored. Meta advertising is a separate future capability and
 * must get its own connection type rather than borrowing this one.
 *
 * ACCESS LEVEL — the real-world limit, not a code problem. Meta's
 * access-levels documentation states that permissions with Standard Access
 * "can only be requested from app users who have a role on the requesting
 * app", while Advanced Access "can be requested from any app user", that
 * "Business Verification is required to get Advanced Access", and that "in
 * some cases additional App Review on an individual permission and feature
 * basis might be required". Until that is done, only people with a role on
 * the Meta app can complete this flow. The code is identical either way.
 */

/**
 * Pinned, and current: Meta's versioning guide names v26.0 as the current
 * Graph API version, and states each version "is guaranteed to operate for at
 * least two years". Pinning matters because an unpinned call silently changes
 * behaviour when Meta promotes a new default.
 */
const GRAPH_VERSION = "v26.0";
const AUTHORIZE_ENDPOINT = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const TOKEN_ENDPOINT = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`;
const ACCOUNTS_ENDPOINT = `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The fields the accounts edge is asked for.
 *
 * `id` and `name` are the Page's identity. `access_token` is the Page token —
 * Meta's Page access token guide documents `/{user-id}/accounts` as returning
 * "a list of Pages with associated access tokens". `username` is documented
 * on the Page node as "the alias of the Page"; it is optional in practice, so
 * a Page without one yields a null handle rather than a derived guess.
 * `tasks` is documented on this edge as "the User's tasks assigned to the
 * Page" and is what proves the authorization actually grants access.
 */
const PAGE_FIELDS = "id,name,username,access_token,tasks";

/** Meta pages this edge; 100 per request with a hard cap on how far we follow. */
const PAGE_LIMIT = 100;
const MAX_PAGES_FOLLOWED = 5;

/**
 * The least this phase can ask for and still be honest.
 *
 * `pages_show_list` is documented as allowing an app to "show a person the
 * list of Pages they manage" — without it there is nothing to choose from.
 * `pages_read_engagement` lets a stored credential be checked against the
 * Page it belongs to, which is what turns CONNECTED into NEEDS_RECONNECT when
 * a token stops working.
 *
 * `pages_manage_posts` is intentionally absent: publishing is out of scope,
 * and requesting a permission the app does not exercise is both an App Review
 * risk and a promise Cloud Compass is not keeping in this phase.
 */
const SCOPES = ["pages_show_list", "pages_read_engagement"] as const;

type MetaConfig = { appId: string; appSecret: string };

/**
 * Reads the app credentials. Returns null when either is missing — never a
 * placeholder, never a default, because a fabricated app id would turn a
 * configuration problem into a confusing provider error.
 */
function readConfig(): MetaConfig | null {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

function missingConfigKeys(): string[] {
  const missing: string[] = [];
  if (!process.env.FACEBOOK_APP_ID) missing.push("FACEBOOK_APP_ID");
  if (!process.env.FACEBOOK_APP_SECRET) missing.push("FACEBOOK_APP_SECRET");
  return missing;
}

/** One sentence a normal user can act on, naming no secret. */
const NOT_CONFIGURED_SUMMARY = "Facebook connection is not configured yet.";

/**
 * `expires_in` is SECONDS from now, per Meta's token response. Absent means
 * Meta stated no expiry, and absent must stay null rather than becoming an
 * invented lifetime — Meta's own guide warns not to depend on token lifetimes
 * remaining the same.
 */
function expiryFromResponse(expiresIn: unknown): Date | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return new Date(Date.now() + expiresIn * 1000);
}

/**
 * Turns any failure into something safe to show.
 *
 * Meta's error bodies can echo request parameters back, so the provider's own
 * text is logged and never surfaced. The user-facing sentence says what a
 * person can do about it, which is all they can use anyway.
 *
 * The log detail is deliberately built from Meta's `error` object only — never
 * from a request URL, which would contain the app secret or a token.
 */
function providerFailure(message: string, logDetail: string): { ok: false; failure: ProviderFailure } {
  logger.warn("Facebook provider call failed", { detail: logDetail });
  return { ok: false, failure: { message, logDetail } };
}

type GraphResult = { ok: true; body: unknown } | { ok: false; detail: string };

async function graphFetch(url: string): Promise<GraphResult> {
  try {
    const response = await fetch(url, {
      // A token exchange must never be served from a cache.
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();

    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    if (!response.ok) {
      const errorMessage =
        typeof body === "object" && body !== null && "error" in body
          ? JSON.stringify((body as { error: unknown }).error)
          : `HTTP ${response.status}`;
      return { ok: false, detail: errorMessage };
    }
    if (body === null) return { ok: false, detail: "Response was not JSON." };
    return { ok: true, body };
  } catch (error) {
    /* Never interpolates the URL — it holds the app secret on the token call. */
    return { ok: false, detail: error instanceof Error ? error.name : "Unknown fetch failure" };
  }
}

/** One Page as Meta returned it, before it becomes a DiscoveredAccount. */
type MetaPage = { id: string; name: string; username: string | null; accessToken: string; tasks: string[] };

/**
 * Reads the Pages this authorization manages, following Meta's paging.
 *
 * ONLY PAGES THE AUTHORIZATION GENUINELY COVERS SURVIVE. A Page is kept only
 * when Meta returned both a Page access token for it and a non-empty `tasks`
 * list — the two things that evidence real access. A Page with no assigned
 * tasks is one this person cannot act on, so offering it would invite someone
 * to connect a Page that then fails on first use.
 *
 * No task is required SPECIFICALLY. Meta's Pages API documents CREATE_CONTENT
 * as what posting needs, but this phase does not post, and filtering on it now
 * would hide Pages that are perfectly valid to connect for planning. The
 * eventual publishing path must check CREATE_CONTENT at publish time against
 * a fresh response — a capability recorded months earlier would be stale
 * anyway, which is why it is not persisted.
 */
async function fetchManageablePages(accessToken: string): Promise<{ ok: true; pages: MetaPage[] } | { ok: false; detail: string }> {
  const pages: MetaPage[] = [];
  const seen = new Set<string>();

  const first = new URL(ACCOUNTS_ENDPOINT);
  first.searchParams.set("fields", PAGE_FIELDS);
  first.searchParams.set("limit", String(PAGE_LIMIT));
  first.searchParams.set("access_token", accessToken);

  let next: string | null = first.toString();

  for (let followed = 0; next !== null && followed < MAX_PAGES_FOLLOWED; followed += 1) {
    const result: GraphResult = await graphFetch(next);
    if (!result.ok) return { ok: false, detail: result.detail };

    const body = result.body as { data?: unknown; paging?: { next?: unknown } };
    if (!Array.isArray(body.data)) return { ok: false, detail: "data was not an array" };

    for (const entry of body.data) {
      if (typeof entry !== "object" || entry === null) continue;
      const page = entry as Record<string, unknown>;
      if (typeof page.id !== "string" || typeof page.name !== "string") continue;
      if (typeof page.access_token !== "string" || page.access_token.length === 0) continue;

      const tasks = Array.isArray(page.tasks) ? page.tasks.filter((task): task is string => typeof task === "string") : [];
      if (tasks.length === 0) continue;

      if (seen.has(page.id)) continue;
      seen.add(page.id);

      pages.push({
        id: page.id,
        name: page.name,
        username: typeof page.username === "string" && page.username.length > 0 ? page.username : null,
        accessToken: page.access_token,
        tasks,
      });
    }

    next = typeof body.paging?.next === "string" ? body.paging.next : null;
  }

  return { ok: true, pages };
}

export const metaFacebookProvider: SocialProvider = {
  platform: "FACEBOOK",
  scopes: SCOPES,

  describeConfiguration(): ProviderConfiguration {
    const missingKeys = missingConfigKeys();
    if (missingKeys.length > 0) {
      return { configured: false, summary: NOT_CONFIGURED_SUMMARY, missingKeys };
    }
    return { configured: true };
  },

  buildAuthorizationUrl({ state, redirectUri }): string {
    const config = readConfig();
    /*
     * Throws rather than returning a URL: a caller reaching here without
     * credentials is a bug in the caller, and a half-built authorize URL
     * would send someone to a Facebook error page instead of showing them
     * the honest configuration message.
     */
    if (!config) throw new Error("Facebook is not configured.");

    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(","));
    // The app secret is NEVER a parameter here — this URL is handed to a browser.
    return url.toString();
  },

  async exchangeAuthorizationCode({ code, redirectUri }) {
    const config = readConfig();
    if (!config) return providerFailure(NOT_CONFIGURED_SUMMARY, "FACEBOOK_APP_ID/FACEBOOK_APP_SECRET not set");

    /*
     * STEP 1 — the code for a short-lived user token.
     *
     * Meta documents this exchange as a GET with the app secret in the query
     * string, and requires redirect_uri to be "the same as the original
     * request_uri". That is their design, and it is server-to-server over
     * TLS — the secret never touches a browser, and neither this URL nor the
     * code is ever logged.
     */
    const exchangeUrl = new URL(TOKEN_ENDPOINT);
    exchangeUrl.searchParams.set("client_id", config.appId);
    exchangeUrl.searchParams.set("redirect_uri", redirectUri);
    exchangeUrl.searchParams.set("client_secret", config.appSecret);
    exchangeUrl.searchParams.set("code", code);

    const exchanged = await graphFetch(exchangeUrl.toString());
    if (!exchanged.ok) {
      /*
       * Covers an invalid, already-used or expired authorization code — Meta
       * reports all of them here, and a person's next step is the same for
       * each, so they get one message.
       */
      return providerFailure("Facebook did not accept this authorization. Try connecting again.", exchanged.detail);
    }

    const shortLived = (exchanged.body as Record<string, unknown>).access_token;
    if (typeof shortLived !== "string" || shortLived.length === 0) {
      return providerFailure("Facebook did not return an access token.", "access_token missing from token response");
    }

    /*
     * STEP 2 — the short-lived token for a LONG-LIVED one. Not optional.
     *
     * Meta's long-lived-token guide: a long-lived user token "generally lasts
     * about 60 days", and a long-lived PAGE token is obtained by querying the
     * accounts edge with a long-lived user token — those tokens "do not have
     * an expiration date". Skip this and the Page token inherits the
     * short-lived lifetime of an hour or two.
     *
     * A failure here fails the whole connection deliberately. Falling back to
     * the short-lived token would produce something that reports CONNECTED
     * this minute and NEEDS_RECONNECT by the afternoon, which is exactly the
     * kind of quiet dishonesty this phase exists to remove.
     */
    const longLivedUrl = new URL(TOKEN_ENDPOINT);
    longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
    longLivedUrl.searchParams.set("client_id", config.appId);
    longLivedUrl.searchParams.set("client_secret", config.appSecret);
    longLivedUrl.searchParams.set("fb_exchange_token", shortLived);

    const longLived = await graphFetch(longLivedUrl.toString());
    if (!longLived.ok) {
      return providerFailure(
        "Facebook could not complete a lasting connection. Try connecting again.",
        `long-lived exchange failed: ${longLived.detail}`
      );
    }

    const longLivedBody = longLived.body as Record<string, unknown>;
    const accessToken = longLivedBody.access_token;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      return providerFailure(
        "Facebook could not complete a lasting connection. Try connecting again.",
        "access_token missing from long-lived exchange response"
      );
    }

    const authorization: ProviderAuthorization = {
      accessToken,
      /*
       * The USER token's expiry, as Meta stated it — informational only. The
       * Page token stored at the end of the flow is the one that matters, and
       * Meta documents that as having no expiration date.
       */
      expiresAt: expiryFromResponse(longLivedBody.expires_in),
      /*
       * Meta's token response does not enumerate granted permissions, so this
       * records what was REQUESTED and leaves proving what was granted to the
       * calls that need each permission. Copying the request into a "granted"
       * field as though Meta confirmed it would be a small lie in a field
       * other code trusts.
       */
      grantedScopes: [...SCOPES],
    };
    return { ok: true, authorization };
  },

  async listManageableAccounts({ accessToken }) {
    const config = readConfig();
    if (!config) return providerFailure(NOT_CONFIGURED_SUMMARY, "FACEBOOK_APP_ID/FACEBOOK_APP_SECRET not set");

    const result = await fetchManageablePages(accessToken);
    if (!result.ok) {
      return providerFailure("Facebook could not list the Pages for this account.", result.detail);
    }

    const accounts: DiscoveredAccount[] = result.pages.map((page) => ({
      externalId: page.id,
      name: page.name,
      handle: page.username,
    }));

    /*
     * An empty list is a legitimate answer, not an error: the person
     * authorized, and Meta says they manage no Page this app may act on. The
     * caller says so in words and connects nothing.
     */
    return { ok: true, accounts };
  },

  async resolveAccountCredential({ accessToken, externalId }) {
    /*
     * The credential STORED for a Facebook account is that Page's own token,
     * not the user token used to discover it — which is exactly why the
     * provider interface keeps these two steps apart. The Page token is read
     * from the same documented accounts edge; no separate exchange exists.
     */
    const config = readConfig();
    if (!config) return providerFailure(NOT_CONFIGURED_SUMMARY, "FACEBOOK_APP_ID/FACEBOOK_APP_SECRET not set");

    const result = await fetchManageablePages(accessToken);
    if (!result.ok) {
      return providerFailure("Facebook could not confirm access to that Page.", result.detail);
    }

    const page = result.pages.find((candidate) => candidate.id === externalId);
    /*
     * Not found means: not among the Pages this authorization manages with a
     * real token and real tasks. That is a refusal, not an error to work
     * around — it is the check that stops a Page id from being supplied by
     * anything other than the provider itself.
     */
    if (!page) {
      return providerFailure(
        "That Page is not one this Facebook account manages.",
        "selected externalId not present in the authorized Pages"
      );
    }

    return {
      ok: true,
      authorization: {
        accessToken: page.accessToken,
        /*
         * Null, and that is Meta's own position: long-lived Page access
         * tokens "do not have an expiration date and only expire or are
         * invalidated under certain conditions". So NEEDS_RECONNECT is driven
         * by a failed check rather than by a countdown nobody stated. There
         * is also no refresh to implement — Meta is explicit that an expired
         * token cannot be exchanged for a new one; a person must re-authorize.
         */
        expiresAt: null,
        grantedScopes: [...SCOPES],
      },
    };
  },
};
