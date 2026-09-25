import { describe, expect, it } from "vitest";

import { computeCanGenerate } from "@/features/ai-workspace/components/ContentRewriterPicker";
import { contentRewriterJobResultSchema } from "@/features/ai-workspace/schemas/content-rewriter.schema";

/**
 * This repository has no React component-rendering test setup (no .test.tsx
 * file anywhere, vitest.config.ts runs environment: "node", no
 * testing-library/jsdom installed) — matching every other AI Workspace
 * picker, these tests cover the component's real, non-trivial logic as
 * small, directly-testable pure functions instead. UI rendering/interaction
 * itself is covered by live verification against the real running app.
 */

describe("computeCanGenerate — selection cannot choose ineligible content", () => {
  it("1. eligible: a selected id that IS in the eligible list can generate", () => {
    expect(computeCanGenerate("content-1", ["content-1", "content-2"])).toBe(true);
  });

  it("2. no selection: nothing selected yet cannot generate", () => {
    expect(computeCanGenerate(null, ["content-1", "content-2"])).toBe(false);
  });

  it("3. stale selection: a selected id that is NOT in the eligible list (e.g. left over from switching projects) cannot generate", () => {
    expect(computeCanGenerate("content-from-other-project", ["content-1", "content-2"])).toBe(false);
  });

  it("4. empty eligible list: nothing can ever generate, even with a non-null selection", () => {
    expect(computeCanGenerate("content-1", [])).toBe(false);
  });
});

/**
 * Phase C4.2 — arriving from a Content record's "Rewrite Content" action.
 *
 * The route resolves the requested ids against its own company-scoped,
 * body-bearing list (resolveContentOptimizerSelection) and seeds the picker's
 * initial state from the result. These tests pin the seam between the two:
 * whatever the resolver hands over must still pass the picker's own
 * eligibility gate, and a dropped hand-off must leave the picker in exactly
 * the state a direct visit produces.
 */
describe("preselection hand-off — a seeded selection is subject to the same gate", () => {
  const ELIGIBLE = ["content-1", "content-2"];

  it("10. a resolved hand-off lands generate-ready — no re-selection needed", () => {
    // resolveContentOptimizerSelection returned { contentIds: ["content-1"] }.
    expect(computeCanGenerate("content-1", ELIGIBLE)).toBe(true);
  });

  it("11. a DROPPED hand-off (foreign/trashed/body-less id) seeds null and cannot generate — identical to a direct visit", () => {
    // resolveContentOptimizerSelection returned { contentIds: [] }; the route
    // passes `contentIds[0] ?? null`, so the picker starts unselected.
    expect(computeCanGenerate(null, ELIGIBLE)).toBe(false);
  });

  it("12. the hand-off cannot smuggle in an ineligible id — the gate re-checks it against the route's own list", () => {
    expect(computeCanGenerate("content-from-another-company", ELIGIBLE)).toBe(false);
  });
});

/**
 * The picker's applyResult() calls contentRewriterJobResultSchema.safeParse
 * on whatever resultJson a job returns — these tests exercise that same
 * schema directly, covering exactly the success/empty/invalid paths
 * applyResult branches on (never trusting the job's stored JSON as
 * already-safe, matching every other AI Workspace picker's own doctrine).
 */
describe("contentRewriterJobResultSchema — successful, empty, and invalid job results", () => {
  const VALID_RESULT = {
    contentId: "content-1",
    currentTitle: "Old Title",
    rewrittenTitle: "New Title",
    titleChanged: true,
    currentMetaTitle: "Old Meta",
    rewrittenMetaTitle: "New Meta",
    metaTitleChanged: true,
    currentMetaDescription: "Old description.",
    rewrittenMetaDescription: "New description.",
    metaDescriptionChanged: true,
    currentBody: "Old body.",
    rewrittenBody: "New body.",
    bodyChanged: true,
    reasoning: "Clarified the messaging.",
  };

  it("5. a successful, fully-populated result parses correctly", () => {
    const parsed = contentRewriterJobResultSchema.safeParse({ result: VALID_RESULT });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.result).toEqual(VALID_RESULT);
  });

  it("6. an empty result (result: null) — a genuine successful 'nothing valid' outcome — parses correctly, never treated as malformed", () => {
    const parsed = contentRewriterJobResultSchema.safeParse({ result: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.result).toBeNull();
  });

  it("7. a fully invalid/unexpected shape (missing the result key entirely) is rejected", () => {
    const parsed = contentRewriterJobResultSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("8. a result object missing a required field is rejected — never silently repaired", () => {
    const withoutTitleChanged: Record<string, unknown> = { ...VALID_RESULT };
    delete withoutTitleChanged.titleChanged;
    const parsed = contentRewriterJobResultSchema.safeParse({ result: withoutTitleChanged });
    expect(parsed.success).toBe(false);
  });

  it("9. a completely unrelated shape (e.g. an array, or a plain string) is rejected", () => {
    expect(contentRewriterJobResultSchema.safeParse([1, 2, 3]).success).toBe(false);
    expect(contentRewriterJobResultSchema.safeParse("not an object").success).toBe(false);
    expect(contentRewriterJobResultSchema.safeParse(null).success).toBe(false);
  });
});
