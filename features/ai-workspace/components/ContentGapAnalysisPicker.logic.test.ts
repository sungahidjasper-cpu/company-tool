import { describe, expect, it } from "vitest";

import { computeCanGenerateGapAnalysis } from "@/features/ai-workspace/components/ContentGapAnalysisPicker";

/**
 * This repository has no React component-rendering test setup (no .test.tsx
 * file anywhere, vitest.config.ts runs environment: "node", no
 * testing-library/jsdom installed) — matching every other AI Workspace
 * picker, this test covers the component's real, non-trivial logic as a
 * small, directly-testable pure function instead.
 */

describe("computeCanGenerateGapAnalysis", () => {
  it("1. a selected SEO project id: can generate", () => {
    expect(computeCanGenerateGapAnalysis("project-1")).toBe(true);
  });

  it("2. no SEO project selected: cannot generate", () => {
    expect(computeCanGenerateGapAnalysis("")).toBe(false);
  });

  it("3. whitespace-only value: cannot generate", () => {
    expect(computeCanGenerateGapAnalysis("   ")).toBe(false);
  });
});
