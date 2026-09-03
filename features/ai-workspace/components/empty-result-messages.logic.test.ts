import { describe, expect, it } from "vitest";

import { INTERNAL_LINK_EMPTY_RESULT_MESSAGE } from "@/features/ai-workspace/components/InternalLinkAnalyzerPicker";
import { META_TAG_EMPTY_RESULT_MESSAGE } from "@/features/ai-workspace/components/MetaTagOptimizerPicker";
import { SCHEMA_MARKUP_EMPTY_RESULT_MESSAGE } from "@/features/ai-workspace/components/SchemaMarkupGeneratorPicker";
import { SOCIAL_SNIPPET_EMPTY_RESULT_MESSAGE } from "@/features/ai-workspace/components/SocialSnippetGeneratorPicker";
import { PRESS_RELEASE_NULL_RESULT_MESSAGE } from "@/features/ai-workspace/components/PressReleaseGeneratorPicker";

/**
 * Phase B B3.1 — four tools told the user their input was the problem when
 * generation returned nothing usable ("Try adding more context above", "add
 * more content to this project first", "Try a different selection", "Try a
 * different piece of content, or select different platforms"). The real cause
 * is almost always an AI response failing our deterministic quality checks,
 * often after falling back to a weaker provider. Press Release had already
 * been fixed this way; these lock the same standard across the rest.
 *
 * These messages are for the EMPTY-RESULT case only. Genuine validation
 * failures — an unowned project, a page with no body, an empty required
 * field — keep their own specific, actionable wording and are covered by the
 * action tests, not here.
 */
const NEUTRALIZED = [
  ["Internal Link Analyzer", INTERNAL_LINK_EMPTY_RESULT_MESSAGE],
  ["Meta Tag Optimizer", META_TAG_EMPTY_RESULT_MESSAGE],
  ["Schema Markup Generator", SCHEMA_MARKUP_EMPTY_RESULT_MESSAGE],
  ["Social Snippet Generator", SOCIAL_SNIPPET_EMPTY_RESULT_MESSAGE],
] as const;

/** The exact input-blaming phrasings removed in B3.1, plus the general shapes of that defect class. */
const INPUT_BLAMING_PATTERNS = [
  /try adding more/i,
  /add more content/i,
  /try a different selection/i,
  /try a different piece of content/i,
  /select different platforms/i,
  /your input/i,
  /insufficient/i,
  /not enough/i,
];

describe("B3.1 — empty-result messages never blame the user's input", () => {
  for (const [tool, message] of NEUTRALIZED) {
    it(`${tool}: contains no input-blaming phrasing`, () => {
      for (const pattern of INPUT_BLAMING_PATTERNS) {
        expect(message, `"${message}" matched ${pattern}`).not.toMatch(pattern);
      }
    });

    it(`${tool}: attributes the empty result to the AI response, not the user`, () => {
      expect(message).toMatch(/didn't meet our quality requirements/i);
    });

    it(`${tool}: offers regenerating as the next step`, () => {
      expect(message).toMatch(/try generating again/i);
    });

    it(`${tool}: exposes no provider internals`, () => {
      expect(message).not.toMatch(/gemini|ollama|openrouter|provider|token|api|model|quota|credits/i);
    });
  }

  it("stays consistent with the already-approved Press Release wording", () => {
    expect(PRESS_RELEASE_NULL_RESULT_MESSAGE).toMatch(/didn't meet our quality requirements/i);
    for (const [, message] of NEUTRALIZED) {
      expect(message).toMatch(/Please try generating again\./);
    }
  });

  it("each message still says what specifically was empty, so the four are not interchangeable", () => {
    expect(INTERNAL_LINK_EMPTY_RESULT_MESSAGE).toMatch(/internal-linking opportunities/i);
    expect(META_TAG_EMPTY_RESULT_MESSAGE).toMatch(/suggestions/i);
    expect(SCHEMA_MARKUP_EMPTY_RESULT_MESSAGE).toMatch(/structured-data recommendations/i);
    expect(SOCIAL_SNIPPET_EMPTY_RESULT_MESSAGE).toMatch(/snippets/i);
  });
});
