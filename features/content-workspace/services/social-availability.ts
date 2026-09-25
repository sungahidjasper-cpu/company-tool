/**
 * Phase 5 — which social platforms this system can actually publish to.
 *
 * Pure and read-only. The answer is derived, never declared: a platform is
 * offered only if the schema has a provider type for it AND the company has a
 * live connection of that type. Today the schema has exactly one provider
 * type, WORDPRESS, so the social answer is genuinely "none" — and it says so
 * rather than showing eight logos that cannot do anything.
 *
 * When a social provider type is added to the schema and a connection is
 * made, this starts returning it without any change here. That is what
 * "data-driven" has to mean: the list follows the data, not a constant in a
 * component.
 */

import { PublishingProviderType } from "@/lib/generated/prisma/enums";

/**
 * Provider types this system would treat as social if the schema had them.
 *
 * NOT a UI list and never rendered as one: it is intersected with the
 * provider types that actually exist, and the intersection is what callers
 * see. Naming a platform here grants it nothing.
 */
const SOCIAL_PROVIDER_CANDIDATES = [
  "FACEBOOK",
  "INSTAGRAM",
  "LINKEDIN",
  "TIKTOK",
  "X",
  "TWITTER",
  "PINTEREST",
  "YOUTUBE",
  "GOOGLE_BUSINESS_PROFILE",
] as const;

/** The social provider types the schema genuinely supports right now. */
export function supportedSocialProviderTypes(): string[] {
  const inSchema = new Set(Object.values(PublishingProviderType) as string[]);
  return SOCIAL_PROVIDER_CANDIDATES.filter((candidate) => inSchema.has(candidate));
}

export type SocialConnection = { id: string; label: string; providerType: string };

export type SocialAvailability = {
  /** True only when a live, authorized connection exists to publish through. */
  canPublish: boolean;
  connections: SocialConnection[];
  /** Why publishing is unavailable. Null when it is available. */
  reason: string | null;
};

/**
 * Resolves what the social entry point may honestly offer.
 *
 * Two distinct "no" answers, because they mean different things to the
 * person reading them: the system has no social integration at all, versus
 * the system has one but this company has not connected an account.
 */
export function resolveSocialAvailability(connections: readonly SocialConnection[]): SocialAvailability {
  if (supportedSocialProviderTypes().length === 0) {
    return {
      canPublish: false,
      connections: [],
      reason:
        "No social platform integration exists in this system yet. The only publishing connection type available today is WordPress, so there is nothing to publish a social post through.",
    };
  }

  if (connections.length === 0) {
    return {
      canPublish: false,
      connections: [],
      reason: "No social account is connected for this client yet. Publishing a social post requires a connected, authorized account.",
    };
  }

  return { canPublish: true, connections: [...connections], reason: null };
}

/**
 * The steps the social workflow will consist of.
 *
 * Described so the user can see where this leads, and deliberately carrying
 * no links or controls — every one of these is a later phase. Listing them
 * is honest; making them look clickable would not be.
 */
export const SOCIAL_WORKFLOW_STEPS = [
  { title: "Select platforms", detail: "Choose which connected accounts the post goes to." },
  { title: "Write the caption", detail: "One caption, with per-platform variations where they differ." },
  { title: "Add media", detail: "Attach the images or video the post needs." },
  { title: "Preview", detail: "See the post as each platform will render it." },
  { title: "Review", detail: "Check it before anything leaves the system." },
  { title: "Schedule or publish", detail: "Send it now, or hold it for the scheduled time." },
] as const;

/**
 * The steps the blog workflow will consist of, beyond the record that this
 * phase can already create.
 */
export const BLOG_WORKFLOW_STEPS = [
  { title: "Content editor", detail: "Write the article, with headings, links, tables and embeds." },
  { title: "Media", detail: "Add images and video to the article." },
  { title: "SEO", detail: "Title, meta description, slug and on-page analysis." },
  { title: "Preview", detail: "Read it as it will appear once published." },
  { title: "Review", detail: "Check it before it goes out." },
  { title: "Schedule or publish", detail: "Publish it, or hold it for the scheduled time." },
] as const;
