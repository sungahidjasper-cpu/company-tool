import type { SocialAccountSummary } from "@/features/social/schemas/social-account.schema";
import type { PlatformConnectivity } from "@/features/social/schemas/social-connection.schema";
import { ALL_PLATFORMS } from "@/features/social/services/social-platforms";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 9C — pure layout logic for Settings → Social accounts.
 *
 * THE UX PROBLEM THIS FIXES: the page used to be built around a flat list of
 * accounts, with "Add an account" first and a platform this client has never
 * touched simply absent from the page — so Facebook, Instagram, LinkedIn etc.
 * were only ever visible if someone had already typed a handle for them. A
 * person had no way to SEE that Instagram exists as a platform without first
 * discovering the manual form.
 *
 * This groups every platform the schema knows about — via ALL_PLATFORMS,
 * unchanged from Phase 7 — into one section per platform, in a stable order,
 * whether or not this client has an account on it yet. That is what lets
 * "CONFIGURE IDENTITY ≠ CONNECT PLATFORM" become the PAGE'S structure rather
 * than something only explained in a sentence.
 *
 * No new fact is invented here: accounts are exactly what
 * listClientSocialAccountsAction already returned, and connectivity is
 * exactly what listPlatformConnectivityAction already returned. This is
 * purely "how to arrange what we already have."
 */

export type PlatformSection = {
  platform: SocialPlatform;
  /** Every account this client has configured on this platform. Usually 0 or 1. */
  accounts: SocialAccountSummary[];
  /** Whether this platform can be connected at all, and whether this deployment is configured for it. */
  connectivity: PlatformConnectivity | undefined;
};

/**
 * One section per platform in ALL_PLATFORMS' order, each carrying whichever
 * accounts this client already has on it (possibly none) plus that
 * platform's connectivity. A platform with existing accounts is never
 * duplicated — the "connect a fresh one" prompt is a per-account decision
 * inside the section, not a second list to keep in sync with this one.
 */
export function buildPlatformSections(
  accounts: readonly SocialAccountSummary[],
  connectivity: readonly PlatformConnectivity[]
): PlatformSection[] {
  const connectivityByPlatform = new Map(connectivity.map((row) => [row.platform, row]));
  const accountsByPlatform = new Map<SocialPlatform, SocialAccountSummary[]>();
  for (const account of accounts) {
    const existing = accountsByPlatform.get(account.platform);
    if (existing) existing.push(account);
    else accountsByPlatform.set(account.platform, [account]);
  }
  for (const list of accountsByPlatform.values()) {
    list.sort((a, b) => a.handle.localeCompare(b.handle));
  }

  return ALL_PLATFORMS.map((platform) => ({
    platform,
    accounts: accountsByPlatform.get(platform) ?? [],
    connectivity: connectivityByPlatform.get(platform),
  }));
}
