import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { platformSlug, resolveRedirectUri } from "@/features/social/services/social-oauth-redirect";

/**
 * Phase 9 — the redirect URI.
 *
 * Providers compare the URI sent when starting a flow with the one sent
 * during the code exchange, and both against one pre-registered with them.
 * These tests exist because building that string in two places is exactly how
 * an integration breaks in a way nobody can see.
 */
const originalBase = process.env.SOCIAL_OAUTH_REDIRECT_BASE_URL;
const originalNextAuth = process.env.NEXTAUTH_URL;

beforeEach(() => {
  delete process.env.SOCIAL_OAUTH_REDIRECT_BASE_URL;
  delete process.env.NEXTAUTH_URL;
});

afterEach(() => {
  if (originalBase === undefined) delete process.env.SOCIAL_OAUTH_REDIRECT_BASE_URL;
  else process.env.SOCIAL_OAUTH_REDIRECT_BASE_URL = originalBase;
  if (originalNextAuth === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalNextAuth;
});

describe("the platform's URL segment", () => {
  it("1. is the lowercased platform name, with underscores as hyphens", () => {
    expect(platformSlug("FACEBOOK")).toBe("facebook");
    expect(platformSlug("GOOGLE_BUSINESS_PROFILE")).toBe("google-business-profile");
  });
});

describe("resolving the callback URI", () => {
  it("2. uses the app's own URL when no override is set", () => {
    process.env.NEXTAUTH_URL = "https://compass.example";
    const resolved = resolveRedirectUri("FACEBOOK");
    expect(resolved.ok && resolved.redirectUri).toBe("https://compass.example/api/social/connect/facebook/callback");
  });

  it("3. prefers the explicit override, which is what a tunnel needs", () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    process.env.SOCIAL_OAUTH_REDIRECT_BASE_URL = "https://public.tunnel.example";
    const resolved = resolveRedirectUri("FACEBOOK");
    expect(resolved.ok && resolved.redirectUri).toBe("https://public.tunnel.example/api/social/connect/facebook/callback");
  });

  it("4. a trailing slash does not produce a doubled one — providers match exactly", () => {
    process.env.SOCIAL_OAUTH_REDIRECT_BASE_URL = "https://compass.example///";
    const resolved = resolveRedirectUri("FACEBOOK");
    expect(resolved.ok && resolved.redirectUri).toBe("https://compass.example/api/social/connect/facebook/callback");
  });

  it("5. with no base URL at all it fails, naming the variable to set", () => {
    const resolved = resolveRedirectUri("FACEBOOK");
    expect(resolved.ok).toBe(false);
    expect(!resolved.ok && resolved.missingKeys).toEqual(["SOCIAL_OAUTH_REDIRECT_BASE_URL"]);
  });

  it("6. the path matches the route handler that actually exists", () => {
    /*
     * app/api/social/connect/facebook/callback/route.ts. If this ever drifts,
     * a real authorization would land on a 404 and the failure would look
     * like the provider's fault.
     */
    process.env.NEXTAUTH_URL = "https://compass.example";
    const resolved = resolveRedirectUri("FACEBOOK");
    expect(resolved.ok && new URL(resolved.redirectUri).pathname).toBe("/api/social/connect/facebook/callback");
  });

  it("7. an http origin is NOT silently rejected — whether a provider accepts it is the provider's rule", () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    const resolved = resolveRedirectUri("FACEBOOK");
    expect(resolved.ok).toBe(true);
  });
});
