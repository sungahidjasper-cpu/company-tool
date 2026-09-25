import { describe, expect, it } from "vitest";

import type { CompetitorOpportunity } from "@/features/ai-workspace/schemas/competitor-content-analysis.schema";
import { buildBriefHandoffHref, parseBriefHandoffParams } from "@/features/ai-workspace/services/content-gap-to-brief";
import {
  buildBriefNotesFromCompetitorOpportunity,
  buildCompetitorOpportunityBriefHandoff,
  mapCompetitorFormatToBriefType,
} from "@/features/ai-workspace/services/competitor-opportunity-to-brief";

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";

const OPPORTUNITY: CompetitorOpportunity = {
  topic: "How to evaluate a self storage facility before buying",
  whyItMatters: "The competitor covers facility evaluation in depth and your project has no equivalent page.",
  suggestedContentType: "GUIDE",
  recommendedAction: "Write a practical evaluation checklist aimed at first-time buyers.",
  existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
  relatedKeywords: ["self storage investments"],
};

describe("mapCompetitorFormatToBriefType", () => {
  it("1. maps the formats with an honest Brief equivalent", () => {
    expect(mapCompetitorFormatToBriefType("ARTICLE")).toBe("BLOG_POST");
    expect(mapCompetitorFormatToBriefType("GUIDE")).toBe("PILLAR_PAGE");
    expect(mapCompetitorFormatToBriefType("LANDING_PAGE")).toBe("LANDING_PAGE");
  });

  it("2. maps formats with no honest equivalent to OTHER rather than forcing a wrong shape", () => {
    for (const format of ["FAQ_PAGE", "CASE_STUDY", "COMPARISON", "PRODUCT_PAGE", "OTHER"]) {
      expect(mapCompetitorFormatToBriefType(format)).toBe("OTHER");
    }
  });

  it("3. returns null — not a guessed default — when there is no suggestion", () => {
    expect(mapCompetitorFormatToBriefType(null)).toBeNull();
    expect(mapCompetitorFormatToBriefType(undefined)).toBeNull();
    expect(mapCompetitorFormatToBriefType("")).toBeNull();
  });

  it("4. returns null for a value outside the enum instead of inventing one", () => {
    expect(mapCompetitorFormatToBriefType("WEBINAR")).toBeNull();
  });
});

describe("buildBriefNotesFromCompetitorOpportunity", () => {
  it("5. leads with the opportunity topic", () => {
    expect(buildBriefNotesFromCompetitorOpportunity(OPPORTUNITY)).toContain(
      "Content opportunity identified from competitor analysis: How to evaluate a self storage facility before buying"
    );
  });

  it("6. names the competitor sites and says only a sample was read", () => {
    const notes = buildBriefNotesFromCompetitorOpportunity(OPPORTUNITY, ["https://competitor.com"]);
    expect(notes).toContain("Competitor sites reviewed (a sample of pages was read from each): https://competitor.com");
  });

  it("7. omits the competitor line entirely when no origins are supplied", () => {
    expect(buildBriefNotesFromCompetitorOpportunity(OPPORTUNITY)).not.toContain("Competitor sites reviewed");
  });

  it("8. labels the opportunity as a recommendation, not a measurement", () => {
    expect(buildBriefNotesFromCompetitorOpportunity(OPPORTUNITY)).toContain("is an AI recommendation");
    expect(buildBriefNotesFromCompetitorOpportunity(OPPORTUNITY)).toContain("not a ranking or traffic measurement");
  });

  it("9. hedges existing coverage as a title match and never claims the topic is covered", () => {
    const matched = { ...OPPORTUNITY, existingCoverage: { status: "POSSIBLE_MATCH" as const, matchedTitle: "Facility Evaluation Basics" } };
    const notes = buildBriefNotesFromCompetitorOpportunity(matched);
    expect(notes).toContain('Potential existing coverage: "Facility Evaluation Basics" (title match only');
    expect(notes).not.toMatch(/already covered|fully covered|ranks for/i);
  });

  it("10. carries only real related keywords", () => {
    expect(buildBriefNotesFromCompetitorOpportunity(OPPORTUNITY)).toContain("Related existing keywords in this project: self storage investments");
    expect(buildBriefNotesFromCompetitorOpportunity({ ...OPPORTUNITY, relatedKeywords: [] })).not.toContain("Related existing keywords");
  });

  it("11. omits empty optional fields rather than writing null or a placeholder", () => {
    const bare: CompetitorOpportunity = {
      topic: "A bare topic",
      whyItMatters: "",
      suggestedContentType: null,
      recommendedAction: "",
      existingCoverage: { status: "NOT_FOUND", matchedTitle: null },
      relatedKeywords: [],
    };
    const notes = buildBriefNotesFromCompetitorOpportunity(bare);
    expect(notes).not.toContain("null");
    expect(notes).not.toContain("Why it matters");
    expect(notes).not.toContain("Recommended action");
  });

  it("12. fabricates no metric of any kind", () => {
    expect(buildBriefNotesFromCompetitorOpportunity(OPPORTUNITY, ["https://competitor.com"])).not.toMatch(
      /search volume|monthly searches|impressions|backlinks|domain authority|ranks #|traffic estimate/i
    );
  });
});

describe("buildCompetitorOpportunityBriefHandoff", () => {
  it("13. builds a hand-off carrying the project id, notes and mapped content type", () => {
    const handoff = buildCompetitorOpportunityBriefHandoff(PROJECT_ID, OPPORTUNITY, ["https://competitor.com"]);
    expect(handoff).not.toBeNull();
    expect(handoff!.seoProjectId).toBe(PROJECT_ID);
    expect(handoff!.contentType).toBe("PILLAR_PAGE");
    expect(handoff!.notes).toContain("How to evaluate a self storage facility");
  });

  it("14. omits contentType when the opportunity carried no usable format", () => {
    const handoff = buildCompetitorOpportunityBriefHandoff(PROJECT_ID, { ...OPPORTUNITY, suggestedContentType: null });
    expect(handoff).not.toBeNull();
    expect(handoff!.contentType).toBeUndefined();
  });

  it("15. declines (null) with no project, so a brief can never start unscoped", () => {
    expect(buildCompetitorOpportunityBriefHandoff("", OPPORTUNITY)).toBeNull();
    expect(buildCompetitorOpportunityBriefHandoff("   ", OPPORTUNITY)).toBeNull();
  });

  it("16. declines (null) for an opportunity with no usable topic", () => {
    expect(buildCompetitorOpportunityBriefHandoff(PROJECT_ID, { ...OPPORTUNITY, topic: "   " })).toBeNull();
  });

  it("17. round-trips through the EXISTING Brief route contract — no second mechanism", () => {
    const handoff = buildCompetitorOpportunityBriefHandoff(PROJECT_ID, OPPORTUNITY, ["https://competitor.com"])!;
    const href = buildBriefHandoffHref(handoff);
    expect(href.startsWith("/ai/content-brief/new?")).toBe(true);

    const params = new URL(href, "https://example.test").searchParams;
    const parsed = parseBriefHandoffParams({
      seoProjectId: params.get("seoProjectId") ?? undefined,
      notes: params.get("notes") ?? undefined,
      contentType: params.get("contentType") ?? undefined,
    });
    expect(parsed.seoProjectId).toBe(PROJECT_ID);
    expect(parsed.contentType).toBe("PILLAR_PAGE");
    expect(parsed.notes).toContain("How to evaluate a self storage facility");
  });

  it("18. the hand-off carries ids and editable text only — never company, ownership or authority", () => {
    const handoff = buildCompetitorOpportunityBriefHandoff(PROJECT_ID, OPPORTUNITY, ["https://competitor.com"])!;
    expect(Object.keys(handoff).sort()).toEqual(["contentType", "notes", "seoProjectId"]);
    const serialized = JSON.stringify(handoff);
    expect(serialized).not.toMatch(/companyId|userId|role|isOwner|jobId/i);
  });
});
