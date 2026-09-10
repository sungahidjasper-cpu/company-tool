import "server-only";

import { metaFacebookProvider } from "@/features/social/services/providers/meta-facebook.provider";
import type { SocialProvider } from "@/features/social/services/social-provider";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 9 — which platforms actually have a working provider.
 *
 * SERVER-ONLY, and separate from social-provider.ts on purpose: the types
 * there are safe anywhere, but a provider implementation reads app secrets
 * from the environment, so nothing that could reach a client bundle may
 * import this file.
 *
 * ONE ENTRY. Facebook is implemented; every other platform resolves to null,
 * and the UI states that in words. An empty entry here is not a bug to fill
 * in with a stub — a stub provider is precisely the fake connection this
 * phase exists to remove.
 */
const PROVIDERS: Partial<Record<SocialPlatform, SocialProvider>> = {
  FACEBOOK: metaFacebookProvider,
};

/** The provider for a platform, or null when Cloud Compass cannot genuinely connect it yet. */
export function socialProviderFor(platform: SocialPlatform): SocialProvider | null {
  return PROVIDERS[platform] ?? null;
}
