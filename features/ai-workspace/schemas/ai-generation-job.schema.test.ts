import { describe, expect, it } from "vitest";

import { validateContentBriefJobInput, validateLongFormJobInput, validateMetaTagOptimizerJobInput } from "@/features/ai-workspace/schemas/ai-generation-job.schema";
import { validateTopicClusterPlannerJobInput } from "@/features/ai-workspace/schemas/ai-generation-job.schema";

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

describe("validateMetaTagOptimizerJobInput", () => {
  const VALID_UUID_1 = "00000000-0000-4000-8000-000000000001";
  const VALID_UUID_2 = "00000000-0000-4000-8000-000000000002";
  const PROJECT_UUID = "00000000-0000-4000-8000-0000000000f0";

  it("12. accepts a valid Meta Tag Optimizer job input shape", () => {
    const result = validateMetaTagOptimizerJobInput({ seoProjectId: PROJECT_UUID, contentIds: [VALID_UUID_1, VALID_UUID_2] });
    expect(result).toEqual({ success: true, data: { seoProjectId: PROJECT_UUID, contentIds: [VALID_UUID_1, VALID_UUID_2] } });
  });

  it("13. rejects invalid job input (missing contentIds, malformed seoProjectId)", () => {
    expect(validateMetaTagOptimizerJobInput({ seoProjectId: PROJECT_UUID }).success).toBe(false);
    expect(validateMetaTagOptimizerJobInput({ seoProjectId: "not-a-uuid", contentIds: [VALID_UUID_1] }).success).toBe(false);
    expect(validateMetaTagOptimizerJobInput(null).success).toBe(false);
    expect(validateMetaTagOptimizerJobInput("a string").success).toBe(false);
  });

  it("14. rejects an empty content selection", () => {
    expect(validateMetaTagOptimizerJobInput({ seoProjectId: PROJECT_UUID, contentIds: [] }).success).toBe(false);
  });

  it("15. rejects a selection of more than 50 content ids", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(validateMetaTagOptimizerJobInput({ seoProjectId: PROJECT_UUID, contentIds: tooMany }).success).toBe(false);
  });

  it("accepts exactly 50 content ids", () => {
    const exactlyFifty = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(validateMetaTagOptimizerJobInput({ seoProjectId: PROJECT_UUID, contentIds: exactlyFifty }).success).toBe(true);
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

/**
 * The tenth AI Workspace tool. The runner re-validates a stored job input
 * before dispatching, so a row written by an older/other code path can never
 * reach the generator unchecked.
 */
describe("validateTopicClusterPlannerJobInput", () => {
  const VALID = { seoProjectId: "00000000-0000-4000-8000-0000000000f0", seedTopic: "self storage investing", keywordIds: [] };

  it("accepts a well-formed stored job input", () => {
    const result = validateTopicClusterPlannerJobInput(VALID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.seedTopic).toBe("self storage investing");
  });

  it("defaults keywordIds when the stored row omits them", () => {
    const result = validateTopicClusterPlannerJobInput({ seoProjectId: VALID.seoProjectId, seedTopic: VALID.seedTopic });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.keywordIds).toEqual([]);
  });

  it("rejects a stored row with no seed topic", () => {
    expect(validateTopicClusterPlannerJobInput({ seoProjectId: VALID.seoProjectId, seedTopic: "" }).success).toBe(false);
  });

  it("rejects a stored row whose project id is not a UUID", () => {
    expect(validateTopicClusterPlannerJobInput({ ...VALID, seoProjectId: "nope" }).success).toBe(false);
  });

  it("rejects a stored row carrying a non-UUID keyword id", () => {
    expect(validateTopicClusterPlannerJobInput({ ...VALID, keywordIds: ["not-a-uuid"] }).success).toBe(false);
  });

  it("rejects malformed input entirely", () => {
    for (const bad of [null, undefined, "string", 42, []]) {
      expect(validateTopicClusterPlannerJobInput(bad).success).toBe(false);
    }
  });
});
