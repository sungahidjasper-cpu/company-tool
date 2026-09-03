import { describe, expect, it } from "vitest";

import {
  buildPressReleaseRequest,
  computeCanGenerateRelease,
  PRESS_RELEASE_NULL_RESULT_MESSAGE,
} from "@/features/ai-workspace/components/PressReleaseGeneratorPicker";

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

/**
 * Regression coverage for the false-failure investigation: a real user
 * submitted a fully adequate, detailed announcement and got a null result
 * (Gemini's quota was exhausted, forcing fallback to a weak local model
 * whose output correctly failed buildPressReleaseResult's deterministic
 * quality checks) — but the old message ("...from these details. Try
 * adding more announcement facts...") told the user their INPUT was the
 * problem, which was false and misleading. This message must never imply
 * insufficient input, missing facts, or "add more information" as the fix.
 */
describe("PRESS_RELEASE_NULL_RESULT_MESSAGE — null-result wording", () => {
  it("10. does not imply the announcement details were insufficient", () => {
    expect(PRESS_RELEASE_NULL_RESULT_MESSAGE).not.toMatch(/insufficient/i);
    expect(PRESS_RELEASE_NULL_RESULT_MESSAGE).not.toMatch(/these details/i);
  });

  it("11. does not imply facts are missing", () => {
    expect(PRESS_RELEASE_NULL_RESULT_MESSAGE).not.toMatch(/missing/i);
    expect(PRESS_RELEASE_NULL_RESULT_MESSAGE).not.toMatch(/\bfacts\b/i);
  });

  it("12. does not suggest adding more information as the solution", () => {
    expect(PRESS_RELEASE_NULL_RESULT_MESSAGE).not.toMatch(/add(ing)?\s+more/i);
    expect(PRESS_RELEASE_NULL_RESULT_MESSAGE).not.toMatch(/more\s+information/i);
  });

  it("13. displays the approved quality-oriented message", () => {
    expect(PRESS_RELEASE_NULL_RESULT_MESSAGE).toBe("The AI response didn't meet our quality requirements this time. Please try generating again.");
  });
});
