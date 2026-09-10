import { NextResponse, type NextRequest } from "next/server";

import {
  SOCIAL_CONNECT_SELECTION_COOKIE,
  SOCIAL_CONNECT_SELECTION_MAX_AGE_SECONDS,
} from "@/features/social/services/social-connect-cookie";
import { resolveRedirectUri } from "@/features/social/services/social-oauth-redirect";
import {
  consumeOAuthState,
  stashPendingAuthorization,
  stateHashOf,
} from "@/features/social/services/social-oauth-state.service";
import { socialProviderFor } from "@/features/social/services/social-provider-registry";
import { getCurrentUser } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * Phase 9 — where Facebook sends the person back.
 *
 * A ROUTE HANDLER, not a page, because the authorization code must be
 * exchanged server-side. The code arrives here, is swapped for a token
 * server-to-server, and neither the code nor the token is ever put in a
 * response, a redirect URL, a cookie or a log line.
 *
 * WHAT THIS TRUSTS FROM THE BROWSER: the `state` value and the `code`, and
 * nothing else. Not a company, not a client, not an account id — those are
 * read from the state's own row, recorded before the person left the app. A
 * crafted callback naming another company's client therefore does nothing:
 * the query string is not consulted for any of it.
 *
 * EVERY FAILURE PATH FAILS CLOSED. An unknown, expired, reused or malformed
 * state does not reach the token exchange at all; a refused authorization,
 * a failed exchange and a failed Pages call each end as a redirect back to
 * settings with a short reason code. No path sets CONNECTED.
 *
 * The person is still required to be signed in AND to be in the same company
 * as the flow. A callback is a browser request like any other, so session
 * authorization applies here exactly as it does to a server action.
 */

/** Belt and braces — a token exchange must never be cached or prerendered. */
export const dynamic = "force-dynamic";

const SETTINGS_ROOT = "/settings/clients";
/**
 * Short codes, so no provider text or free-form message ever rides in a URL.
 *
 * `no_pages` is deliberately separate from `pages`: "Meta says this person
 * manages no Page we may act on" is a real, expected answer that deserves its
 * own sentence, while `pages` means the call to Meta itself failed. Collapsing
 * them would tell someone their Pages could not be read when in fact they
 * have none.
 */
type FailureCode = "state" | "denied" | "config" | "exchange" | "pages" | "no_pages" | "session";

function failure(request: NextRequest, code: FailureCode, clientId?: string): NextResponse {
  const path = clientId ? `${SETTINGS_ROOT}/${clientId}/social-accounts` : SETTINGS_ROOT;
  const url = new URL(path, request.nextUrl.origin);
  url.searchParams.set("connectError", code);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const provider = socialProviderFor("FACEBOOK");
  if (!provider) return failure(request, "config");

  const params = request.nextUrl.searchParams;

  /*
   * Meta documents the decline response as
   * `?error_reason=user_denied&error=access_denied&error_description=...`.
   * Declining is a normal outcome, not a fault: the state is still consumed
   * below so it cannot be reused, and the person lands back where they
   * started with nothing changed.
   *
   * error_description is READ but never forwarded — it is provider-controlled
   * text arriving in a query string, so it goes to the log and no further.
   */
  const providerError = params.get("error");
  const providerErrorReason = params.get("error_reason");
  const state = params.get("state");
  const code = params.get("code");

  const consumed = await consumeOAuthState(state);
  if (!consumed.ok) {
    /* The reason is logged, never shown — see the service's comment on why. */
    logger.warn("Facebook callback rejected", { reason: consumed.reason });
    return failure(request, "state");
  }
  const context = consumed.context;

  /*
   * Session authorization, using the company from the STATE ROW as the thing
   * to match against. This is the check that stops a valid state from being
   * completed by someone in a different company who intercepted the redirect.
   */
  const actor = await getCurrentUser();
  if (!actor || actor.companyId !== context.companyId) {
    logger.warn("Facebook callback rejected: no matching session for this flow");
    return failure(request, "session");
  }

  if (providerError || providerErrorReason) {
    logger.info("Facebook authorization was not granted", { error: providerError, reason: providerErrorReason });
    return failure(request, "denied", context.clientId);
  }
  /*
   * A callback with neither an error nor a code is malformed. Treated as a
   * denial rather than a distinct code, because there is nothing a person can
   * usefully do differently and the state has already been spent.
   */
  if (!code) {
    logger.warn("Facebook callback arrived with no code and no error");
    return failure(request, "denied", context.clientId);
  }

  const configuration = provider.describeConfiguration();
  if (!configuration.configured) {
    logger.warn("Facebook callback reached with no app credentials configured", {
      missingKeys: configuration.missingKeys,
    });
    return failure(request, "config", context.clientId);
  }

  /*
   * The SAME redirect URI the authorize step sent. Providers compare them,
   * and building the string twice is how they drift — hence one helper.
   */
  const redirect = resolveRedirectUri("FACEBOOK");
  if (!redirect.ok) return failure(request, "config", context.clientId);

  const exchanged = await provider.exchangeAuthorizationCode({ code, redirectUri: redirect.redirectUri });
  if (!exchanged.ok) return failure(request, "exchange", context.clientId);

  const listed = await provider.listManageableAccounts({ accessToken: exchanged.authorization.accessToken });
  if (!listed.ok) return failure(request, "pages", context.clientId);
  if (listed.accounts.length === 0) {
    /*
     * A real and important outcome, and its own message: the person
     * authorized, but Meta reports no Page they manage that this app may act
     * on. Nothing is connected, and saying so is the only honest answer —
     * inventing a Page here is exactly the fabrication this phase exists to
     * prevent.
     */
    logger.info("Facebook authorization returned no manageable pages");
    return failure(request, "no_pages", context.clientId);
  }

  /*
   * The authorization is parked encrypted against this flow's own row and
   * handed back only as a single-use token in an httpOnly cookie. Nothing
   * about the connection is written yet: the account is still whatever it was
   * before, and stays that way until a person chooses a page.
   */
  let selectionToken: string;
  try {
    selectionToken = await stashPendingAuthorization({
      stateHashOfConsumedState: stateHashOf(state as string),
      authorization: exchanged.authorization,
      discovered: listed.accounts,
    });
  } catch (error) {
    /*
     * A database failure at this exact point. Nothing has been connected and
     * the state is already spent, so the only correct outcome is to send the
     * person back to start again. The error text is logged, never shown.
     */
    logger.error("Facebook callback could not park the pending authorization", {
      detail: error instanceof Error ? error.message : "unknown",
    });
    return failure(request, "exchange", context.clientId);
  }

  const destination = new URL(
    `${SETTINGS_ROOT}/${context.clientId}/social-accounts/connect/facebook`,
    request.nextUrl.origin
  );
  const response = NextResponse.redirect(destination);
  response.cookies.set({
    name: SOCIAL_CONNECT_SELECTION_COOKIE,
    value: selectionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SOCIAL_CONNECT_SELECTION_MAX_AGE_SECONDS,
  });
  return response;
}
