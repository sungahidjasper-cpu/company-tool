import { describe, expect, it } from "vitest";

import { buildPressReleaseRequest, computeCanGenerateRelease } from "@/features/ai-workspace/components/PressReleaseGeneratorPicker";

/**
 * This repository has no React component-rendering test setup (no .test.tsx
 * file anywhere, vitest.config.ts runs environment: "node", no
 * testing-library/jsdom installed) — matching every other AI Workspace
 * picker, these tests cover the component's real, non-trivial logic as
 * small, directly-testable pure functions instead.
 */

describe("computeCanGenerateRelease — form completeness", () => {
  it("1. both required fields filled: can generate", () => {
    expect(computeCanGenerateRelease("Acme Launches Product", "Facts about the launch.")).toBe(true);
  });

  it("2. missing headline: cannot generate", () => {
    expect(computeCanGenerateRelease("", "Facts about the launch.")).toBe(false);
  });

  it("3. missing key facts: cannot generate", () => {
    expect(computeCanGenerateRelease("Acme Launches Product", "")).toBe(false);
  });

  it("4. both missing: cannot generate", () => {
    expect(computeCanGenerateRelease("", "")).toBe(false);
  });

  it("5. whitespace-only headline: cannot generate", () => {
    expect(computeCanGenerateRelease("   ", "Facts about the launch.")).toBe(false);
  });

  it("6. whitespace-only key facts: cannot generate", () => {
    expect(computeCanGenerateRelease("Acme Launches Product", "   ")).toBe(false);
  });
});

describe("buildPressReleaseRequest", () => {
  const FULL_FORM = {
    headline: "  Acme Launches Product  ",
    keyFacts: "  Facts about the launch.  ",
    quote: '  "Great news" - Jane Doe  ',
    dateline: "  Austin, TX  ",
    callToAction: "  Visit acme.example.com  ",
    notes: "  Keep it short.  ",
  };

  it("7. trims every field", () => {
    const request = buildPressReleaseRequest("project-1", FULL_FORM);
    expect(request.headline).toBe("Acme Launches Product");
    expect(request.keyFacts).toBe("Facts about the launch.");
    expect(request.quote).toBe('"Great news" - Jane Doe');
    expect(request.dateline).toBe("Austin, TX");
    expect(request.callToAction).toBe("Visit acme.example.com");
    expect(request.notes).toBe("Keep it short.");
  });

  it("8. converts blank optional fields to undefined rather than empty strings", () => {
    const request = buildPressReleaseRequest("project-1", { headline: "H", keyFacts: "F", quote: "", dateline: "   ", callToAction: "", notes: "" });
    expect(request.quote).toBeUndefined();
    expect(request.dateline).toBeUndefined();
    expect(request.callToAction).toBeUndefined();
    expect(request.notes).toBeUndefined();
  });

  it("9. includes the given seoProjectId unchanged", () => {
    const request = buildPressReleaseRequest("project-42", FULL_FORM);
    expect(request.seoProjectId).toBe("project-42");
  });
});
