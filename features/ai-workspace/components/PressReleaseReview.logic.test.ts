import { describe, expect, it } from "vitest";

import { formatPressReleaseAsText } from "@/features/ai-workspace/components/PressReleaseReview";
import type { PressReleaseResult } from "@/features/ai-workspace/schemas/press-release-generator.schema";

const FULL_RESULT: PressReleaseResult = {
  headline: "Acme Launches New Product",
  subheadline: "Available starting next month",
  dateline: "Austin, TX",
  leadParagraph: "Acme today announced a new product.",
  bodyParagraphs: ["The product will be available in March.", "It expands Acme's existing lineup."],
  quoteSection: '"We are excited," said Jane Doe, CEO.',
  boilerplate: "Acme is a plumbing company based in Austin.",
  callToAction: "Visit acme.example.com to learn more.",
  reasoning: "Structured as a standard launch announcement.",
};

describe("formatPressReleaseAsText", () => {
  it("1. includes every visible section in order, separated by blank lines", () => {
    const text = formatPressReleaseAsText(FULL_RESULT);
    const expectedOrder = [
      FULL_RESULT.headline,
      FULL_RESULT.subheadline,
      FULL_RESULT.dateline,
      FULL_RESULT.leadParagraph,
      FULL_RESULT.bodyParagraphs[0],
      FULL_RESULT.bodyParagraphs[1],
      FULL_RESULT.quoteSection,
      FULL_RESULT.boilerplate,
      FULL_RESULT.callToAction,
    ];
    expect(text).toBe(expectedOrder.join("\n\n"));
  });

  it("2. never includes the reasoning field — that's reviewer-only, not part of the release", () => {
    const text = formatPressReleaseAsText(FULL_RESULT);
    expect(text).not.toContain(FULL_RESULT.reasoning);
  });

  it("3. omits empty optional sections (subheadline/dateline/quoteSection/callToAction) rather than leaving blank lines", () => {
    const partial: PressReleaseResult = { ...FULL_RESULT, subheadline: "", dateline: "", quoteSection: "", callToAction: "" };
    const text = formatPressReleaseAsText(partial);
    expect(text).toBe([FULL_RESULT.headline, FULL_RESULT.leadParagraph, ...FULL_RESULT.bodyParagraphs, FULL_RESULT.boilerplate].join("\n\n"));
  });

  it("4. handles a single body paragraph correctly", () => {
    const singleParagraph: PressReleaseResult = { ...FULL_RESULT, bodyParagraphs: ["Only one paragraph."] };
    const text = formatPressReleaseAsText(singleParagraph);
    expect(text).toContain("Only one paragraph.");
  });
});
