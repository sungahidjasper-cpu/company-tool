import { describe, expect, it } from "vitest";

import { contentBriefInputSchema, contentBriefOutputSchema } from "@/features/ai-workspace/schemas/content-brief.schema";

describe("contentBriefInputSchema", () => {
  it("accepts a valid input with no keyword selected", () => {
    const result = contentBriefInputSchema.safeParse({
      seoProjectId: "project-1",
      keywordId: "",
      contentType: "BLOG_POST",
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keywordId).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });

  it("accepts a valid input with a keyword and notes", () => {
    const result = contentBriefInputSchema.safeParse({
      seoProjectId: "project-1",
      keywordId: "keyword-1",
      contentType: "LANDING_PAGE",
      notes: "Target small business owners",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing seoProjectId", () => {
    const result = contentBriefInputSchema.safeParse({ seoProjectId: "", contentType: "BLOG_POST" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown contentType", () => {
    const result = contentBriefInputSchema.safeParse({ seoProjectId: "project-1", contentType: "NOT_A_TYPE" });
    expect(result.success).toBe(false);
  });
});

describe("contentBriefOutputSchema", () => {
  const validOutput = {
    title: "10 Ways to Improve Local SEO",
    metaTitle: "10 Ways to Improve Local SEO | Acme",
    metaDescription: "Learn practical, actionable local SEO tactics for small businesses.",
    outline: ["Introduction", "Why local SEO matters", "Conclusion"],
    suggestedHeadings: ["What is local SEO?", "Top tactics"],
    internalLinkSuggestions: ["Link to /services/seo"],
    seoRecommendations: ["Add a Google Business Profile"],
    geoAeoNotes: "Structure answers as direct Q&A for AI answer engines.",
    suggestedSearchIntent: "INFORMATIONAL",
  };

  it("accepts a fully-formed brief", () => {
    expect(contentBriefOutputSchema.safeParse(validOutput).success).toBe(true);
  });

  it("rejects a brief missing a required field", () => {
    const { title, ...withoutTitle } = validOutput;
    void title;
    expect(contentBriefOutputSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it("rejects a brief where an array field is a single string instead of an array", () => {
    const malformed = { ...validOutput, outline: "Introduction" };
    expect(contentBriefOutputSchema.safeParse(malformed).success).toBe(false);
  });
});
