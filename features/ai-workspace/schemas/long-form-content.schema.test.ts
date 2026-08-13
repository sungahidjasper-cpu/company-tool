import { describe, expect, it } from "vitest";

import { contentBriefOutputSchema } from "@/features/ai-workspace/schemas/content-brief.schema";
import {
  formatLongFormContentAsMarkdown,
  generateLongFormFromBriefContextSchema,
  longFormContentOutputSchema,
} from "@/features/ai-workspace/schemas/long-form-content.schema";

const VALID_BRIEF = {
  title: "Emergency Plumber in Austin",
  metaTitle: "Emergency Plumber Austin | Acme",
  metaDescription: "Fast 24/7 emergency plumbing in Austin.",
  outline: ["Introduction", "Signs of an emergency", "Contact us"],
  suggestedHeadings: ["What counts as an emergency?"],
  internalLinkSuggestions: ["Link to services page"],
  seoRecommendations: ["Use the keyword in the H1"],
  geoAeoNotes: "Use direct Q&A framing.",
  suggestedSearchIntent: "TRANSACTIONAL",
};

describe("generateLongFormFromBriefContextSchema", () => {
  it("accepts a valid context with a keyword selected", () => {
    const result = generateLongFormFromBriefContextSchema.safeParse({
      seoProjectId: "project-1",
      keywordId: "keyword-1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid context with no keyword selected", () => {
    const result = generateLongFormFromBriefContextSchema.safeParse({ seoProjectId: "project-1", keywordId: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keywordId).toBeUndefined();
    }
  });

  it("rejects a missing seoProjectId", () => {
    const result = generateLongFormFromBriefContextSchema.safeParse({ seoProjectId: "" });
    expect(result.success).toBe(false);
  });
});

describe("the brief itself is validated separately, via contentBriefOutputSchema (zod/v4)", () => {
  it("accepts a well-formed brief", () => {
    expect(contentBriefOutputSchema.safeParse(VALID_BRIEF).success).toBe(true);
  });

  it("rejects a malformed brief (missing required field) — this is what the action relies on, since a plain zod (v3) object cannot nest a zod/v4 sub-schema", () => {
    const { title, ...withoutTitle } = VALID_BRIEF;
    void title;
    expect(contentBriefOutputSchema.safeParse(withoutTitle).success).toBe(false);
  });
});

describe("longFormContentOutputSchema", () => {
  const validArticle = {
    introduction: "Plumbing emergencies can happen at any hour.",
    sections: [{ heading: "What counts as an emergency?", body: "Burst pipes, active leaks, and no hot water." }],
    conclusion: "Call Acme Plumbing any time, day or night.",
    faq: [{ question: "Do you charge extra for after-hours calls?", answer: "No, our rate is flat 24/7." }],
    internalLinkPlacementSuggestions: ["Link to the services page in the introduction."],
  };

  it("accepts a fully-formed article", () => {
    expect(longFormContentOutputSchema.safeParse(validArticle).success).toBe(true);
  });

  it("accepts faq: null when a FAQ section isn't a natural fit", () => {
    const result = longFormContentOutputSchema.safeParse({ ...validArticle, faq: null });
    expect(result.success).toBe(true);
  });

  it("rejects an article missing a required field", () => {
    const { conclusion, ...withoutConclusion } = validArticle;
    void conclusion;
    expect(longFormContentOutputSchema.safeParse(withoutConclusion).success).toBe(false);
  });

  it("rejects a section that is a string instead of a {heading, body} object", () => {
    const malformed = { ...validArticle, sections: ["Introduction"] };
    expect(longFormContentOutputSchema.safeParse(malformed).success).toBe(false);
  });
});

describe("formatLongFormContentAsMarkdown", () => {
  const article = {
    introduction: "Intro paragraph.",
    sections: [
      { heading: "First Section", body: "First body." },
      { heading: "Second Section", body: "Second body." },
    ],
    conclusion: "Wrap-up paragraph.",
    faq: [{ question: "Q1?", answer: "A1." }],
    internalLinkPlacementSuggestions: ["Suggestion that must NOT appear in the saved body"],
  };

  it("includes the introduction, every section heading/body, and the conclusion", () => {
    const markdown = formatLongFormContentAsMarkdown(article);
    expect(markdown).toContain("Intro paragraph.");
    expect(markdown).toContain("## First Section");
    expect(markdown).toContain("First body.");
    expect(markdown).toContain("## Second Section");
    expect(markdown).toContain("## Conclusion");
    expect(markdown).toContain("Wrap-up paragraph.");
  });

  it("includes a FAQ section when faq is present", () => {
    const markdown = formatLongFormContentAsMarkdown(article);
    expect(markdown).toContain("## FAQ");
    expect(markdown).toContain("Q1?");
    expect(markdown).toContain("A1.");
  });

  it("omits the FAQ section entirely when faq is null", () => {
    const markdown = formatLongFormContentAsMarkdown({ ...article, faq: null });
    expect(markdown).not.toContain("## FAQ");
  });

  it("never includes internalLinkPlacementSuggestions in the saved body — those are reviewer-only", () => {
    const markdown = formatLongFormContentAsMarkdown(article);
    expect(markdown).not.toContain("Suggestion that must NOT appear in the saved body");
  });
});
