import { describe, expect, it } from "vitest";

import { computeOmittedContent, computeSelectAllCapped, computeSelectionAfterToggle } from "@/features/ai-workspace/components/MetaTagOptimizerPicker";

/**
 * This repository has no React component-rendering test setup anywhere
 * (no .test.tsx file exists in the whole codebase, vitest.config.ts runs
 * environment: "node", and no testing-library/jsdom dependency is
 * installed) — adding one would violate this stage's own "do not add
 * dependencies just for testing" instruction. These tests instead cover
 * the component's real, non-trivial logic — selection-limit enforcement
 * and partial-result safety — as pure, directly-testable functions,
 * matching this codebase's own established pattern of extracting logic
 * into small pure functions (e.g. every AI Workspace service's own
 * filterValidX functions). UI rendering/interaction itself is covered by
 * live verification against the real running app, the same way every
 * other AI Workspace tool's UI has been verified in this project.
 */

describe("computeSelectionAfterToggle", () => {
  it("1. adds an id when checked and under the limit", () => {
    const result = computeSelectionAfterToggle(new Set(["a"]), "b", true, 3);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("2. removes an id when unchecked", () => {
    const result = computeSelectionAfterToggle(new Set(["a", "b"]), "b", false, 3);
    expect(result).toEqual(new Set(["a"]));
  });

  it("3. enforces the maximum: returns the SAME set instance, unchanged, when checking a new id would exceed the limit", () => {
    const current = new Set(["a", "b"]);
    const result = computeSelectionAfterToggle(current, "c", true, 2);
    expect(result).toBe(current);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("4. allows re-checking an id already selected even when the set is at the limit (a no-op toggle, not a new addition)", () => {
    const current = new Set(["a", "b"]);
    const result = computeSelectionAfterToggle(current, "a", true, 2);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("5. allows unchecking even when the set is at or over the limit", () => {
    const current = new Set(["a", "b"]);
    const result = computeSelectionAfterToggle(current, "a", false, 2);
    expect(result).toEqual(new Set(["b"]));
  });

  it("does not mutate the input set", () => {
    const current = new Set(["a"]);
    computeSelectionAfterToggle(current, "b", true, 5);
    expect(current).toEqual(new Set(["a"]));
  });
});

describe("computeSelectAllCapped", () => {
  it("6. selects every id when the list is at or under the limit", () => {
    expect(computeSelectAllCapped(["a", "b", "c"], 50)).toEqual(["a", "b", "c"]);
  });

  it("6b. caps at the limit when the list exceeds it, keeping only the first N", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);
    const result = computeSelectAllCapped(ids, 50);
    expect(result).toHaveLength(50);
    expect(result).toEqual(ids.slice(0, 50));
  });

  it("returns an empty array unchanged for an empty list", () => {
    expect(computeSelectAllCapped([], 50)).toEqual([]);
  });
});

describe("computeOmittedContent", () => {
  const CONTENT = [
    { id: "a", title: "Page A" },
    { id: "b", title: "Page B" },
    { id: "c", title: "Page C" },
    { id: "d", title: "Page D" },
  ];

  it("14/15. lists selected pages with no returned suggestion, without fabricating a placeholder result for them", () => {
    // Selected: A, B, C, D. Suggestions returned only for A and C.
    const selected = new Set(["a", "b", "c", "d"]);
    const suggestions = [{ contentId: "a" }, { contentId: "c" }];
    const omitted = computeOmittedContent(CONTENT, selected, suggestions);
    expect(omitted.map((c) => c.id)).toEqual(["b", "d"]);
  });

  it("returns an empty array when every selected page received a suggestion", () => {
    const selected = new Set(["a", "b"]);
    const suggestions = [{ contentId: "a" }, { contentId: "b" }];
    expect(computeOmittedContent(CONTENT, selected, suggestions)).toEqual([]);
  });

  it("never includes a page that was not selected, even if it's also missing a suggestion", () => {
    const selected = new Set(["a"]);
    const suggestions: { contentId: string }[] = [];
    const omitted = computeOmittedContent(CONTENT, selected, suggestions);
    expect(omitted.map((c) => c.id)).toEqual(["a"]);
  });

  it("returns an empty array when nothing is selected", () => {
    expect(computeOmittedContent(CONTENT, new Set(), [])).toEqual([]);
  });
});
