/**
 * Phase 7 — the one place a social platform is defined.
 *
 * Every screen that shows a platform — client settings, the composer's
 * account chips, the platform tabs, the preview header, Content Detail —
 * reads its identity from here. Adding a platform later means adding one
 * entry to this table and nothing else; that is the whole point.
 *
 * The caption limits and labels are NOT redefined here. They live in
 * social-composer.ts, which the validation and character-count logic already
 * use, and are re-read below so the two can never disagree.
 *
 * ON LOGOS — read before "fixing" this
 * ------------------------------------
 * These are brand COLOURS and monograms, not the platforms' logos. This
 * project has no icon library with brand marks (lucide dropped them; its `X`
 * export is the close icon) and no local logo assets, and drawing or
 * generating a company's trademark is not something to do by hand. So each
 * platform gets a distinct, recognisable coloured mark and its real name,
 * which is honest about being Cloud Compass's own rendering.
 *
 * When a licensed logo set is added, only `PLATFORM_REGISTRY` and
 * `PlatformMark` need to change — nothing that consumes them does.
 */

import { PLATFORM_CAPTION_LIMITS, SOCIAL_PLATFORM_LABELS } from "@/features/social/services/social-composer";
import { SocialPlatform } from "@/lib/generated/prisma/enums";

/** What a platform's media slot can hold, so a future tab can say what it accepts. */
export type PlatformMediaKind = "IMAGE" | "VIDEO";

export type PlatformDefinition = {
  id: SocialPlatform;
  /** The platform's own name, from the shared label map. */
  name: string;
  /** What one account on this platform is called, e.g. "Page", "Profile", "Channel". */
  accountNoun: string;
  /** The platform's brand colour, used for its mark. Not a logo. */
  brandColor: string;
  /** Readable contrast partner for brandColor. */
  markForeground: string;
  /** One or two characters standing in for the logo. */
  monogram: string;
  /** The documented caption maximum, read from the shared limits table. */
  captionLimit: number;
  supportedMedia: readonly PlatformMediaKind[];
  /** Whether an outbound link is meaningful in a post on this platform. */
  supportsLink: boolean;
  /** A hint for the handle field in settings, so the form asks for the right thing. */
  handlePlaceholder: string;
};

/**
 * Order matters only for display. Every entry is a platform the SCHEMA knows
 * about — availability for a given client still comes from SocialAccount rows,
 * never from this list.
 */
const DEFINITIONS: Record<SocialPlatform, Omit<PlatformDefinition, "id" | "name" | "captionLimit">> = {
  FACEBOOK: { accountNoun: "Page", brandColor: "#1877F2", markForeground: "#FFFFFF", monogram: "f", supportedMedia: ["IMAGE", "VIDEO"], supportsLink: true, handlePlaceholder: "storagemoguls" },
  INSTAGRAM: { accountNoun: "Profile", brandColor: "#C13584", markForeground: "#FFFFFF", monogram: "ig", supportedMedia: ["IMAGE", "VIDEO"], supportsLink: false, handlePlaceholder: "@storagemoguls" },
  LINKEDIN: { accountNoun: "Page", brandColor: "#0A66C2", markForeground: "#FFFFFF", monogram: "in", supportedMedia: ["IMAGE", "VIDEO"], supportsLink: true, handlePlaceholder: "storage-moguls" },
  X: { accountNoun: "Profile", brandColor: "#0F1419", markForeground: "#FFFFFF", monogram: "X", supportedMedia: ["IMAGE", "VIDEO"], supportsLink: true, handlePlaceholder: "@storagemoguls" },
  TIKTOK: { accountNoun: "Account", brandColor: "#010101", markForeground: "#FFFFFF", monogram: "tt", supportedMedia: ["VIDEO"], supportsLink: false, handlePlaceholder: "@storagemoguls" },
  PINTEREST: { accountNoun: "Profile", brandColor: "#E60023", markForeground: "#FFFFFF", monogram: "P", supportedMedia: ["IMAGE"], supportsLink: true, handlePlaceholder: "storagemoguls" },
  YOUTUBE: { accountNoun: "Channel", brandColor: "#FF0000", markForeground: "#FFFFFF", monogram: "yt", supportedMedia: ["VIDEO"], supportsLink: true, handlePlaceholder: "@storagemoguls" },
  GOOGLE_BUSINESS_PROFILE: { accountNoun: "Location", brandColor: "#4285F4", markForeground: "#FFFFFF", monogram: "G", supportedMedia: ["IMAGE"], supportsLink: true, handlePlaceholder: "Storage Moguls — Reno" },
};

export const PLATFORM_REGISTRY: Record<SocialPlatform, PlatformDefinition> = Object.fromEntries(
  (Object.keys(DEFINITIONS) as SocialPlatform[]).map((id) => [
    id,
    { id, name: SOCIAL_PLATFORM_LABELS[id], captionLimit: PLATFORM_CAPTION_LIMITS[id], ...DEFINITIONS[id] },
  ])
) as Record<SocialPlatform, PlatformDefinition>;

/** Every platform the schema supports, in display order. */
export const ALL_PLATFORMS: readonly SocialPlatform[] = Object.values(SocialPlatform) as SocialPlatform[];

export function platformDefinition(platform: SocialPlatform): PlatformDefinition {
  return PLATFORM_REGISTRY[platform];
}

/**
 * How one account should read in a list: its page/profile name when it has
 * one, then its handle. Never invents a name it was not given.
 */
export function describeAccount(account: { displayName?: string | null; handle: string; platform: SocialPlatform }): {
  primary: string;
  secondary: string | null;
} {
  const name = account.displayName?.trim();
  if (name) return { primary: name, secondary: account.handle };
  return { primary: account.handle, secondary: null };
}

/**
 * What a platform tab may offer.
 *
 * Deliberately narrow: caption always, link only where a link is meaningful,
 * and media kinds the platform actually takes. Anything beyond this is a
 * later phase, and a tab must not imply otherwise.
 */
export function platformCapabilities(platform: SocialPlatform): {
  caption: true;
  link: boolean;
  media: readonly PlatformMediaKind[];
  captionLimit: number;
} {
  const definition = platformDefinition(platform);
  return { caption: true, link: definition.supportsLink, media: definition.supportedMedia, captionLimit: definition.captionLimit };
}
