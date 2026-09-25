import { describe, expect, it } from "vitest";

import {
  buildBriefHandoff,
  buildBriefHandoffHref,
  buildBriefNotesFromOpportunity,
  mapGapContentTypeToBriefType,
  parseBriefHandoffParams,
} from "@/features/ai-workspace/services/content-gap-to-brief";
import type { ContentGapOpportunity } from "@/features/ai-workspace/schemas/content-gap-analysis.schema";

/**
 * Phase C2 — the Content Gap Analysis → Content Brief hand-off.
 *
 * These cover the deterministic mapping and the prefill payload only. The
 * hand-off carries no authority: the values below are form prefills, and the
 * server re-derives project/company ownership on every subsequent call (the
 * B1 checks in content-brief.actions.ts remain the boundary, and their own
 * tests are unchanged).
 */
const OPPORTUNITY: ContentGapOpportunity = {
  topic: "Local Business Pages",
  opportunity: "Dedicated pages for specific locations focusing on local market trends.",
  reason: "Creating location-specific pages can improve local SEO.",
  relatedCluster: "Investment Opportunities",
  existingCoverageStatus: "NOT_FOUND",
  matchedExistingTitle: null,
  suggestedContentType: "LANDING_PAGE",
  recommendedNextAction: null,
};

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";

describe("mapGapContentTypeToBriefType — C2.3 deterministic mapping", () => {
  it("1. maps each Content Gap type to the agreed Brief type", () => {
    expect(mapGapContentTypeToBriefType("ARTICLE")).toBe("BLOG_POST");
    expect(mapGapContentTypeToBriefType("FAQ_PAGE")).toBe("OTHER");
    expect(mapGapContentTypeToBriefType("LANDING_PAGE")).toBe("LANDING_PAGE");
    expect(mapGapContentTypeToBriefType("CASE_STUDY")).toBe("OTHER");
  });

  it("2. returns null when the opportunity carried no format suggestion — never guesses a default", () => {
    expect(mapGapContentTypeToBriefType(null)).toBeNull();
    expect(mapGapContentTypeToBriefType(undefined)).toBeNull();
    expect(mapGapContentTypeToBriefType("")).toBeNull();
  });

  it("3. returns null for an unrecognised value rather than coercing it", () => {
    expect(mapGapContentTypeToBriefType("PODCAST")).toBeNull();
    expect(mapGapContentTypeToBriefType("BLOG_POST")).toBeNull();
  });

  it("4. is pure and deterministic — the same input always yields the same output", () => {
    expect(mapGapContentTypeToBriefType("ARTICLE")).toBe(mapGapContentTypeToBriefType("ARTICLE"));
  });
});

describe("buildBriefNotesFromOpportunity — the editable topic carrier", () => {
  it("5. carries the topic, opportunity, reason and cluster as readable text", () => {
    const notes = buildBriefNotesFromOpportunity(OPPORTUNITY);
    expect(notes).toContain("Local Business Pages");
    expect(notes).toContain("Dedicated pages for specific locations");
    expect(notes).toContain("Why it matters: Creating location-specific pages");
    expect(notes).toContain("Related keyword cluster: Investment Opportunities");
  });

  it("6. omits the cluster line entirely when there is none — never prints null", () => {
    const notes = buildBriefNotesFromOpportunity({ ...OPPORTUNITY, relatedCluster: null });
    expect(notes).not.toContain("Related keyword cluster");
    expect(notes).not.toMatch(/null|undefined/);
  });

  it("7. restates no coverage status or metric claim as fact", () => {
    const notes = buildBriefNotesFromOpportunity(OPPORTUNITY);
    expect(notes).not.toMatch(/NOT_FOUND|POSSIBLE_MATCH|search volume|ranking|traffic|competitor/i);
  });
});

describe("buildBriefHandoff — the prefill payload", () => {
  it("8. carries the SELECTED project id forward unchanged", () => {
    expect(buildBriefHandoff(PROJECT_ID, OPPORTUNITY)?.seoProjectId).toBe(PROJECT_ID);
  });

  it("9. carries the opportunity text and the mapped content type", () => {
    const handoff = buildBriefHandoff(PROJECT_ID, OPPORTUNITY);
    expect(handoff?.notes).toContain("Local Business Pages");
    expect(handoff?.contentType).toBe("LANDING_PAGE");
  });

  it("10. omits contentType when the opportunity had no format suggestion, leaving the user to choose", () => {
    const handoff = buildBriefHandoff(PROJECT_ID, { ...OPPORTUNITY, suggestedContentType: null });
    expect(handoff).not.toBeNull();
    expect(handoff).not.toHaveProperty("contentType");
  });

  it("11. refuses a malformed opportunity — no topic means no hand-off at all", () => {
    expect(buildBriefHandoff(PROJECT_ID, { ...OPPORTUNITY, topic: "" })).toBeNull();
    expect(buildBriefHandoff(PROJECT_ID, { ...OPPORTUNITY, topic: "   " })).toBeNull();
  });

  it("12. refuses a hand-off with no project selected", () => {
    expect(buildBriefHandoff("", OPPORTUNITY)).toBeNull();
    expect(buildBriefHandoff("   ", OPPORTUNITY)).toBeNull();
  });

  it("13. never carries company identity, project name, domain or actor identity", () => {
    const serialised = JSON.stringify(buildBriefHandoff(PROJECT_ID, OPPORTUNITY));
    expect(serialised).not.toMatch(/companyId|companyName|projectName|domain|actorId|userId/i);
  });
});

describe("buildBriefHandoffHref / parseBriefHandoffParams — round trip", () => {
  it("14. round-trips the project, notes and content type through the query string", () => {
    const handoff = buildBriefHandoff(PROJECT_ID, OPPORTUNITY)!;
    const href = buildBriefHandoffHref(handoff);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    const parsed = parseBriefHandoffParams(params);
    expect(parsed.seoProjectId).toBe(PROJECT_ID);
    expect(parsed.notes).toBe(handoff.notes);
    expect(parsed.contentType).toBe("LANDING_PAGE");
  });

  it("15. targets the existing Brief route — no new route is introduced", () => {
    expect(buildBriefHandoffHref(buildBriefHandoff(PROJECT_ID, OPPORTUNITY)!)).toMatch(/^\/ai\/content-brief\/new\?/);
  });

  it("16. drops an unrecognised contentType rather than accepting it", () => {
    expect(parseBriefHandoffParams({ seoProjectId: PROJECT_ID, notes: "x", contentType: "PODCAST" }).contentType).toBeNull();
    expect(parseBriefHandoffParams({ seoProjectId: PROJECT_ID, notes: "x", contentType: "ARTICLE" }).contentType).toBeNull();
  });

  it("17. tolerates entirely absent params — a direct visit prefills nothing", () => {
    expect(parseBriefHandoffParams({})).toEqual({ seoProjectId: "", notes: "", contentType: null });
  });

  it("18. a hand-crafted URL can only ever prefill fields — it carries no ownership signal to parse", () => {
    const parsed = parseBriefHandoffParams({ seoProjectId: "someone-elses-project", notes: "n", contentType: "LANDING_PAGE" });
    // The id is returned verbatim for the form to preselect; the route filters
    // it against the actor's own project list, and the server re-verifies
    // ownership on generate and save regardless.
    expect(parsed.seoProjectId).toBe("someone-elses-project");
    expect(Object.keys(parsed).sort()).toEqual(["contentType", "notes", "seoProjectId"]);
  });
});
