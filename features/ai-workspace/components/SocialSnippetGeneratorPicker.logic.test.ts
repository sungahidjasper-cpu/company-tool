import { describe, expect, it } from "vitest";

import { computeMissingPlatforms } from "@/features/ai-workspace/components/SocialSnippetGeneratorPicker";

/**
 * Phase B B3.2 — the service's filterValidSnippets is authoritative and
 * unchanged (TWITTER→X normalization, fabricated-URL rejection, character
 * limits, first-valid-per-platform deduplication). That correctly means a
 * requested platform can produce nothing. These cover only the reporting of
 * that difference, so a partial result is never presented as a complete one.
 */
describe("computeMissingPlatforms", () => {
  it("1. complete result — every requested platform produced a snippet", () => {
    const missing = computeMissingPlatforms(["X", "LINKEDIN", "FACEBOOK"], [{ platform: "X" }, { platform: "LINKEDIN" }, { platform: "FACEBOOK" }]);
    expect(missing).toEqual([]);
  });

  it("2. partial result — reports exactly the platforms that produced nothing", () => {
    const missing = computeMissingPlatforms(["X", "LINKEDIN", "FACEBOOK"], [{ platform: "X" }]);
    expect(missing).toEqual(["LINKEDIN", "FACEBOOK"]);
  });

  it("3. completely unusable result — every requested platform is reported missing", () => {
    expect(computeMissingPlatforms(["X", "LINKEDIN"], [])).toEqual(["X", "LINKEDIN"]);
  });

  it("4. preserves the requested order rather than the returned order", () => {
    expect(computeMissingPlatforms(["X", "LINKEDIN", "FACEBOOK"], [{ platform: "FACEBOOK" }])).toEqual(["X", "LINKEDIN"]);
  });

  it("5. a platform that was never requested is not reported as missing (deduplicated extras are ignored)", () => {
    expect(computeMissingPlatforms(["X"], [{ platform: "X" }, { platform: "LINKEDIN" }])).toEqual([]);
  });

  it("6. duplicate snippets for one platform still satisfy that platform exactly once", () => {
    expect(computeMissingPlatforms(["X", "LINKEDIN"], [{ platform: "X" }, { platform: "X" }])).toEqual(["LINKEDIN"]);
  });

  it("7. no requested platforms yields nothing missing (never invents a platform)", () => {
    expect(computeMissingPlatforms([], [])).toEqual([]);
  });
});
