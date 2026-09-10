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
  const base = process.env.SOCIAL_OAUTH_REDIRECT_BASE_URL || process.env.NEXTAUTH_URL;
  if (!base) return { ok: false, missingKeys: ["SOCIAL_OAUTH_REDIRECT_BASE_URL"] };

  const trimmed = base.replace(/\/+$/, "");
  return { ok: true, redirectUri: `${trimmed}/api/social/connect/${platformSlug(platform)}/callback` };
}
