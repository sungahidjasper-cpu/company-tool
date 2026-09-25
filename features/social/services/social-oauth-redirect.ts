import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 9 — the one place the OAuth redirect URI is built.
 *
 * WHY ONE PLACE. Providers require the redirect URI sent when starting the
 * flow to be byte-identical to the one sent during the code exchange, and
 * both must exactly match a URI pre-registered with the provider. Meta is
 * explicit about the exact match. Building the string twice is how those
 * silently drift apart, so it is built once here and used by the authorize
 * step, the exchange step and the callback route alike.
 *
 * NO SECRETS HERE — this reads a base URL, nothing else.
 */

/** FACEBOOK -> "facebook". The URL segment, and the folder name under app/api/social/connect. */
export function platformSlug(platform: SocialPlatform): string {
  return platform.toLowerCase().replace(/_/g, "-");
}

export type RedirectUriResolution =
  | { ok: true; redirectUri: string }
  | { ok: false; missingKeys: string[] };

export type OAuthOriginResolution =
  | { ok: true; origin: string }
  | { ok: false; missingKeys: string[] };

/**
 * The public origin Cloud Compass is reachable at, for building a
 * BROWSER-FACING redirect during the OAuth flow (the provider's callback
 * itself, and where the callback route in turn sends the browser next).
 *
 * THE ONE SOURCE OF TRUTH FOR THIS. A request's own `nextUrl.origin` is not
 * safe to use here: behind a reverse proxy or tunnel (ngrok, in local dev),
 * that reflects where the Node process is actually bound (e.g.
 * `localhost:3000`), not the public address the browser can reach — a
 * redirect built from it sends the browser somewhere it cannot load. This is
 * the same `SOCIAL_OAUTH_REDIRECT_BASE_URL` (falling back to `NEXTAUTH_URL`)
 * that `resolveRedirectUri` already uses for the provider-facing URI, kept as
 * one function so the two can never drift apart.
 */
export function resolveOAuthOrigin(): OAuthOriginResolution {
  const base = process.env.SOCIAL_OAUTH_REDIRECT_BASE_URL || process.env.NEXTAUTH_URL;
  if (!base) return { ok: false, missingKeys: ["SOCIAL_OAUTH_REDIRECT_BASE_URL"] };
  return { ok: true, origin: base.replace(/\/+$/, "") };
}

/**
 * The exact callback URI for one platform.
 *
 * `SOCIAL_OAUTH_REDIRECT_BASE_URL` exists because the URI a provider will
 * accept is not always the URL the app is served on: Meta requires HTTPS and
 * an exact pre-registered match, so a local HTTP origin generally cannot be
 * registered as-is and a tunnel's public HTTPS origin is set here instead.
 * When it is unset the app's own `NEXTAUTH_URL` is used, which is the
 * existing convention for "where this app lives".
 *
 * Deliberately does NOT judge the scheme. Whether a provider accepts a given
 * origin is the provider's rule to enforce, and a check here would just be a
 * guess about someone else's app settings.
 */
export function resolveRedirectUri(platform: SocialPlatform): RedirectUriResolution {
  const resolved = resolveOAuthOrigin();
  if (!resolved.ok) return resolved;
  return { ok: true, redirectUri: `${resolved.origin}/api/social/connect/${platformSlug(platform)}/callback` };
}
