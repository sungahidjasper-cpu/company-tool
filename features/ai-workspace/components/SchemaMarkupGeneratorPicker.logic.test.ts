import { describe, expect, it } from "vitest";

import { schemaMarkupInputSchema, schemaMarkupOutputSchema } from "@/features/ai-workspace/schemas/schema-markup-generator.schema";
import { isValidJsonLd } from "@/features/ai-workspace/services/schema-markup-generator.service";

/**
 * Phase C4.3 — arriving at the Schema Markup Generator from a Content
 * record's "Generate Schema" action.
 *
 * This repository has no React rendering test setup (vitest runs
 * `environment: "node"`), so the seam between the resolved hand-off and what
 * the picker/action actually accept is tested through the schemas and pure
 * functions themselves — the same approach the other AI Workspace pickers
 * use. Rendering and clipboard behaviour are covered by live verification.
 */
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const CONTENT = "00000000-0000-4000-8000-00000000c001";

describe("preselection is a valid input for the existing generate action", () => {
  it("1. a resolved hand-off (project + content) is accepted by the existing input schema unchanged", () => {
    const parsed = schemaMarkupInputSchema.safeParse({ seoProjectId: PROJECT, contentId: CONTENT });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.contentId).toBe(CONTENT);
  });

  it("2. a DROPPED hand-off still yields a usable request — Content is an optional narrowing for this tool, so the project alone is valid", () => {
    // The route passes `contentIds[0] ?? ""`, and the picker sends
    // `contentId || undefined`, so a dropped content id becomes absent.
    const parsed = schemaMarkupInputSchema.safeParse({ seoProjectId: PROJECT, contentId: undefined });
    expect(parsed.success).toBe(true);
  });

  it("3. an empty project id is still rejected — the hand-off cannot bypass the existing requirement", () => {
    const parsed = schemaMarkupInputSchema.safeParse({ seoProjectId: "", contentId: CONTENT });
    expect(parsed.success).toBe(false);
  });

  it("4. the hand-off carries no other fields into the request — notes stay user-supplied, never injected by navigation", () => {
    const parsed = schemaMarkupInputSchema.safeParse({ seoProjectId: PROJECT, contentId: CONTENT });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.notes).toBeUndefined();
  });
});

/**
 * The review-only guarantee: the generated output is validated and displayed,
 * and carries nothing that could write to a Content row.
 */
describe("schema output validation is preserved (review-only)", () => {
  it("5. valid JSON-LD passes the existing deterministic check", () => {
    expect(isValidJsonLd('{"@context":"https://schema.org","@type":"Article","headline":"X"}')).toBe(true);
  });

  it("6. prose describing JSON-LD is rejected, never repaired", () => {
    expect(isValidJsonLd("An Article schema with a headline field")).toBe(false);
    expect(isValidJsonLd("https://schema.org/Article")).toBe(false);
  });

  it("7. JSON missing @context or @type is rejected", () => {
    expect(isValidJsonLd('{"@type":"Article"}')).toBe(false);
    expect(isValidJsonLd('{"@context":"https://schema.org"}')).toBe(false);
  });

  it("8. a non-object (array, string, null) is rejected", () => {
    expect(isValidJsonLd('["@context"]')).toBe(false);
    expect(isValidJsonLd('"@context"')).toBe(false);
    expect(isValidJsonLd("null")).toBe(false);
  });

  it("9. the output contract exposes recommendations only — no content id, no field writes, nothing that could target a Content row", () => {
    const parsed = schemaMarkupOutputSchema.safeParse({
      recommendations: [{ schemaType: "Article", reasoning: "because", exampleJsonLd: '{"@context":"https://schema.org","@type":"Article"}' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data)).toEqual(["recommendations"]);
      expect(Object.keys(parsed.data.recommendations[0]).sort()).toEqual(["exampleJsonLd", "reasoning", "schemaType"]);
    }
  });

  it("10. an empty result set is a valid successful outcome, not a malformed one", () => {
    const parsed = schemaMarkupOutputSchema.safeParse({ recommendations: [] });
    expect(parsed.success).toBe(true);
  });
});
