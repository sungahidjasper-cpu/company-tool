import { describe, expect, it } from "vitest";

import { validateContentBriefJobInput, validateLongFormJobInput } from "@/features/ai-workspace/schemas/ai-generation-job.schema";

const BRIEF_OUTPUT = {
  title: "Best Plumbers in Austin",
  metaTitle: "Best Plumbers in Austin | Acme",
  metaDescription: "Find the best plumbers in Austin.",
  outline: ["Intro"],
  suggestedHeadings: [],
  internalLinkSuggestions: [],
  seoRecommendations: [],
  geoAeoNotes: "",
  suggestedSearchIntent: "informational",
};

describe("validateContentBriefJobInput", () => {
  it("accepts a valid CONTENT_BRIEF inputJson shape", () => {
    const result = validateContentBriefJobInput({ seoProjectId: "project-1", keywordId: "keyword-1", contentType: "BLOG_POST", notes: "x" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing seoProjectId", () => {
    const result = validateContentBriefJobInput({ contentType: "BLOG_POST" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid contentType", () => {
    const result = validateContentBriefJobInput({ seoProjectId: "project-1", contentType: "NOT_A_REAL_TYPE" });
    expect(result.success).toBe(false);
  });
});

describe("validateLongFormJobInput — fromContent mode", () => {
  it("accepts a valid fromContent shape", () => {
    const result = validateLongFormJobInput({ mode: "fromContent", contentId: "content-1" });
    expect(result).toEqual({ success: true, data: { mode: "fromContent", contentId: "content-1" } });
  });

  it("rejects fromContent with a missing contentId", () => {
    const result = validateLongFormJobInput({ mode: "fromContent" });
    expect(result.success).toBe(false);
  });

  it("rejects fromContent with an empty-string contentId", () => {
    const result = validateLongFormJobInput({ mode: "fromContent", contentId: "" });
    expect(result.success).toBe(false);
  });
});

describe("validateLongFormJobInput — fromBrief mode", () => {
  it("accepts a valid fromBrief shape", () => {
    const result = validateLongFormJobInput({ mode: "fromBrief", seoProjectId: "project-1", keywordId: "keyword-1", brief: BRIEF_OUTPUT });
    expect(result.success).toBe(true);
    if (result.success && result.data.mode === "fromBrief") {
      expect(result.data.seoProjectId).toBe("project-1");
      expect(result.data.brief.title).toBe(BRIEF_OUTPUT.title);
    }
  });

  it("accepts fromBrief with no keywordId", () => {
    const result = validateLongFormJobInput({ mode: "fromBrief", seoProjectId: "project-1", brief: BRIEF_OUTPUT });
    expect(result.success).toBe(true);
  });

  it("rejects fromBrief with a missing seoProjectId", () => {
    const result = validateLongFormJobInput({ mode: "fromBrief", brief: BRIEF_OUTPUT });
    expect(result.success).toBe(false);
  });

  it("rejects fromBrief with a brief missing required fields", () => {
    const result = validateLongFormJobInput({ mode: "fromBrief", seoProjectId: "project-1", brief: { title: "Incomplete" } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/regenerate/i);
    }
  });
});

describe("validateLongFormJobInput — invalid mode", () => {
  it("rejects an unrecognized mode", () => {
    const result = validateLongFormJobInput({ mode: "somethingElse" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(validateLongFormJobInput(null).success).toBe(false);
    expect(validateLongFormJobInput("a string").success).toBe(false);
  });
});
