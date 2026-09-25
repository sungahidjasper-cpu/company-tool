import { describe, expect, it } from "vitest";

import type { TopicSupportingTopic } from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";
import { buildBriefHandoffHref } from "@/features/ai-workspace/services/content-gap-to-brief";
import {
  buildBriefNotesFromTopic,
  buildTopicBriefHandoff,
  mapTopicContentTypeToBriefType,
} from "@/features/ai-workspace/services/topic-cluster-to-brief";

/**
 * Topic Cluster Planner → the EXISTING Content Brief workflow.
 *
 * The hand-off carries form prefills only. It reuses BriefHandoff and
 * buildBriefHandoffHref rather than inventing a second contract, and the
 * Brief's own action re-derives company ownership server-side, so nothing
 * here can widen what the user may generate against.
 */

const PROJECT = "00000000-0000-4000-8000-0000000000f0";

function topic(overrides: Partial<TopicSupportingTopic> = {}): TopicSupportingTopic {
  return {
    topic: "How to evaluate a storage facility",
    relationshipToPillar: "Covers the due-diligence stage.",
    rationale: "Buyers need a concrete checklist.",
    searchIntent: "INFORMATIONAL",
    suggestedContentType: "ARTICLE",
    subtopics: ["What to inspect on site", "Which documents to request"],
    existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
    relatedKeywords: ["self storage investments"],
    overlapNote: null,
    ...overrides,
  };
}

const SELECTION = { primaryTopic: "self storage investing", clusterName: "Evaluating Storage Assets", topic: topic() };

describe("mapTopicContentTypeToBriefType — reuse the existing Brief enum", () => {
  it("1. maps types with an honest equivalent", () => {
    expect(mapTopicContentTypeToBriefType("ARTICLE")).toBe("BLOG_POST");
    expect(mapTopicContentTypeToBriefType("GUIDE")).toBe("PILLAR_PAGE");
    expect(mapTopicContentTypeToBriefType("LANDING_PAGE")).toBe("LANDING_PAGE");
  });

  it("2. maps types with no equivalent to OTHER rather than forcing a misleading shape", () => {
    expect(mapTopicContentTypeToBriefType("FAQ_PAGE")).toBe("OTHER");
    expect(mapTopicContentTypeToBriefType("CASE_STUDY")).toBe("OTHER");
    expect(mapTopicContentTypeToBriefType("COMPARISON")).toBe("OTHER");
  });

  it("3. returns null when nothing was suggested — no prefill, never a guessed default", () => {
    expect(mapTopicContentTypeToBriefType(null)).toBeNull();
    expect(mapTopicContentTypeToBriefType(undefined)).toBeNull();
    expect(mapTopicContentTypeToBriefType("PODCAST")).toBeNull();
  });
});

describe("buildBriefNotesFromTopic — the hierarchy survives the hand-off", () => {
  it("4. carries primary topic, cluster and target topic", () => {
    const notes = buildBriefNotesFromTopic(SELECTION);
    expect(notes).toContain("Primary topic: self storage investing");
    expect(notes).toContain("Topic cluster: Evaluating Storage Assets");
    expect(notes).toContain("Target topic for this page: How to evaluate a storage facility");
  });

  it("5. carries subtopics, intent and real related keywords", () => {
    const notes = buildBriefNotesFromTopic(SELECTION);
    expect(notes).toContain("What to inspect on site");
    expect(notes).toContain("Suggested search intent: INFORMATIONAL");
    expect(notes).toContain("Related existing keywords in this project: self storage investments");
  });

  it("6. carries the user's audience when supplied, and omits it otherwise", () => {
    expect(buildBriefNotesFromTopic({ ...SELECTION, audience: "First-time investors" })).toContain("Target audience: First-time investors");
    expect(buildBriefNotesFromTopic(SELECTION)).not.toContain("Target audience:");
  });

  it("7. hedges existing coverage rather than asserting it", () => {
    const notes = buildBriefNotesFromTopic({
      ...SELECTION,
      topic: topic({ existingCoverage: { status: "POSSIBLE_MATCH", matchedTitle: "Storage Facility Basics" } }),
    });
    expect(notes).toContain("Potential existing coverage");
    expect(notes).toContain("title match only");
    expect(notes).not.toMatch(/ranks?|already covered/i);
  });

  it("8. OMITS the overlap note — that is planning guidance, not a fact about the page being briefed", () => {
    const notes = buildBriefNotesFromTopic({ ...SELECTION, topic: topic({ overlapNote: "Potential overlap with \"Other topic\"" }) });
    expect(notes).not.toContain("Potential overlap");
  });

  it("9. omits absent fields rather than printing empty labels", () => {
    const notes = buildBriefNotesFromTopic({
      ...SELECTION,
      topic: topic({ subtopics: [], relatedKeywords: [], searchIntent: null, rationale: "" }),
    });
    expect(notes).not.toContain("Subtopics to cover");
    expect(notes).not.toContain("Related existing keywords");
    expect(notes).not.toContain("Suggested search intent");
    expect(notes).not.toContain("Why it matters");
  });

  it("10. never leaks ids, URLs or metrics into the brief notes", () => {
    const notes = buildBriefNotesFromTopic(SELECTION);
    expect(notes).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(notes).not.toMatch(/https?:\/\//);
    expect(notes).not.toMatch(/(?:companyId|seoProjectId|keywordId|contentId)/i);
  });
});

describe("buildTopicBriefHandoff — one brief per page", () => {
  it("11. builds a hand-off carrying the project id, notes and mapped content type", () => {
    const handoff = buildTopicBriefHandoff(PROJECT, SELECTION);
    expect(handoff).not.toBeNull();
    expect(handoff!.seoProjectId).toBe(PROJECT);
    expect(handoff!.contentType).toBe("BLOG_POST");
    expect(handoff!.notes).toContain("Target topic for this page");
  });

  it("12. omits contentType entirely when nothing usable was suggested", () => {
    const handoff = buildTopicBriefHandoff(PROJECT, { ...SELECTION, topic: topic({ suggestedContentType: null }) });
    expect(handoff).not.toBeNull();
    expect(handoff).not.toHaveProperty("contentType");
  });

  it("13. declines to build a hand-off from an unusable selection", () => {
    expect(buildTopicBriefHandoff("", SELECTION)).toBeNull();
    expect(buildTopicBriefHandoff(PROJECT, { ...SELECTION, topic: topic({ topic: "   " }) })).toBeNull();
    expect(buildTopicBriefHandoff(PROJECT, { ...SELECTION, primaryTopic: "  " })).toBeNull();
  });

  it("14. targets the EXISTING Content Brief route via the shared builder — no second hand-off contract", () => {
    const href = buildBriefHandoffHref(buildTopicBriefHandoff(PROJECT, SELECTION)!);
    expect(href).toMatch(/^\/ai\/content-brief\/new\?/);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("seoProjectId")).toBe(PROJECT);
    expect(params.get("contentType")).toBe("BLOG_POST");
    expect(params.get("notes")).toContain("Target topic for this page");
  });

  it("15. the hand-off carries no company identity or ownership claim", () => {
    const href = buildBriefHandoffHref(buildTopicBriefHandoff(PROJECT, SELECTION)!);
    const keys = [...new URL(href, "http://x").searchParams.keys()].sort();
    expect(keys).toEqual(["contentType", "notes", "seoProjectId"]);
    expect(href).not.toMatch(/companyId|actorId|userId/i);
  });
});
