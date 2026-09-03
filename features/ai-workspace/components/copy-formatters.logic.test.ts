import { describe, expect, it } from "vitest";

import { formatOpportunitiesAsText } from "@/features/ai-workspace/components/ContentGapAnalysisPicker";
import { formatRecommendationsAsText } from "@/features/ai-workspace/components/InternalLinkAnalyzerPicker";

/**
 * Phase B B5.3 — Internal Link Analyzer and Content Gap Analysis are the two
 * review-only tools (no Copy, no Apply): their output was previously
 * unreachable outside the screen. These pin the copied text to what the cards
 * actually display, and guard against leaking internal ids, provider details
 * or raw object dumps into a user's clipboard.
 */
describe("formatOpportunitiesAsText (Content Gap Analysis)", () => {
  const base = {
    topic: "Success Stories",
    opportunity: "Case studies from investors.",
    reason: "Builds trust.",
    relatedCluster: "Investment Opportunities",
    existingCoverageStatus: "NOT_FOUND" as const,
    matchedExistingTitle: null,
    suggestedContentType: "CASE_STUDY" as const,
    recommendedNextAction: null,
  };

  it("1. includes the deterministic audit fields the card shows", () => {
    const text = formatOpportunitiesAsText({ opportunities: [base] });
    expect(text).toContain("Success Stories");
    expect(text).toContain("Case studies from investors.");
    expect(text).toContain("Builds trust.");
    expect(text).toContain("Related keyword cluster: Investment Opportunities");
  });

  it("2. renders the AI format suggestion with its human label, not the raw enum", () => {
    const text = formatOpportunitiesAsText({ opportunities: [base] });
    expect(text).toContain("Suggested format: Case study");
    expect(text).not.toContain("CASE_STUDY");
  });

  it("3. omits the format line entirely when no suggestion was returned — never prints null", () => {
    const text = formatOpportunitiesAsText({ opportunities: [{ ...base, suggestedContentType: null }] });
    expect(text).not.toContain("Suggested format");
    expect(text).not.toMatch(/null|undefined/);
  });

  it("4. states the conservative coverage caveat when a possible match was found", () => {
    const text = formatOpportunitiesAsText({
      opportunities: [{ ...base, existingCoverageStatus: "POSSIBLE_MATCH" as const, matchedExistingTitle: "An Existing Page" }],
    });
    expect(text).toContain("An Existing Page");
    expect(text).toMatch(/title-text match only, not a full content review/i);
  });

  it("5. reports no match plainly when nothing was found", () => {
    expect(formatOpportunitiesAsText({ opportunities: [base] })).toContain("No matching existing page title found");
  });

  it("6. separates multiple opportunities readably", () => {
    const text = formatOpportunitiesAsText({ opportunities: [base, { ...base, topic: "FAQs" }] });
    expect(text).toContain("---");
    expect(text).toContain("FAQs");
  });

  it("7. an empty result copies as an empty string rather than an object dump", () => {
    expect(formatOpportunitiesAsText({ opportunities: [] })).toBe("");
  });

  it("8. never leaks internal ids, provider names or debug fields", () => {
    const text = formatOpportunitiesAsText({ opportunities: [base] });
    expect(text).not.toMatch(/jobId|contentId|seoProjectId|gemini|ollama|openrouter|resultJson|\{|\}/i);
  });
});

describe("formatRecommendationsAsText (Internal Link Analyzer)", () => {
  const rec = {
    anchorText: "self storage investing",
    targetPage: "https://example.com/guide",
    reason: "The source page introduces the topic this guide covers in depth.",
    placement: "In the second paragraph",
    priority: "HIGH" as const,
  };

  it("9. includes every field the card displays", () => {
    const text = formatRecommendationsAsText({ recommendations: [rec] });
    expect(text).toContain('Anchor text: "self storage investing"');
    expect(text).toContain("Link to: https://example.com/guide");
    expect(text).toContain("Reason: The source page introduces");
    expect(text).toContain("Placement: In the second paragraph");
    expect(text).toContain("Priority: HIGH");
  });

  it("10. separates multiple recommendations readably", () => {
    const text = formatRecommendationsAsText({ recommendations: [rec, { ...rec, anchorText: "storage returns" }] });
    expect(text).toContain("---");
    expect(text).toContain("storage returns");
  });

  it("11. an empty result copies as an empty string rather than an object dump", () => {
    expect(formatRecommendationsAsText({ recommendations: [] })).toBe("");
  });

  it("12. never leaks internal ids, provider names or debug fields", () => {
    const text = formatRecommendationsAsText({ recommendations: [rec] });
    expect(text).not.toMatch(/jobId|contentId|seoProjectId|gemini|ollama|openrouter|resultJson|\{|\}/i);
  });
});
