import { describe, expect, it } from "vitest";

import {
  buildPrompt,
  buildTopicClusterPlanResult,
  containsFabricatedMetric,
  matchProjectKeywords,
  normalizeContentType,
  normalizeSearchIntent,
  topicsSubstantiallyOverlap,
  TOPIC_CLUSTER_PLANNER_SYSTEM_PROMPT,
} from "@/features/ai-workspace/services/topic-cluster-planner.service";
import { adaptLegacyTopicClusterPlan, parseTopicClusterPlanResult } from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";

/**
 * The tenth AI Workspace tool, enhanced to multi-cluster hierarchy.
 *
 * The data-honesty rules matter most: this platform has real values for only
 * a handful of keywords and no ranking, traffic, or Search Console data at
 * all, so any numeric SEO figure in the output would necessarily be invented.
 */

const CTX = {
  seedTopic: "self storage investing",
  keywordTerms: ["self storage investments", "storage unit roi"],
  clusterNames: ["Storage Investing"],
  existingTitles: ["Unlocking Self Storage Investments: Key Insights"],
};

function topic(overrides: Record<string, unknown> = {}) {
  return {
    topic: "How to evaluate a storage facility",
    relationshipToPillar: "Supports the evaluation part of the cluster.",
    rationale: "Buyers need a concrete checklist.",
    searchIntent: "INFORMATIONAL",
    suggestedContentType: "ARTICLE",
    subtopics: ["What to inspect on site", "Which documents to request"],
    ...overrides,
  };
}

function cluster(overrides: Record<string, unknown> = {}) {
  return {
    name: "Evaluating Storage Assets",
    purpose: "Helps investors judge a specific facility before buying.",
    pillarRelationship: "Covers the due-diligence stage of self storage investing.",
    searchIntent: "INFORMATIONAL",
    suggestedContentType: "GUIDE",
    supportingTopics: [topic()],
    contentIdeas: ["Facility inspection checklist"],
    ...overrides,
  };
}

function providerOutput(overrides: Record<string, unknown> = {}) {
  return { clusters: [cluster()], ...overrides };
}

describe("containsFabricatedMetric — unsupported numeric SEO claims", () => {
  it("1. flags invented search volume", () => {
    expect(containsFabricatedMetric("1,200 monthly searches for this term")).toBe(true);
    expect(containsFabricatedMetric("Search volume of 900")).toBe(true);
  });

  it("2. flags invented difficulty scores", () => {
    expect(containsFabricatedMetric("keyword difficulty 42")).toBe(true);
    expect(containsFabricatedMetric("KD: 35")).toBe(true);
  });

  it("3. flags invented rankings and positions", () => {
    expect(containsFabricatedMetric("This page ranks #3 for the term")).toBe(true);
    expect(containsFabricatedMetric("currently ranking position 5")).toBe(true);
  });

  it("4. flags invented traffic, impressions, clicks and backlinks", () => {
    expect(containsFabricatedMetric("drives 4,000 monthly visits")).toBe(true);
    expect(containsFabricatedMetric("12,000 impressions last month")).toBe(true);
    expect(containsFabricatedMetric("CTR of 4")).toBe(true);
    expect(containsFabricatedMetric("has 250 backlinks")).toBe(true);
  });

  it("5. flags invented authority scores", () => {
    expect(containsFabricatedMetric("domain authority 58")).toBe(true);
  });

  it("6. does NOT flag ordinary strategic prose — the filter must not over-reject", () => {
    for (const text of [
      "High commercial intent topic worth prioritising.",
      "This topic drives traffic to the pillar page.",
      "A competitive topic that deserves a thorough guide.",
      "Covers the top 5 considerations for new investors.",
      "Explains the 1031 exchange process.",
      "",
    ]) {
      expect(containsFabricatedMetric(text)).toBe(false);
    }
  });
});

describe("normalizeSearchIntent / normalizeContentType — enum validation, never a guessed fallback", () => {
  it("7. accepts valid values, case- and spacing-insensitively", () => {
    expect(normalizeSearchIntent("informational")).toBe("INFORMATIONAL");
    expect(normalizeContentType("landing page")).toBe("LANDING_PAGE");
    expect(normalizeContentType("Case-Study")).toBe("CASE_STUDY");
  });

  it("8. returns null for an invalid value rather than defaulting to one", () => {
    expect(normalizeSearchIntent("BUYING")).toBeNull();
    expect(normalizeContentType("PODCAST")).toBeNull();
    expect(normalizeSearchIntent(undefined)).toBeNull();
    expect(normalizeContentType(42)).toBeNull();
  });
});

describe("matchProjectKeywords — real project keywords only", () => {
  it("9. matches a real project keyword contained in the topic", () => {
    expect(matchProjectKeywords("Guide to self storage investments today", CTX.keywordTerms)).toEqual(["self storage investments"]);
  });

  it("10. returns nothing when no project keyword relates — never invents an association", () => {
    expect(matchProjectKeywords("Commercial plumbing basics", CTX.keywordTerms)).toEqual([]);
  });

  it("11. an empty project keyword list yields no associations", () => {
    expect(matchProjectKeywords("self storage investments", [])).toEqual([]);
  });
});

describe("topicsSubstantiallyOverlap — the cannibalization safeguard", () => {
  it("12. detects two topics targeting the same need", () => {
    expect(topicsSubstantiallyOverlap("Self storage ROI calculation", "Calculating self storage ROI")).toBe(true);
  });

  it("13. does NOT flag genuinely distinct topics", () => {
    expect(topicsSubstantiallyOverlap("Self storage financing options", "Self storage market trends")).toBe(false);
  });

  it("14. ignores filler words so 'best X guide' and 'X' are not treated as different", () => {
    expect(topicsSubstantiallyOverlap("The best guide to storage unit pricing", "Storage unit pricing")).toBe(true);
  });

  it("15. handles empty input without throwing", () => {
    expect(topicsSubstantiallyOverlap("", "anything")).toBe(false);
  });
});

describe("buildTopicClusterPlanResult — hierarchy", () => {
  it("16. builds clusters containing supporting topics containing subtopics", () => {
    const result = buildTopicClusterPlanResult(providerOutput(), CTX);
    expect(result.seedTopic).toBe("self storage investing");
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].name).toBe("Evaluating Storage Assets");
    expect(result.clusters[0].supportingTopics).toHaveLength(1);
    expect(result.clusters[0].supportingTopics[0].subtopics).toEqual(["What to inspect on site", "Which documents to request"]);
    expect(result.clusters[0].contentIdeas).toEqual(["Facility inspection checklist"]);
  });

  it("17. the hierarchy is not flattened — subtopics never become supporting topics", () => {
    const result = buildTopicClusterPlanResult(providerOutput(), CTX);
    const topics = result.clusters[0].supportingTopics.map((t) => t.topic);
    expect(topics).not.toContain("What to inspect on site");
  });

  it("18. DROPS a cluster with no supporting topics — an empty cluster is not a cluster", () => {
    const result = buildTopicClusterPlanResult(providerOutput({ clusters: [cluster({ supportingTopics: [] })] }), CTX);
    expect(result.clusters).toHaveLength(0);
  });

  it("19. drops duplicate clusters by name, ignoring case and spacing", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({ clusters: [cluster(), cluster({ name: "  evaluating   STORAGE assets " })] }),
      CTX
    );
    expect(result.clusters).toHaveLength(1);
  });

  it("20. de-duplicates supporting topics GLOBALLY across clusters — the same page target must not appear twice", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({
        clusters: [cluster(), cluster({ name: "Second Cluster", supportingTopics: [topic()] })],
      }),
      CTX
    );
    const all = result.clusters.flatMap((c) => c.supportingTopics.map((t) => t.topic));
    expect(new Set(all).size).toBe(all.length);
  });

  it("21. drops a supporting topic that merely restates its own cluster name", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({ clusters: [cluster({ supportingTopics: [topic({ topic: "Evaluating Storage Assets" }), topic()] })] }),
      CTX
    );
    expect(result.clusters[0].supportingTopics.map((t) => t.topic)).toEqual(["How to evaluate a storage facility"]);
  });

  it("22. de-duplicates subtopics and content ideas", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({
        clusters: [cluster({ supportingTopics: [topic({ subtopics: ["Costs", "costs", "  COSTS  ", "Risks"] })], contentIdeas: ["Idea", "idea"] })],
      }),
      CTX
    );
    expect(result.clusters[0].supportingTopics[0].subtopics).toEqual(["Costs", "Risks"]);
    expect(result.clusters[0].contentIdeas).toEqual(["Idea"]);
  });

  it("23. caps clusters, supporting topics, subtopics and content ideas", () => {
    const manyTopics = Array.from({ length: 20 }, (_, i) => topic({ topic: `Distinct topic ${i}` }));
    const manyClusters = Array.from({ length: 12 }, (_, i) =>
      cluster({ name: `Cluster ${i}`, supportingTopics: manyTopics.map((t) => ({ ...t, topic: `${t.topic} c${i}` })), contentIdeas: Array.from({ length: 10 }, (_, j) => `Idea ${i}-${j}`) })
    );
    const result = buildTopicClusterPlanResult(providerOutput({ clusters: manyClusters }), CTX);
    expect(result.clusters.length).toBeLessThanOrEqual(5);
    for (const c of result.clusters) {
      expect(c.supportingTopics.length).toBeLessThanOrEqual(6);
      expect(c.contentIdeas.length).toBeLessThanOrEqual(4);
      for (const t of c.supportingTopics) expect(t.subtopics.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("buildTopicClusterPlanResult — cannibalization notes", () => {
  it("24. flags a near-duplicate supporting topic instead of silently keeping both", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({
        clusters: [
          cluster({
            supportingTopics: [topic({ topic: "Self storage ROI calculation" }), topic({ topic: "Calculating self storage ROI" })],
          }),
        ],
      }),
      CTX
    );
    const topics = result.clusters[0].supportingTopics;
    expect(topics).toHaveLength(2);
    expect(topics[0].overlapNote).toBeNull();
    expect(topics[1].overlapNote).toContain("Potential overlap");
    expect(topics[1].overlapNote).toContain("consider consolidating");
  });

  it("25. names the other cluster when the overlap crosses clusters", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({
        clusters: [
          cluster({ name: "Cluster One", supportingTopics: [topic({ topic: "Self storage ROI calculation" })] }),
          cluster({ name: "Cluster Two", supportingTopics: [topic({ topic: "Calculating self storage ROI" })] }),
        ],
      }),
      CTX
    );
    expect(result.clusters[1].supportingTopics[0].overlapNote).toContain("Cluster One");
  });

  it("26. the overlap note NEVER claims ranking, traffic or cannibalization as fact", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({
        clusters: [cluster({ supportingTopics: [topic({ topic: "Self storage ROI calculation" }), topic({ topic: "Calculating self storage ROI" })] })],
      }),
      CTX
    );
    const note = result.clusters[0].supportingTopics[1].overlapNote ?? "";
    expect(note).not.toMatch(/ranks?|ranking|traffic|cannibaliz/i);
  });

  it("27. distinct topics carry no overlap note", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({
        clusters: [cluster({ supportingTopics: [topic({ topic: "Financing options" }), topic({ topic: "Market trends analysis" })] })],
      }),
      CTX
    );
    for (const t of result.clusters[0].supportingTopics) expect(t.overlapNote).toBeNull();
  });
});

describe("buildTopicClusterPlanResult — grounding", () => {
  it("28. computes existing coverage from REAL content titles, never from the model", () => {
    const result = buildTopicClusterPlanResult(providerOutput({ clusters: [cluster({ name: "Self Storage Investing Guide" })] }), {
      ...CTX,
      existingTitles: ["Self Storage Investing Guide"],
    });
    expect(result.clusters[0].existingCoverage.status).toBe("POSSIBLE_MATCH");
    expect(result.clusters[0].existingCoverage.matchedTitle).toBe("Self Storage Investing Guide");
  });

  it("29. only PARTIAL title overlap does NOT claim coverage — the shared matcher is deliberately conservative", () => {
    const result = buildTopicClusterPlanResult(providerOutput(), CTX);
    expect(result.clusters[0].existingCoverage.status).toBe("NOT_FOUND");
    expect(result.clusters[0].existingCoverage.matchedTitle).toBeNull();
  });

  it("30. associates only REAL project keywords", () => {
    const result = buildTopicClusterPlanResult(providerOutput({ clusters: [cluster({ supportingTopics: [topic({ topic: "self storage investments basics" })] })] }), CTX);
    const related = result.clusters[0].supportingTopics[0].relatedKeywords;
    expect(related).toEqual(["self storage investments"]);
    for (const term of related) expect(CTX.keywordTerms).toContain(term);
  });

  it("31. carries the project's REAL cluster names through, never invented ones", () => {
    expect(buildTopicClusterPlanResult(providerOutput(), CTX).existingClusterNames).toEqual(["Storage Investing"]);
  });

  it("32. a fabricated keyword id, content id or URL supplied by the model never reaches the result", () => {
    const raw = providerOutput({
      clusters: [
        cluster({
          supportingTopics: [
            {
              ...topic(),
              keywordId: "00000000-0000-4000-8000-00000000dead",
              contentId: "00000000-0000-4000-8000-00000000beef",
              url: "https://invented.example.com/page",
            },
          ],
        }),
      ],
    });
    const serialized = JSON.stringify(buildTopicClusterPlanResult(raw, CTX));
    expect(serialized).not.toContain("00000000-0000-4000-8000-00000000dead");
    expect(serialized).not.toContain("00000000-0000-4000-8000-00000000beef");
    expect(serialized).not.toContain("invented.example.com");
  });

  it("33. a supporting topic making an unsupported metric claim is DROPPED whole, never edited", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({
        clusters: [
          cluster({
            supportingTopics: [topic({ topic: "Clean topic" }), topic({ topic: "Storage ROI", rationale: "This term gets 2,400 monthly searches." })],
          }),
        ],
      }),
      CTX
    );
    expect(result.clusters[0].supportingTopics.map((t) => t.topic)).toEqual(["Clean topic"]);
    expect(JSON.stringify(result)).not.toContain("2,400");
  });

  it("34. a cluster making a ranking claim is dropped rather than shown", () => {
    const result = buildTopicClusterPlanResult(providerOutput({ clusters: [cluster({ purpose: "This cluster ranks #1 nationally." })] }), CTX);
    expect(result.clusters).toHaveLength(0);
  });

  it("35. a subtopic or content idea making a metric claim is removed while the topic survives", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({
        clusters: [cluster({ supportingTopics: [topic({ subtopics: ["Costs", "Gets 5,000 monthly searches"] })], contentIdeas: ["Idea", "Ranks #2 already"] })],
      }),
      CTX
    );
    expect(result.clusters[0].supportingTopics[0].subtopics).toEqual(["Costs"]);
    expect(result.clusters[0].contentIdeas).toEqual(["Idea"]);
  });

  it("36. keeps a topic whose classifications are invalid, recording them as null rather than guessing", () => {
    const result = buildTopicClusterPlanResult(
      providerOutput({ clusters: [cluster({ supportingTopics: [topic({ searchIntent: "BUYING", suggestedContentType: "PODCAST" })] })] }),
      CTX
    );
    expect(result.clusters[0].supportingTopics[0].searchIntent).toBeNull();
    expect(result.clusters[0].supportingTopics[0].suggestedContentType).toBeNull();
  });

  it("37. malformed model output yields an honest empty plan, never a throw or a fabricated one", () => {
    for (const bad of [null, undefined, "not an object", [], {}, { clusters: "wrong" }]) {
      const result = buildTopicClusterPlanResult(bad, CTX);
      expect(result.clusters).toEqual([]);
      expect(result.seedTopic).toBe(CTX.seedTopic);
    }
  });
});

describe("buildTopicClusterPlanResult — sparse project data", () => {
  it("38. a project with no keywords, clusters or content still produces a usable plan", () => {
    const result = buildTopicClusterPlanResult(providerOutput(), { seedTopic: "x topic", keywordTerms: [], clusterNames: [], existingTitles: [] });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].relatedKeywords).toEqual([]);
    expect(result.clusters[0].existingCoverage.status).toBe("NOT_FOUND");
    expect(result.existingClusterNames).toEqual([]);
  });
});

describe("adaptLegacyTopicClusterPlan — the first-release shape still opens", () => {
  const LEGACY = {
    seedTopic: "self storage investing",
    pillar: {
      topic: "Self Storage Investing",
      description: "A complete guide.",
      searchIntent: "INFORMATIONAL",
      suggestedContentType: "GUIDE",
      existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
      relatedKeywords: ["self storage investments"],
    },
    supportingTopics: [
      {
        topic: "Evaluating a facility",
        searchIntent: null,
        suggestedContentType: null,
        relationshipToPillar: "Supports the pillar.",
        rationale: "Useful.",
        existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
        relatedKeywords: [],
      },
    ],
    existingClusterNames: ["Storage Investing"],
  };

  it("39. presents an old single-pillar plan as one cluster rather than discarding it", () => {
    const adapted = adaptLegacyTopicClusterPlan(LEGACY);
    expect(adapted).not.toBeNull();
    expect(adapted!.clusters).toHaveLength(1);
    expect(adapted!.clusters[0].name).toBe("Self Storage Investing");
    expect(adapted!.clusters[0].supportingTopics[0].topic).toBe("Evaluating a facility");
  });

  it("40. invents nothing the old shape never had", () => {
    const adapted = adaptLegacyTopicClusterPlan(LEGACY)!;
    expect(adapted.clusters[0].contentIdeas).toEqual([]);
    expect(adapted.clusters[0].supportingTopics[0].subtopics).toEqual([]);
    expect(adapted.clusters[0].supportingTopics[0].overlapNote).toBeNull();
  });

  it("41. returns null for the CURRENT shape, so the caller uses the current parser", () => {
    expect(adaptLegacyTopicClusterPlan({ seedTopic: "x", clusters: [], existingClusterNames: [] })).toBeNull();
  });

  it("42. returns null for malformed input", () => {
    for (const bad of [null, undefined, "x", 42, {}]) expect(adaptLegacyTopicClusterPlan(bad)).toBeNull();
  });
});

describe("prompt grounding", () => {
  const FULL_CTX = {
    seoProjectId: "p",
    companyId: "c",
    seoProjectName: "Storage Moguls",
    domain: "storagemoguls.com",
    seedTopic: "self storage investing",
    keywordTerms: CTX.keywordTerms,
    clusterNames: CTX.clusterNames,
    existingTitles: CTX.existingTitles,
  };

  it("43. the system prompt forbids inventing metrics, rankings, URLs and keyword identity", () => {
    for (const phrase of ["search volume", "keyword difficulty", "ranking position", "traffic figure", "backlink count", "Never invent a URL"]) {
      expect(TOPIC_CLUSTER_PLANNER_SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it("44. the system prompt forbids promising performance outcomes (SEO/GEO/AEO honesty)", () => {
    expect(TOPIC_CLUSTER_PLANNER_SYSTEM_PROMPT).toContain("Never promise a ranking, a featured snippet, AI-assistant visibility, or any performance outcome");
  });

  it("45. the system prompt defines the hierarchy explicitly and forbids flattening or padding", () => {
    for (const phrase of ["A CLUSTER is", "A SUPPORTING TOPIC is", "A SUBTOPIC is", "A CONTENT IDEA is", "never pad the plan"]) {
      expect(TOPIC_CLUSTER_PLANNER_SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it("46. the prompt labels the primary topic as USER-PROVIDED and project records as real", () => {
    const prompt = buildPrompt(FULL_CTX);
    expect(prompt).toContain("USER-PROVIDED PRIMARY TOPIC");
    expect(prompt).toContain("real records from this customer's account");
    expect(prompt).toContain("No search volume, keyword difficulty, ranking, traffic, or competitor data is available");
  });

  it("47. the prompt states plainly when a project has no keywords, clusters or content", () => {
    const prompt = buildPrompt({ ...FULL_CTX, keywordTerms: [], clusterNames: [], existingTitles: [] });
    expect(prompt).toContain("Existing tracked keywords: none recorded");
    expect(prompt).toContain("Existing keyword clusters: none recorded");
    expect(prompt).toContain("Existing content titles: none recorded");
  });

  it("48. the prompt never asks for ids, URLs or metrics", () => {
    expect(buildPrompt(FULL_CTX)).toContain("Do not include any keyword ids, content ids, URLs, or numeric SEO metrics");
  });

  it("49. Brand Profile context is used when present and simply absent when not", () => {
    const withBrand = buildPrompt(FULL_CTX, { brandVoice: "Direct and practical", targetAudience: "Investors" } as never);
    expect(withBrand).toContain("Brand voice: Direct and practical");
    expect(withBrand).toContain("Brand Profile audience: Investors");
    expect(buildPrompt(FULL_CTX, null)).not.toContain("Brand voice:");
  });
});

/**
 * Reading a stored job result back.
 *
 * Browser verification caught a real bug here: `clusters` carries
 * `.default([])`, so the CURRENT schema parses a first-release payload
 * happily — into a plan with zero clusters — and a real, already paid-for plan
 * was silently shown as though nothing had been returned. These tests pin the
 * dispatch order that fixes it.
 */
describe("parseTopicClusterPlanResult — reads whichever shape was stored", () => {
  const LEGACY_STORED = {
    seedTopic: "self storage investing",
    pillar: {
      topic: "Self Storage Investing",
      description: "A complete guide.",
      searchIntent: "INFORMATIONAL",
      suggestedContentType: "GUIDE",
      existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
      relatedKeywords: [],
    },
    supportingTopics: [
      {
        topic: "Evaluating a facility",
        searchIntent: null,
        suggestedContentType: null,
        relationshipToPillar: "Supports the pillar.",
        rationale: "Useful.",
        existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
        relatedKeywords: [],
      },
    ],
    existingClusterNames: [],
  };

  it("50. REGRESSION — a first-release payload is NOT read as an empty current-shape plan", () => {
    const parsed = parseTopicClusterPlanResult(LEGACY_STORED);
    expect(parsed).not.toBeNull();
    expect(parsed!.clusters.length).toBeGreaterThan(0);
    expect(parsed!.clusters[0].supportingTopics[0].topic).toBe("Evaluating a facility");
  });

  it("51. a current-shape plan is returned as-is", () => {
    const current = {
      seedTopic: "x",
      existingClusterNames: [],
      clusters: [
        {
          name: "C",
          purpose: "",
          pillarRelationship: "",
          searchIntent: null,
          suggestedContentType: null,
          existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
          relatedKeywords: [],
          contentIdeas: [],
          supportingTopics: [],
        },
      ],
    };
    expect(parseTopicClusterPlanResult(current)!.clusters).toHaveLength(1);
  });

  it("52. a genuinely empty current-shape result stays empty — an honest nothing-usable outcome", () => {
    const parsed = parseTopicClusterPlanResult({ seedTopic: "x", clusters: [], existingClusterNames: [] });
    expect(parsed).not.toBeNull();
    expect(parsed!.clusters).toEqual([]);
  });

  it("53. malformed input returns null so the caller can show a neutral error", () => {
    for (const bad of [null, undefined, "x", 42, {}]) expect(parseTopicClusterPlanResult(bad)).toBeNull();
  });
});
