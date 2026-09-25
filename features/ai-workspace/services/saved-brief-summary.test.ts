import { describe, expect, it } from "vitest";

import { deriveContentWorkflowStage, readSavedBriefSummary } from "@/features/ai-workspace/services/saved-brief-summary";

/**
 * Phase C3 — the Content record's own workflow state, derived from columns the
 * row already carries. There is no workflow table and no stored status, so
 * these tests pin the derivation itself: it decides which contextual action is
 * honest to offer, and an action must never appear when the input it needs
 * does not exist.
 */
const SAVED_BRIEF = {
  outline: ["Intro", "Body"],
  suggestedHeadings: ["Why it matters"],
  seoRecommendations: ["Use the keyword in the H1"],
  keyTakeaways: ["Storage demand is steady"],
  suggestedSearchIntent: "Informational",
  briefSettings: { wordCount: 1500 },
};

describe("readSavedBriefSummary", () => {
  it("1. reads the brief fields a saved row carries", () => {
    const summary = readSavedBriefSummary(SAVED_BRIEF);
    expect(summary?.outline).toEqual(["Intro", "Body"]);
    expect(summary?.suggestedHeadings).toEqual(["Why it matters"]);
    expect(summary?.seoRecommendations).toEqual(["Use the keyword in the H1"]);
    expect(summary?.keyTakeaways).toEqual(["Storage demand is steady"]);
    expect(summary?.suggestedSearchIntent).toBe("Informational");
  });

  it("2. returns null for a row with no brief — a manually-authored page shows nothing", () => {
    expect(readSavedBriefSummary(null)).toBeNull();
    expect(readSavedBriefSummary(undefined)).toBeNull();
  });

  it("3. returns null for a malformed column rather than throwing", () => {
    expect(readSavedBriefSummary("a string")).toBeNull();
    expect(readSavedBriefSummary(42)).toBeNull();
    expect(readSavedBriefSummary(["not", "an", "object"])).toBeNull();
  });

  it("4. returns null when the column exists but carries nothing displayable", () => {
    expect(readSavedBriefSummary({})).toBeNull();
    expect(readSavedBriefSummary({ briefSettings: { wordCount: 1500 } })).toBeNull();
    expect(readSavedBriefSummary({ outline: [], seoRecommendations: [] })).toBeNull();
  });

  it("5. drops non-string and blank array entries instead of rendering them", () => {
    const summary = readSavedBriefSummary({ outline: ["Real", 42, null, "   ", "Also real"] });
    expect(summary?.outline).toEqual(["Real", "Also real"]);
  });

  it("6. survives a partially-populated brief, returning only what exists", () => {
    const summary = readSavedBriefSummary({ outline: ["Only this"] });
    expect(summary).not.toBeNull();
    expect(summary?.outline).toEqual(["Only this"]);
    expect(summary?.suggestedHeadings).toEqual([]);
    expect(summary?.suggestedSearchIntent).toBe("");
  });
});

describe("deriveContentWorkflowStage", () => {
  it("7. BRIEF_ONLY — a saved brief with no article is the state that offers Generate Long-Form", () => {
    expect(deriveContentWorkflowStage({ generatedByAi: true, body: null, aiBriefDetails: SAVED_BRIEF })).toBe("BRIEF_ONLY");
  });

  it("8. HAS_ARTICLE — once a body exists the workflow has moved past long-form generation", () => {
    expect(deriveContentWorkflowStage({ generatedByAi: true, body: "## Article\n\nReal text.", aiBriefDetails: SAVED_BRIEF })).toBe("HAS_ARTICLE");
  });

  it("9. MANUAL — a hand-authored row is never offered the brief-driven action", () => {
    expect(deriveContentWorkflowStage({ generatedByAi: false, body: null, aiBriefDetails: null })).toBe("MANUAL");
  });

  it("10. MANUAL — generatedByAi alone is not enough; the brief must actually be there", () => {
    expect(deriveContentWorkflowStage({ generatedByAi: true, body: null, aiBriefDetails: null })).toBe("MANUAL");
    expect(deriveContentWorkflowStage({ generatedByAi: true, body: null, aiBriefDetails: {} })).toBe("MANUAL");
  });

  it("11. a whitespace-only body does not count as an article", () => {
    expect(deriveContentWorkflowStage({ generatedByAi: true, body: "   \n  ", aiBriefDetails: SAVED_BRIEF })).toBe("BRIEF_ONLY");
  });

  it("12. a hand-authored row that somehow has a body is still HAS_ARTICLE — the body is what matters", () => {
    expect(deriveContentWorkflowStage({ generatedByAi: false, body: "Manually written.", aiBriefDetails: null })).toBe("HAS_ARTICLE");
  });

  it("13. the stage is a pure function of the row — the same row always derives the same stage", () => {
    const row = { generatedByAi: true, body: null, aiBriefDetails: SAVED_BRIEF };
    expect(deriveContentWorkflowStage(row)).toBe(deriveContentWorkflowStage(row));
  });
});
