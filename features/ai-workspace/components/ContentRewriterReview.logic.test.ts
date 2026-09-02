import { describe, expect, it } from "vitest";

import { computeCanApplyRewrite, computeChangedFieldLabels, computeContentRewriteReasoningDisplay, formatFieldList } from "@/features/ai-workspace/components/ContentRewriterReview";

/**
 * Same lesson Meta Tag Optimizer's own live testing surfaced, extended from
 * two fields to four: the AI's `reasoning` is one combined blob that can
 * describe any field regardless of which ones actually changed, so it can
 * only be shown verbatim when every field changed. These tests never touch
 * a component render — this repository has no React component-rendering
 * test setup — they exercise the pure decision functions directly.
 */
describe("computeContentRewriteReasoningDisplay", () => {
  it("1. all four fields changed: reasoning may be shown", () => {
    expect(computeContentRewriteReasoningDisplay(true, true, true, true)).toBe("ALL_CHANGED");
  });

  it("2. no fields changed: deterministic no-change state", () => {
    expect(computeContentRewriteReasoningDisplay(false, false, false, false)).toBe("NO_CHANGE");
  });

  it("3. exactly one field changed (title only): partial", () => {
    expect(computeContentRewriteReasoningDisplay(true, false, false, false)).toBe("PARTIAL");
  });

  it("4. exactly one field changed (body only): partial", () => {
    expect(computeContentRewriteReasoningDisplay(false, false, false, true)).toBe("PARTIAL");
  });

  it("5. exactly two fields changed: partial", () => {
    expect(computeContentRewriteReasoningDisplay(true, false, true, false)).toBe("PARTIAL");
  });

  it("6. exactly three fields changed: partial (not yet ALL_CHANGED)", () => {
    expect(computeContentRewriteReasoningDisplay(true, true, true, false)).toBe("PARTIAL");
  });
});

describe("computeChangedFieldLabels", () => {
  it("7. all changed: everything in `changed`, nothing in `unchanged`", () => {
    const result = computeChangedFieldLabels(true, true, true, true);
    expect(result.changed).toEqual(["title", "meta title", "meta description", "body"]);
    expect(result.unchanged).toEqual([]);
  });

  it("8. none changed: everything in `unchanged`, nothing in `changed`", () => {
    const result = computeChangedFieldLabels(false, false, false, false);
    expect(result.changed).toEqual([]);
    expect(result.unchanged).toEqual(["title", "meta title", "meta description", "body"]);
  });

  it("9. only body changed: body in `changed`, the other three in `unchanged`, in stable order", () => {
    const result = computeChangedFieldLabels(false, false, false, true);
    expect(result.changed).toEqual(["body"]);
    expect(result.unchanged).toEqual(["title", "meta title", "meta description"]);
  });

  it("10. title and meta description changed: correctly splits a non-adjacent pair", () => {
    const result = computeChangedFieldLabels(true, false, true, false);
    expect(result.changed).toEqual(["title", "meta description"]);
    expect(result.unchanged).toEqual(["meta title", "body"]);
  });
});

describe("formatFieldList", () => {
  it("11. empty list: empty string", () => {
    expect(formatFieldList([])).toBe("");
  });

  it("12. one item: itself, no conjunction", () => {
    expect(formatFieldList(["body"])).toBe("body");
  });

  it("13. two items: joined with 'and', no comma", () => {
    expect(formatFieldList(["title", "body"])).toBe("title and body");
  });

  it("14. three or more items: Oxford-comma style list", () => {
    expect(formatFieldList(["title", "meta title", "body"])).toBe("title, meta title, and body");
  });

  it("15. all four items", () => {
    expect(formatFieldList(["title", "meta title", "meta description", "body"])).toBe("title, meta title, meta description, and body");
  });
});

/**
 * Stage E — governs whether "Apply this rewrite" is shown at all. Mirrors
 * Meta Tag Optimizer's own computeIsApplyEligible exactly, scaled to four
 * fields. Double-apply prevention within a session is enforced entirely by
 * the `alreadyApplied` flag here — the server's own no-op detection in
 * applyContentRewriteAction is the real safety net regardless.
 */
describe("computeCanApplyRewrite", () => {
  it("16. only the title changed, not yet applied: eligible", () => {
    expect(computeCanApplyRewrite(true, false, false, false, false)).toBe(true);
  });

  it("17. only the body changed, not yet applied: eligible", () => {
    expect(computeCanApplyRewrite(false, false, false, true, false)).toBe(true);
  });

  it("18. all four changed, not yet applied: eligible", () => {
    expect(computeCanApplyRewrite(true, true, true, true, false)).toBe(true);
  });

  it("19. nothing changed: never eligible, regardless of applied state — nothing to apply", () => {
    expect(computeCanApplyRewrite(false, false, false, false, false)).toBe(false);
    expect(computeCanApplyRewrite(false, false, false, false, true)).toBe(false);
  });

  it("20. already applied this session: not eligible even though fields changed (double-apply prevention)", () => {
    expect(computeCanApplyRewrite(true, false, false, false, true)).toBe(false);
    expect(computeCanApplyRewrite(false, false, false, true, true)).toBe(false);
    expect(computeCanApplyRewrite(true, true, true, true, true)).toBe(false);
  });
});
