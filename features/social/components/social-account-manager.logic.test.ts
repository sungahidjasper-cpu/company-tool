import { describe, expect, it } from "vitest";

import { buildPlatformSections } from "@/features/social/components/social-account-manager.logic";
import type { SocialAccountSummary } from "@/features/social/schemas/social-account.schema";
import type { PlatformConnectivity } from "@/features/social/schemas/social-connection.schema";
import { ALL_PLATFORMS } from "@/features/social/services/social-platforms";

/**
 * Phase 9C — the settings page's platform-grouping logic.
 *
 * The point being tested: every platform the schema knows about is
 * represented exactly once, whether or not this client has touched it, and
 * nothing here invents an account, a connection, or a capability that the
 * inputs did not already state.
 */

function account(over: Partial<SocialAccountSummary> = {}): SocialAccountSummary {
  return {
    id: "acct-1",
    clientId: "client-1",
    platform: "FACEBOOK",
    handle: "handle",
    displayName: null,
    status: "ACTIVE",
    connectionState: "NOT_CONNECTED",
    externalId: null,
    connectedAt: null,
    lastCheckedAt: null,
    lastCheckError: null,
    hasStoredCredential: false,
    targetCount: 0,
    ...over,
  };
}

function connectivity(over: Partial<PlatformConnectivity> = {}): PlatformConnectivity {
  return {
    platform: "FACEBOOK",
    connectable: true,
    configured: true,
    summary: null,
    missingKeys: [],
    ...over,
  };
}

describe("buildPlatformSections", () => {
  it("1. produces exactly one section per platform the schema knows about", () => {
    const sections = buildPlatformSections([], []);
    expect(sections.map((s) => s.platform)).toEqual([...ALL_PLATFORMS]);
  });

  it("2. a platform with no account gets an empty accounts array, not undefined", () => {
    const sections = buildPlatformSections([], []);
    for (const section of sections) expect(section.accounts).toEqual([]);
  });

  it("3. an existing account lands under its own platform's section", () => {
    const acct = account({ platform: "INSTAGRAM", handle: "acmeplumbing" });
    const sections = buildPlatformSections([acct], []);
    const instagram = sections.find((s) => s.platform === "INSTAGRAM")!;
    expect(instagram.accounts).toEqual([acct]);
    // Every other section is untouched.
    for (const section of sections) {
      if (section.platform !== "INSTAGRAM") expect(section.accounts).toEqual([]);
    }
  });

  it("4. multiple accounts on the same platform are grouped together, sorted by handle", () => {
    const b = account({ id: "b", platform: "FACEBOOK", handle: "zzz-page" });
    const a = account({ id: "a", platform: "FACEBOOK", handle: "aaa-page" });
    const sections = buildPlatformSections([b, a], []);
    const facebook = sections.find((s) => s.platform === "FACEBOOK")!;
    expect(facebook.accounts.map((acc) => acc.id)).toEqual(["a", "b"]);
  });

  it("5. connectivity is matched to its own platform, not applied globally", () => {
    const fb = connectivity({ platform: "FACEBOOK", connectable: true, configured: true });
    const ig = connectivity({ platform: "INSTAGRAM", connectable: false, configured: false });
    const sections = buildPlatformSections([], [fb, ig]);
    expect(sections.find((s) => s.platform === "FACEBOOK")!.connectivity).toEqual(fb);
    expect(sections.find((s) => s.platform === "INSTAGRAM")!.connectivity).toEqual(ig);
  });

  it("6. a platform with no connectivity row is undefined, not fabricated", () => {
    const sections = buildPlatformSections([], [connectivity({ platform: "FACEBOOK" })]);
    expect(sections.find((s) => s.platform === "LINKEDIN")!.connectivity).toBeUndefined();
  });

  it("7. no account and no connectivity input produces zero fabricated data anywhere", () => {
    const sections = buildPlatformSections([], []);
    expect(sections.every((s) => s.accounts.length === 0 && s.connectivity === undefined)).toBe(true);
  });
});

/*
 * Phase 9E — the "can this platform be connected" check itself moved to
 * describePlatformCapability in social-connection-status.ts (see that
 * file's own tests), alongside describeConnection and describeAvailability,
 * so there is exactly one place that turns PlatformConnectivity into a
 * decision — not a second one competing with it here.
 */
