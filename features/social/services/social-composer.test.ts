import { describe, expect, it } from "vitest";

import {
  DRAFT_NOTE,
  HASHTAG_ADVISORY_THRESHOLD,
  MAX_POST_TITLE_LENGTH,
  deriveSocialPostTitle,
  PLATFORM_CAPTION_LIMITS,
  SCHEDULED_IN_APP_NOTE,
  SOCIAL_PLATFORM_LABELS,
  bindingCaptionLimit,
  buildPreview,
  extractHashtags,
  hasMalformedHashtag,
  measureCaption,
  effectiveCaption,
  effectiveLink,
  inheritingPlatforms,
  validateComposerDraft,
  validateTargets,
  type ComposerDraft,
  type TargetDraft,
} from "@/features/social/services/social-composer";

const draft = (over: Partial<ComposerDraft> = {}): ComposerDraft => ({
  caption: "Three things to check before buying a facility. #selfstorage #investing",
  link: "",
  accountIds: [],
  ...over,
});

describe("caption limits bind to the platforms actually selected", () => {
  it("1. the strictest selected platform is the one that binds", () => {
    expect(bindingCaptionLimit(["FACEBOOK", "X", "LINKEDIN"])).toEqual({ limit: 280, platform: "X" });
    expect(bindingCaptionLimit(["FACEBOOK", "LINKEDIN"])).toEqual({ limit: 3000, platform: "LINKEDIN" });
  });

  it("2. with NO platform selected nothing binds — no limit is invented", () => {
    expect(bindingCaptionLimit([])).toBeNull();
    const measurement = measureCaption("Some caption", []);
    expect(measurement.limit).toBeNull();
    expect(measurement.remaining).toBeNull();
    expect(measurement.overLimit).toBe(false);
  });

  it("3. reports characters remaining against the binding limit", () => {
    const measurement = measureCaption("a".repeat(100), ["X"]);
    expect(measurement.characters).toBe(100);
    expect(measurement.limit).toBe(280);
    expect(measurement.remaining).toBe(180);
    expect(measurement.overLimit).toBe(false);
  });

  it("4. flags a caption past the binding limit", () => {
    const measurement = measureCaption("a".repeat(281), ["X", "FACEBOOK"]);
    expect(measurement.overLimit).toBe(true);
    expect(measurement.remaining).toBe(-1);
    expect(measurement.limitPlatform).toBe("X");
  });

  it("5. counts characters by code point, so an emoji is one character", () => {
    expect(measureCaption("🎉🎉🎉", ["X"]).characters).toBe(3);
  });

  it("6. every platform has a label and a limit", () => {
    for (const platform of Object.keys(SOCIAL_PLATFORM_LABELS) as (keyof typeof SOCIAL_PLATFORM_LABELS)[]) {
      expect(SOCIAL_PLATFORM_LABELS[platform].length).toBeGreaterThan(0);
      expect(PLATFORM_CAPTION_LIMITS[platform]).toBeGreaterThan(0);
    }
  });
});

describe("hashtags live in the caption", () => {
  it("7. reads hashtags back out of the caption", () => {
    expect(extractHashtags("Check this #selfstorage and #investing today")).toEqual(["#selfstorage", "#investing"]);
  });

  it("8. de-duplicates case-insensitively, keeping what was typed first", () => {
    expect(extractHashtags("#SelfStorage and #selfstorage")).toEqual(["#SelfStorage"]);
  });

  it("9. handles none, and does not treat a bare # as one", () => {
    expect(extractHashtags("No tags here")).toEqual([]);
    expect(extractHashtags("A # on its own")).toEqual([]);
  });

  it("10. supports digits, underscores and non-Latin scripts", () => {
    expect(extractHashtags("#storage2026 #self_storage #自助倉")).toEqual(["#storage2026", "#self_storage", "#自助倉"]);
  });

  it("11. flags a bare '#' as malformed", () => {
    expect(hasMalformedHashtag("A # on its own")).toBe(true);
    expect(hasMalformedHashtag("#proper tags only")).toBe(false);
  });

  it("12. hashtags count toward the character total, because they do on the platform", () => {
    const withTags = measureCaption("Buy well #selfstorage", ["X"]);
    const without = measureCaption("Buy well", ["X"]);
    expect(withTags.characters).toBeGreaterThan(without.characters);
  });

  it("13. advises against stuffing without blocking it", () => {
    const many = Array.from({ length: HASHTAG_ADVISORY_THRESHOLD + 1 }, (_, i) => `#tag${i}`).join(" ");
    const measurement = measureCaption(many, []);
    expect(measurement.advisory).toMatch(/hashtags is a lot/i);
    expect(validateComposerDraft(draft({ caption: many }), []).ok).toBe(true);
  });

  it("14. says nothing when the count is reasonable", () => {
    expect(measureCaption("#one #two #three", []).advisory).toBeNull();
  });
});

describe("validation", () => {
  it("15. accepts a complete, reasonable draft", () => {
    expect(validateComposerDraft(draft(), []).ok).toBe(true);
  });

  it("16. no internal name is asked for — a draft is valid without one", () => {
    // The field was removed from the composer: naming a database record is
    // not something a person writing a post should be asked to do.
    expect(validateComposerDraft({ caption: "Just a caption.", link: "", accountIds: [] }, []).ok).toBe(true);
  });

  it("18. requires a caption — a post with nothing to say cannot be saved", () => {
    for (const caption of ["", "   ", "\n\n"]) {
      const result = validateComposerDraft(draft({ caption }), []);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.field).toBe("caption");
    }
  });

  it("19. refuses a caption past the binding platform's limit, naming the platform", () => {
    const result = validateComposerDraft(draft({ caption: "a".repeat(300) }), ["X"]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/X allows 280 characters/);
  });

  it("20. the SAME caption is fine when no platform binds it", () => {
    expect(validateComposerDraft(draft({ caption: "a".repeat(300) }), []).ok).toBe(true);
    expect(validateComposerDraft(draft({ caption: "a".repeat(300) }), ["FACEBOOK"]).ok).toBe(true);
  });

  it("21. refuses a malformed hashtag", () => {
    const result = validateComposerDraft(draft({ caption: "Look at this # thing" }), []);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/needs a word after it/i);
  });

  it("22. an absent link is fine; a malformed one is not", () => {
    expect(validateComposerDraft(draft({ link: "" }), []).ok).toBe(true);
    expect(validateComposerDraft(draft({ link: "   " }), []).ok).toBe(true);
    for (const link of ["example.com", "javascript:alert(1)", "ftp://example.com", "//example.com", "not a url"]) {
      const result = validateComposerDraft(draft({ link }), []);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.field).toBe("link");
    }
  });

  it("23. accepts a real http(s) link", () => {
    for (const link of ["https://example.com/post", "http://example.com"]) {
      expect(validateComposerDraft(draft({ link }), []).ok).toBe(true);
    }
  });

  it("24. never returns an instruction to publish anything", () => {
    const result = validateComposerDraft(draft(), ["X"]);
    expect(Object.keys(result)).not.toContain("publish");
  });
});

describe("preview", () => {
  it("25. with no connected account the preview is explicitly GENERIC", () => {
    const preview = buildPreview({ caption: "Hello #world", link: "", scheduleLabel: null, account: null });
    expect(preview.generic).toBe(true);
    expect(preview.accountLabel).toBe("Social post");
    expect(preview.handle).toBeNull();
  });

  it("26. it never names a platform it has no account for", () => {
    const preview = buildPreview({ caption: "Hello", link: "", scheduleLabel: null, account: null });
    for (const label of Object.values(SOCIAL_PLATFORM_LABELS)) {
      expect(preview.accountLabel).not.toBe(label);
    }
  });

  it("27. with a real account it shows that account's platform and handle", () => {
    const preview = buildPreview({ caption: "Hello", link: "", scheduleLabel: null, account: { platform: "LINKEDIN", handle: "@acme" } });
    expect(preview.generic).toBe(false);
    expect(preview.accountLabel).toBe("LinkedIn");
    expect(preview.handle).toBe("@acme");
  });

  it("28. reflects caption, hashtags, link and the intended time", () => {
    const preview = buildPreview({
      caption: "Three tips #selfstorage",
      link: "https://example.com/post",
      scheduleLabel: "11 Sep 2026 at 09:00 (Asia/Singapore)",
      account: null,
    });
    expect(preview.caption).toBe("Three tips #selfstorage");
    expect(preview.hashtags).toEqual(["#selfstorage"]);
    expect(preview.link).toBe("https://example.com/post");
    expect(preview.scheduleLabel).toBe("11 Sep 2026 at 09:00 (Asia/Singapore)");
  });

  it("29. omits a link that was not supplied rather than inventing one", () => {
    expect(buildPreview({ caption: "x", link: "   ", scheduleLabel: null, account: null }).link).toBeNull();
  });
});

describe("what the saved states honestly mean", () => {
  it("30. scheduling is described as scheduled IN Cloud Compass, not published", () => {
    expect(SCHEDULED_IN_APP_NOTE).toMatch(/Scheduled in Cloud Compass/i);
    expect(SCHEDULED_IN_APP_NOTE).toMatch(/does not send the post to any social platform/i);
  });

  it("31. the draft note claims neither a schedule nor a publication", () => {
    expect(DRAFT_NOTE).toMatch(/nothing is scheduled and nothing is published/i);
  });

  it("32. neither note promises a platform integration", () => {
    for (const note of [SCHEDULED_IN_APP_NOTE, DRAFT_NOTE]) {
      expect(note).not.toMatch(/will be posted|we will publish|coming soon/i);
    }
  });
});

/* ------------------------------------------- per-platform customization */

const target = (over: Partial<TargetDraft> = {}): TargetDraft => ({
  accountId: "account-1",
  platform: "X",
  label: "@storagemoguls",
  caption: null,
  link: null,
  ...over,
});

describe("a target either follows the shared caption or replaces it", () => {
  it("36. null inherits the shared caption, now and later", () => {
    expect(effectiveCaption("Shared text", target())).toBe("Shared text");
    expect(effectiveLink("https://shared.example.com", target())).toBe("https://shared.example.com");
  });

  it("37. a string is this account's own, whatever the shared caption says", () => {
    expect(effectiveCaption("Shared text", target({ caption: "Just for X" }))).toBe("Just for X");
    expect(effectiveLink("https://shared.example.com", target({ link: "https://x.example.com" }))).toBe("https://x.example.com");
  });

  it("38. an empty string is a customization, not inheritance — the distinction is null", () => {
    expect(effectiveCaption("Shared text", target({ caption: "" }))).toBe("");
  });
});

describe("customizing one platform frees the shared caption from its limit", () => {
  it("39. an inheriting X account still caps the shared caption at 280", () => {
    const targets = [target({ platform: "X" }), target({ accountId: "account-2", platform: "LINKEDIN" })];
    expect(inheritingPlatforms(targets)).toEqual(["X", "LINKEDIN"]);
    expect(bindingCaptionLimit(inheritingPlatforms(targets))).toEqual({ limit: 280, platform: "X" });
  });

  it("40. give X its own caption and LinkedIn's 3000 becomes the binding limit", () => {
    const targets = [target({ platform: "X", caption: "Short for X" }), target({ accountId: "account-2", platform: "LINKEDIN" })];
    expect(inheritingPlatforms(targets)).toEqual(["LINKEDIN"]);
    expect(bindingCaptionLimit(inheritingPlatforms(targets))).toEqual({ limit: 3000, platform: "LINKEDIN" });
  });

  it("41. when every account is customized, nothing binds the shared caption", () => {
    const targets = [target({ platform: "X", caption: "a" }), target({ accountId: "account-2", platform: "INSTAGRAM", caption: "b" })];
    expect(inheritingPlatforms(targets)).toEqual([]);
    expect(bindingCaptionLimit(inheritingPlatforms(targets))).toBeNull();
  });
});

describe("each target is judged against its own platform, and only its own", () => {
  it("42. targets with no customization are always valid", () => {
    expect(validateTargets([target(), target({ accountId: "account-2", platform: "INSTAGRAM" })])).toEqual({ ok: true });
  });

  it("43. an over-long X caption is refused, naming X and the account", () => {
    const result = validateTargets([target({ caption: "a".repeat(281) })]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.accountId).toBe("account-1");
    expect(!result.ok && result.field).toBe("caption");
    expect(!result.ok && result.error).toMatch(/X allows 280 characters/);
    expect(!result.ok && result.error).toMatch(/@storagemoguls/);
  });

  it("44. THE CORE ISOLATION RULE: a bad LinkedIn caption never invalidates Instagram", () => {
    const instagram = target({ accountId: "instagram-1", platform: "INSTAGRAM", label: "@sm", caption: "Perfectly fine for Instagram." });
    expect(validateTargets([instagram])).toEqual({ ok: true });

    const linkedin = target({ accountId: "linkedin-1", platform: "LINKEDIN", label: "Storage Moguls", caption: "a".repeat(3001) });
    const result = validateTargets([instagram, linkedin]);
    expect(result.ok).toBe(false);
    // The failure is attributed to LinkedIn, and Instagram's own caption is
    // unchanged and still valid on its own.
    expect(!result.ok && result.accountId).toBe("linkedin-1");
    expect(validateTargets([instagram])).toEqual({ ok: true });
  });

  it("45. a caption that is 280 for X would be fine for Instagram — the platform decides", () => {
    const long = "a".repeat(1000);
    expect(validateTargets([target({ platform: "X", caption: long })]).ok).toBe(false);
    expect(validateTargets([target({ platform: "INSTAGRAM", caption: long })]).ok).toBe(true);
  });

  it("46. a customized caption cannot be blank — reset it instead", () => {
    const result = validateTargets([target({ caption: "   " })]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/reset it to the shared caption/);
  });

  it("47. a bare '#' is caught per platform too", () => {
    const result = validateTargets([target({ caption: "Nice one # " })]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/needs a word after it/);
  });

  it("48. a per-platform link must still be a full http(s) address", () => {
    const result = validateTargets([target({ link: "javascript:alert(1)" })]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("link");
  });

  it("49. an empty per-platform link is allowed — it means 'no link here'", () => {
    expect(validateTargets([target({ link: "" })])).toEqual({ ok: true });
  });
});

/* --------------------------------------------- the record names itself */

describe("a social post names its own record, so nobody has to", () => {
  const NOW = new Date("2026-09-11T10:00:00.000Z");

  it("50. the name is the caption's first line", () => {
    expect(deriveSocialPostTitle("Three things to check before buying a facility.", NOW)).toBe(
      "Three things to check before buying a facility."
    );
  });

  it("51. only the first non-empty line is used", () => {
    expect(deriveSocialPostTitle("\n\nOpening line.\nSecond line that should not appear.", NOW)).toBe("Opening line.");
  });

  it("52. hashtags are dropped — they are the message, not a description of it", () => {
    expect(deriveSocialPostTitle("Storage tips for autumn #selfstorage #investing", NOW)).toBe("Storage tips for autumn");
  });

  it("53. a caption of nothing but hashtags still gets a usable name", () => {
    expect(deriveSocialPostTitle("#selfstorage #investing", NOW)).toBe("#selfstorage #investing");
  });

  it("54. a long caption is truncated to the column's limit, never beyond it", () => {
    const name = deriveSocialPostTitle("a".repeat(400), NOW);
    expect([...name].length).toBe(MAX_POST_TITLE_LENGTH);
    expect(name.endsWith("…")).toBe(true);
  });

  it("55. an empty caption falls back to a dated name rather than an empty column", () => {
    expect(deriveSocialPostTitle("", NOW)).toBe("Social post — 2026-09-11");
    expect(deriveSocialPostTitle("   \n  ", NOW)).toBe("Social post — 2026-09-11");
  });

  it("56. it is pure — the caller supplies the clock, so a render never depends on it", () => {
    const other = new Date("2027-01-02T00:00:00.000Z");
    expect(deriveSocialPostTitle("", other)).toBe("Social post — 2027-01-02");
    expect(deriveSocialPostTitle("Same caption", NOW)).toBe(deriveSocialPostTitle("Same caption", other));
  });

  it("57. the derived name always fits the column, whatever the caption", () => {
    for (const caption of ["", "#a", "x".repeat(5000), "Line\nLine\nLine", "  padded  "]) {
      expect([...deriveSocialPostTitle(caption, NOW)].length).toBeLessThanOrEqual(MAX_POST_TITLE_LENGTH);
    }
  });
});
