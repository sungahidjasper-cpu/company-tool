import { describe, expect, it } from "vitest";

import { computeCanGeneratePlan, formatPlanAsText } from "@/features/ai-workspace/components/TopicClusterPlannerPicker";
import type { TopicClusterPlanResult } from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";

/**
 * This repository has no React rendering test setup (vitest runs
 * `environment: "node"`), so the picker's real logic is tested as pure
 * functions — the same approach every other AI Workspace picker uses.
 */

const PLAN: TopicClusterPlanResult = {
  seedTopic: "self storage investing",
  existingClusterNames: ["Storage Investing"],
  clusters: [
    {
      name: "Evaluating Storage Assets",
      purpose: "Helps investors judge a facility.",
      pillarRelationship: "Covers the due-diligence stage.",
      searchIntent: "INFORMATIONAL",
      suggestedContentType: "GUIDE",
      existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
      relatedKeywords: ["self storage investments"],
      contentIdeas: ["Facility inspection checklist"],
      supportingTopics: [
        {
          topic: "How to evaluate a storage facility",
          relationshipToPillar: "Supports the evaluation section.",
          rationale: "Buyers need a checklist.",
          searchIntent: null,
          suggestedContentType: null,
          subtopics: ["What to inspect on site"],
          existingCoverage: { status: "POSSIBLE_MATCH", matchedTitle: "Facility Evaluation Basics" },
          relatedKeywords: [],
          overlapNote: "Potential overlap with \"Storage due diligence\" — consider consolidating them into one page.",
        },
      ],
    },
  ],
};

describe("computeCanGeneratePlan — the Generate gate", () => {
  it("1. requires both a project and a primary topic", () => {
    expect(computeCanGeneratePlan("project-1", "self storage investing")).toBe(true);
  });

  it("2. blocked with no project selected — the tool never defaults to one", () => {
    expect(computeCanGeneratePlan("", "self storage investing")).toBe(false);
  });

  it("3. blocked with no primary topic", () => {
    expect(computeCanGeneratePlan("project-1", "")).toBe(false);
  });

  it("4. blocked when the primary topic is only whitespace or too short to be useful", () => {
    expect(computeCanGeneratePlan("project-1", "   ")).toBe(false);
    expect(computeCanGeneratePlan("project-1", "ab")).toBe(false);
  });
});

describe("formatPlanAsText — the Copy output carries the hierarchy", () => {
  it("5. labels the primary topic as the user's own input", () => {
    expect(formatPlanAsText(PLAN)).toContain("Primary topic (your input): self storage investing");
  });

  it("6. includes the cluster, its supporting topics and their subtopics — indented, not flattened", () => {
    const text = formatPlanAsText(PLAN);
    expect(text).toContain("CLUSTER: Evaluating Storage Assets");
    expect(text).toContain("  SUPPORTING TOPIC: How to evaluate a storage facility");
    expect(text).toContain("  Subtopics: What to inspect on site");
    expect(text).toContain("  Further content ideas: Facility inspection checklist");
  });

  it("7. includes the cluster's relationship to the primary topic", () => {
    expect(formatPlanAsText(PLAN)).toContain("How it supports the primary topic: Covers the due-diligence stage.");
  });

  it("8. omits absent classifications rather than printing them as null", () => {
    const text = formatPlanAsText(PLAN);
    expect(text).not.toContain("null");
    // The cluster has both classifications; its one supporting topic has neither.
    expect(text.match(/Search intent:/g)).toHaveLength(1);
    expect(text.match(/Suggested format:/g)).toHaveLength(1);
  });

  it("9. hedges existing-coverage wording — never claims the topic is covered or ranks", () => {
    const text = formatPlanAsText(PLAN);
    expect(text).toContain("Potential existing coverage:");
    expect(text).toContain("(title match only)");
    expect(text).not.toMatch(/fully covered|ranks for|is ranking/i);
  });

  it("10. carries the overlap note so a pasted plan keeps the consolidation warning", () => {
    expect(formatPlanAsText(PLAN)).toContain("consider consolidating them into one page");
  });

  it("11. lists real related keywords and the project's real existing clusters", () => {
    const text = formatPlanAsText(PLAN);
    expect(text).toContain("Related existing keywords: self storage investments");
    expect(text).toContain("Existing keyword clusters in this project: Storage Investing");
  });

  it("12. never leaks internal ids, URLs or provider details into the copied text", () => {
    const text = formatPlanAsText(PLAN);
    // Precise checks: a bare /id/ would match ordinary words like "guide".
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/(?:jobId|contentId|keywordId|seoProjectId|companyId)/i);
    expect(text).not.toMatch(/(?:provider|gemini|openrouter|ollama)/i);
  });

  it("13. an empty plan still produces honest text rather than throwing", () => {
    const empty: TopicClusterPlanResult = { seedTopic: "x", clusters: [], existingClusterNames: [] };
    expect(formatPlanAsText(empty)).toBe("Primary topic (your input): x");
  });
});
