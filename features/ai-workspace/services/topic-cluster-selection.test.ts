import { describe, expect, it } from "vitest";

import type { TopicClusterPlanResult, TopicSupportingTopic } from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";
import {
  canGenerateContent,
  clusterSelectionState,
  isTopicSelected,
  selectionKey,
  setClusterSelected,
  summarizeSelection,
  toggleTopic,
} from "@/features/ai-workspace/services/topic-cluster-selection";

/**
 * Selection is the part of this feature most likely to go subtly wrong, so
 * the rules live in pure functions and are tested directly — this repository
 * has no React rendering test setup.
 */

function topic(name: string): TopicSupportingTopic {
  return {
    topic: name,
    relationshipToPillar: "Supports the cluster.",
    rationale: "Useful.",
    searchIntent: "INFORMATIONAL",
    suggestedContentType: "ARTICLE",
    subtopics: [],
    existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
    relatedKeywords: [],
    overlapNote: null,
  };
}

const A1 = topic("Topic A1");
const A2 = topic("Topic A2");
const B1 = topic("Topic B1");

const PLAN: TopicClusterPlanResult = {
  seedTopic: "self storage investing",
  existingClusterNames: [],
  clusters: [
    {
      name: "Cluster A",
      purpose: "",
      pillarRelationship: "",
      searchIntent: null,
      suggestedContentType: null,
      existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
      relatedKeywords: [],
      supportingTopics: [A1, A2],
      contentIdeas: [],
    },
    {
      name: "Cluster B",
      purpose: "",
      pillarRelationship: "",
      searchIntent: null,
      suggestedContentType: null,
      existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
      relatedKeywords: [],
      supportingTopics: [B1],
      contentIdeas: [],
    },
  ],
};

describe("toggleTopic — individual topic selection", () => {
  it("1. selects a topic that was not selected", () => {
    const next = toggleTopic(new Set(), "Cluster A", "Topic A1");
    expect(isTopicSelected(next, "Cluster A", "Topic A1")).toBe(true);
  });

  it("2. deselects a topic that was selected", () => {
    const once = toggleTopic(new Set(), "Cluster A", "Topic A1");
    expect(isTopicSelected(toggleTopic(once, "Cluster A", "Topic A1"), "Cluster A", "Topic A1")).toBe(false);
  });

  it("3. never touches another topic's selection", () => {
    let selected = toggleTopic(new Set(), "Cluster A", "Topic A1");
    selected = toggleTopic(selected, "Cluster A", "Topic A2");
    selected = toggleTopic(selected, "Cluster A", "Topic A1");
    expect(isTopicSelected(selected, "Cluster A", "Topic A2")).toBe(true);
  });

  it("4. the same topic name in two clusters is tracked separately", () => {
    const selected = toggleTopic(new Set(), "Cluster A", "Shared");
    expect(isTopicSelected(selected, "Cluster A", "Shared")).toBe(true);
    expect(isTopicSelected(selected, "Cluster B", "Shared")).toBe(false);
    expect(selectionKey("Cluster A", "Shared")).not.toBe(selectionKey("Cluster B", "Shared"));
  });

  it("5. returns a new set rather than mutating the previous one", () => {
    const original = new Set<string>();
    const next = toggleTopic(original, "Cluster A", "Topic A1");
    expect(original.size).toBe(0);
    expect(next.size).toBe(1);
  });
});

describe("setClusterSelected — cluster-level selection", () => {
  it("6. selecting a cluster selects all of its topics", () => {
    const next = setClusterSelected(new Set(), "Cluster A", [A1, A2], true);
    expect(isTopicSelected(next, "Cluster A", "Topic A1")).toBe(true);
    expect(isTopicSelected(next, "Cluster A", "Topic A2")).toBe(true);
  });

  it("7. clearing a cluster removes only its own topics — never another cluster's", () => {
    let selected = setClusterSelected(new Set(), "Cluster A", [A1, A2], true);
    selected = setClusterSelected(selected, "Cluster B", [B1], true);
    selected = setClusterSelected(selected, "Cluster A", [A1, A2], false);
    expect(isTopicSelected(selected, "Cluster A", "Topic A1")).toBe(false);
    expect(isTopicSelected(selected, "Cluster B", "Topic B1")).toBe(true);
  });

  it("8. selection is never destructive — multiple clusters can be selected at once", () => {
    let selected = setClusterSelected(new Set(), "Cluster A", [A1, A2], true);
    selected = setClusterSelected(selected, "Cluster B", [B1], true);
    expect(summarizeSelection(PLAN, selected).clusterCount).toBe(2);
  });
});

describe("clusterSelectionState — the three checkbox states", () => {
  it("9. none when nothing in the cluster is selected", () => {
    expect(clusterSelectionState(new Set(), "Cluster A", [A1, A2])).toBe("none");
  });

  it("10. partial when some topics are selected", () => {
    const selected = toggleTopic(new Set(), "Cluster A", "Topic A1");
    expect(clusterSelectionState(selected, "Cluster A", [A1, A2])).toBe("partial");
  });

  it("11. all when every topic is selected", () => {
    const selected = setClusterSelected(new Set(), "Cluster A", [A1, A2], true);
    expect(clusterSelectionState(selected, "Cluster A", [A1, A2])).toBe("all");
  });

  it("12. an empty cluster is never reported as fully selected", () => {
    expect(clusterSelectionState(new Set(), "Cluster A", [])).toBe("none");
  });
});

describe("summarizeSelection — the review step", () => {
  it("13. reports nothing when nothing is selected", () => {
    const summary = summarizeSelection(PLAN, new Set());
    expect(summary).toEqual({ clusterCount: 0, topicCount: 0, byCluster: [] });
    expect(canGenerateContent(summary)).toBe(false);
  });

  it("14. counts one cluster and its selected topics", () => {
    const selected = toggleTopic(new Set(), "Cluster A", "Topic A1");
    const summary = summarizeSelection(PLAN, selected);
    expect(summary.clusterCount).toBe(1);
    expect(summary.topicCount).toBe(1);
    expect(canGenerateContent(summary)).toBe(true);
  });

  it("15. supports a PARTIAL selection within a cluster", () => {
    const selected = toggleTopic(new Set(), "Cluster A", "Topic A2");
    const summary = summarizeSelection(PLAN, selected);
    expect(summary.byCluster[0].topics.map((t) => t.topic)).toEqual(["Topic A2"]);
  });

  it("16. spans multiple clusters", () => {
    let selected = toggleTopic(new Set(), "Cluster A", "Topic A1");
    selected = toggleTopic(selected, "Cluster B", "Topic B1");
    const summary = summarizeSelection(PLAN, selected);
    expect(summary.clusterCount).toBe(2);
    expect(summary.topicCount).toBe(2);
  });

  it("17. counts every topic when all are selected", () => {
    let selected = setClusterSelected(new Set(), "Cluster A", [A1, A2], true);
    selected = setClusterSelected(selected, "Cluster B", [B1], true);
    expect(summarizeSelection(PLAN, selected).topicCount).toBe(3);
  });

  it("18. preserves the plan's own order rather than re-sorting", () => {
    let selected = toggleTopic(new Set(), "Cluster B", "Topic B1");
    selected = toggleTopic(selected, "Cluster A", "Topic A1");
    expect(summarizeSelection(PLAN, selected).byCluster.map((g) => g.clusterName)).toEqual(["Cluster A", "Cluster B"]);
  });

  it("19. a STALE key from a previous generation cannot add a phantom topic", () => {
    const selected = new Set([selectionKey("Old Cluster", "Topic that no longer exists")]);
    const summary = summarizeSelection(PLAN, selected);
    expect(summary.topicCount).toBe(0);
    expect(canGenerateContent(summary)).toBe(false);
  });

  it("20. a null plan summarises to nothing rather than throwing", () => {
    expect(summarizeSelection(null, new Set([selectionKey("Cluster A", "Topic A1")])).topicCount).toBe(0);
  });
});
