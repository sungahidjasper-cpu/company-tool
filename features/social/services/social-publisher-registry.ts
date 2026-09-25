import "server-only";

import { metaFacebookPublisher } from "@/features/social/services/publishers/meta-facebook.publisher";
import type { SocialPublisher } from "@/features/social/services/social-publisher";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 10A — which platforms actually have a working publisher, mirroring
 * social-provider-registry.ts's split for connecting.
 *
 * SERVER-ONLY, and separate from social-publisher.ts on purpose: a real
 * publisher implementation calls a provider's API, so nothing that could
 * reach a client bundle may import this file.
 */
const PUBLISHERS: Partial<Record<SocialPlatform, SocialPublisher>> = {
  FACEBOOK: metaFacebookPublisher,
};

/** The publisher for a platform, or null when Cloud Compass cannot genuinely publish to it yet. */
export function socialPublisherFor(platform: SocialPlatform): SocialPublisher | null {
  return PUBLISHERS[platform] ?? null;
}
