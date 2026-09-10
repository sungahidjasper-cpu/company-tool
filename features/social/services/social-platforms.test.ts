import { describe, expect, it } from "vitest";

import {
  ALL_PLATFORMS,
  PLATFORM_REGISTRY,
  describeAccount,
  platformCapabilities,
  platformDefinition,
} from "@/features/social/services/social-platforms";
import { PLATFORM_CAPTION_LIMITS, SOCIAL_PLATFORM_LABELS } from "@/features/social/services/social-composer";
import { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * The registry's whole promise is that a new platform is ONE entry and
 * nothing else. These tests hold it to that: every platform the schema knows
 * is defined, no definition contradicts the shared label/limit tables, and
 * nothing that renders a platform has to special-case one.
 */
describe("the registry covers every platform the schema can store", () => {
  it("1. every SocialPlatform enum value has a definition", () => {
    for (const platform of Object.values(SocialPlatform)) {
      expect(PLATFORM_REGISTRY[platform], `${platform} is missing from the registry`).toBeDefined();
    }
    expect(ALL_PLATFORMS).toHaveLength(Object.values(SocialPlatform).length);
  });

  it("2. a definition never invents its own name or caption limit", () => {
    for (const platform of ALL_PLATFORMS) {
      const definition = platformDefinition(platform);
      expect(definition.name).toBe(SOCIAL_PLATFORM_LABELS[platform]);
      expect(definition.captionLimit).toBe(PLATFORM_CAPTION_LIMITS[platform]);
    }
  });

  it("3. every platform carries a complete visual identity", () => {
    for (const platform of ALL_PLATFORMS) {
      const definition = platformDefinition(platform);
      expect(definition.brandColor).toMatch(/^#[0-9A-F]{6}$/i);
      expect(definition.markForeground).toMatch(/^#[0-9A-F]{6}$/i);
      expect(definition.monogram.length).toBeGreaterThan(0);
      expect(definition.monogram.length).toBeLessThanOrEqual(2);
      expect(definition.accountNoun.length).toBeGreaterThan(0);
      expect(definition.handlePlaceholder.length).toBeGreaterThan(0);
    }
  });

  it("4. platforms are visually distinguishable from one another", () => {
    const marks = ALL_PLATFORMS.map((platform) => `${platformDefinition(platform).brandColor}/${platformDefinition(platform).monogram}`);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it("5. every platform accepts at least one kind of media", () => {
    for (const platform of ALL_PLATFORMS) {
      expect(platformDefinition(platform).supportedMedia.length).toBeGreaterThan(0);
    }
  });
});

describe("capabilities are read from the registry, never assumed", () => {
  it("6. a caption is always offered — that is the one universal", () => {
    for (const platform of ALL_PLATFORMS) {
      expect(platformCapabilities(platform).caption).toBe(true);
    }
  });

  it("7. a link is offered only where a post can actually carry one", () => {
    expect(platformCapabilities("INSTAGRAM").link).toBe(false);
    expect(platformCapabilities("TIKTOK").link).toBe(false);
    expect(platformCapabilities("LINKEDIN").link).toBe(true);
    expect(platformCapabilities("FACEBOOK").link).toBe(true);
  });

  it("8. the caption limit a tab shows is that platform's own", () => {
    expect(platformCapabilities("X").captionLimit).toBe(280);
    expect(platformCapabilities("INSTAGRAM").captionLimit).toBe(2200);
    expect(platformCapabilities("LINKEDIN").captionLimit).toBe(3000);
  });

  it("9. TikTok and YouTube take video, Pinterest and Google Business take images", () => {
    expect(platformCapabilities("TIKTOK").media).toEqual(["VIDEO"]);
    expect(platformCapabilities("YOUTUBE").media).toEqual(["VIDEO"]);
    expect(platformCapabilities("PINTEREST").media).toEqual(["IMAGE"]);
    expect(platformCapabilities("GOOGLE_BUSINESS_PROFILE").media).toEqual(["IMAGE"]);
  });
});

describe("an account is described from what it actually has", () => {
  it("10. a page name leads, with the handle beneath it", () => {
    expect(describeAccount({ platform: "FACEBOOK", handle: "storagemoguls", displayName: "Storage Moguls" })).toEqual({
      primary: "Storage Moguls",
      secondary: "storagemoguls",
    });
  });

  it("11. with no name the handle stands alone — nothing is invented", () => {
    expect(describeAccount({ platform: "X", handle: "@storagemoguls", displayName: null })).toEqual({
      primary: "@storagemoguls",
      secondary: null,
    });
  });

  it("12. a whitespace-only name counts as no name", () => {
    expect(describeAccount({ platform: "X", handle: "@sm", displayName: "   " }).primary).toBe("@sm");
  });
});
