import { describe, expect, it } from "vitest";

import {
  buildCalendarRequest,
  computeCanGenerateCalendar,
  SELECT_PROJECT_HINT,
  TOPIC_SOURCE_LABELS,
  type ProjectPlanningData,
} from "@/features/ai-workspace/components/ContentCalendarPicker";
import { formatCalendarAsText, validateEditedEntries } from "@/features/ai-workspace/components/ContentCalendarReview";
import { CALENDAR_NULL_RESULT_MESSAGE, type ContentCalendarResult, type ProposedCalendarEntry } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { buildCalendarEntryBriefHandoff, buildBriefNotesFromCalendarEntry, mapCalendarTypeToBriefType } from "@/features/ai-workspace/services/calendar-entry-to-brief";
import { buildBriefHandoffHref, parseBriefHandoffParams } from "@/features/ai-workspace/services/content-gap-to-brief";

/**
 * This repository has no React rendering test setup (vitest runs
 * `environment: "node"`), so the picker's and review screen's real logic is
 * tested as pure functions — the same approach every other AI Workspace
 * picker uses.
 */

const PROJECT_ID = "01a002a5-ffa5-705e-9731-806267514305";
const CLUSTER_ID = "01a002a5-ffa5-705e-9731-8062675143aa";

const WITH_DATA: ProjectPlanningData = { keywordCount: 12, contentCount: 4, clusters: [{ id: CLUSTER_ID, name: "Storage investing", keywordCount: 5 }] };
const WITHOUT_DATA: ProjectPlanningData = { keywordCount: 0, contentCount: 0, clusters: [] };

const BASE = {
  seoProjectId: PROJECT_ID,
  name: "Q4 plan",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  topicSource: "PROJECT_DATA" as const,
  userTopics: "",
  keywordClusterId: "",
  planningData: WITH_DATA,
};

const ENTRIES: ProposedCalendarEntry[] = [
  {
    scheduledDate: "2026-10-01",
    topic: "Pillar page",
    contentType: "GUIDE",
    role: "PILLAR",
    keywordId: "kw-1",
    keywordTerm: "self storage investing",
    notes: "Cover the fundamentals.",
    overlapNote: null,
    existingContentTitle: null,
  },
  {
    scheduledDate: "2026-10-08",
    topic: "Supporting page",
    contentType: "ARTICLE",
    role: "SUPPORTING",
    keywordId: null,
    keywordTerm: null,
    notes: "",
    overlapNote: "Looks close to another planned piece.",
    existingContentTitle: "An older article",
  },
];

const RESULT: ContentCalendarResult = {
  name: "Q4 plan",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  cadence: "WEEKLY",
  entries: ENTRIES,
  reasoning: "Pillar first.",
  droppedForLackOfSlots: 0,
};

describe("computeCanGenerateCalendar — the Generate gate", () => {
  it("1. enabled with a project, a name, a valid range and project data to plan from", () => {
    expect(computeCanGenerateCalendar(BASE)).toBe(true);
  });

  it("2. blocked with no project — the tool never defaults to one", () => {
    expect(computeCanGenerateCalendar({ ...BASE, seoProjectId: "" })).toBe(false);
    expect(computeCanGenerateCalendar({ ...BASE, seoProjectId: "  " })).toBe(false);
  });

  it("3. blocked with no calendar name", () => {
    expect(computeCanGenerateCalendar({ ...BASE, name: "   " })).toBe(false);
  });

  it("4. blocked with a missing, impossible or reversed date range", () => {
    expect(computeCanGenerateCalendar({ ...BASE, startDate: "", endDate: "" })).toBe(false);
    expect(computeCanGenerateCalendar({ ...BASE, startDate: "2026-02-30" })).toBe(false);
    expect(computeCanGenerateCalendar({ ...BASE, startDate: "2026-12-31", endDate: "2026-10-01" })).toBe(false);
  });

  it("5. blocked when planning from project data the project does not have", () => {
    expect(computeCanGenerateCalendar({ ...BASE, planningData: WITHOUT_DATA })).toBe(false);
    expect(computeCanGenerateCalendar({ ...BASE, planningData: undefined })).toBe(false);
  });

  it("6. enabled from project data when the project has only keywords, or only pages", () => {
    expect(computeCanGenerateCalendar({ ...BASE, planningData: { ...WITHOUT_DATA, keywordCount: 3 } })).toBe(true);
    expect(computeCanGenerateCalendar({ ...BASE, planningData: { ...WITHOUT_DATA, contentCount: 3 } })).toBe(true);
  });

  it("7. user-topic mode needs topics, and ignores whether the project has data", () => {
    expect(computeCanGenerateCalendar({ ...BASE, topicSource: "USER_TOPICS", planningData: WITHOUT_DATA })).toBe(false);
    expect(computeCanGenerateCalendar({ ...BASE, topicSource: "USER_TOPICS", userTopics: "  \n ", planningData: WITHOUT_DATA })).toBe(false);
    expect(computeCanGenerateCalendar({ ...BASE, topicSource: "USER_TOPICS", userTopics: "A topic", planningData: WITHOUT_DATA })).toBe(true);
  });

  it("8. cluster mode needs a cluster chosen", () => {
    expect(computeCanGenerateCalendar({ ...BASE, topicSource: "TOPIC_CLUSTER" })).toBe(false);
    expect(computeCanGenerateCalendar({ ...BASE, topicSource: "TOPIC_CLUSTER", keywordClusterId: CLUSTER_ID })).toBe(true);
  });
});

describe("buildCalendarRequest", () => {
  const form = { ...BASE, cadence: "WEEKLY" as const, audience: "  Investors  ", notes: "  Keep it tight  ", planningData: undefined };

  it("9. trims what the user typed and drops blank optional fields", () => {
    const request = buildCalendarRequest({ ...form, name: "  Q4 plan  " });
    expect(request.name).toBe("Q4 plan");
    expect(request.audience).toBe("Investors");
    expect(request.notes).toBe("Keep it tight");
  });

  it("10. sends userTopics only in user-topic mode", () => {
    expect(buildCalendarRequest({ ...form, userTopics: "A topic" }).userTopics).toBeUndefined();
    expect(buildCalendarRequest({ ...form, topicSource: "USER_TOPICS", userTopics: "A topic" }).userTopics).toBe("A topic");
  });

  it("11. sends keywordClusterId only in cluster mode", () => {
    expect(buildCalendarRequest({ ...form, keywordClusterId: CLUSTER_ID }).keywordClusterId).toBeUndefined();
    expect(buildCalendarRequest({ ...form, topicSource: "TOPIC_CLUSTER", keywordClusterId: CLUSTER_ID }).keywordClusterId).toBe(CLUSTER_ID);
  });

  it("12. carries no company or ownership value", () => {
    expect(JSON.stringify(buildCalendarRequest(form))).not.toMatch(/companyId|userId|role"|isOwner/i);
  });
});

describe("validateEditedEntries — the same rules the server enforces", () => {
  it("13. accepts a valid edited schedule", () => {
    const { entryErrors, formError } = validateEditedEntries(ENTRIES, "2026-10-01", "2026-12-31");
    expect(formError).toBeNull();
    expect(entryErrors).toEqual({});
  });

  it("14. refuses an empty schedule", () => {
    expect(validateEditedEntries([], "2026-10-01", "2026-12-31").formError).toMatch(/at least one entry/i);
  });

  it("15. flags an entry with no topic", () => {
    const edited = [{ ...ENTRIES[0], topic: "   " }];
    expect(validateEditedEntries(edited, "2026-10-01", "2026-12-31").entryErrors[0]).toMatch(/needs a topic/i);
  });

  it("16. flags an impossible date", () => {
    const edited = [{ ...ENTRIES[0], scheduledDate: "2026-02-30" }];
    expect(validateEditedEntries(edited, "2026-10-01", "2026-12-31").entryErrors[0]).toMatch(/not a real date/i);
  });

  it("17. flags a date the user edited to fall outside the range", () => {
    const edited = [{ ...ENTRIES[0], scheduledDate: "2027-03-01" }];
    expect(validateEditedEntries(edited, "2026-10-01", "2026-12-31").entryErrors[0]).toMatch(/outside the calendar/i);
  });

  it("18. flags a duplicate topic on the SECOND occurrence, not the first", () => {
    const edited = [ENTRIES[0], { ...ENTRIES[1], topic: "  pillar   PAGE " }];
    const { entryErrors } = validateEditedEntries(edited, "2026-10-01", "2026-12-31");
    expect(entryErrors[0]).toBeUndefined();
    expect(entryErrors[1]).toMatch(/already on the calendar/i);
  });

  it("19. allows two different topics on the same date", () => {
    const edited = [ENTRIES[0], { ...ENTRIES[1], scheduledDate: ENTRIES[0].scheduledDate }];
    expect(validateEditedEntries(edited, "2026-10-01", "2026-12-31").entryErrors).toEqual({});
  });

  it("20. reports a broken calendar range at the form level", () => {
    expect(validateEditedEntries(ENTRIES, "2026-12-31", "2026-10-01").formError).toMatch(/cannot be before/i);
  });
});

describe("formatCalendarAsText — the Copy output", () => {
  it("21. leads with the calendar name, range and rhythm", () => {
    const text = formatCalendarAsText(RESULT, ENTRIES);
    expect(text).toContain("Q4 plan");
    expect(text).toContain("2026-10-01 to 2026-12-31 · Once a week");
  });

  it("22. lists every entry with its date, role and type", () => {
    const text = formatCalendarAsText(RESULT, ENTRIES);
    expect(text).toContain("2026-10-01  [Pillar] Pillar page");
    expect(text).toContain("Type: Guide");
    expect(text).toContain("2026-10-08  [Supporting] Supporting page");
  });

  it("23. includes real keyword targets and planning notes", () => {
    const text = formatCalendarAsText(RESULT, ENTRIES);
    expect(text).toContain("Target keyword: self storage investing");
    expect(text).toContain("Notes: Cover the fundamentals.");
  });

  it("24. carries the overlap warnings through, hedged", () => {
    const text = formatCalendarAsText(RESULT, ENTRIES);
    expect(text).toContain("Check: Looks close to another planned piece.");
    expect(text).toContain('Possible existing page: "An older article" (title match only)');
  });

  it("25. never includes the reviewer-only reasoning", () => {
    expect(formatCalendarAsText(RESULT, ENTRIES)).not.toContain("Pillar first.");
  });

  it("26. never leaks ids or provider names", () => {
    const text = formatCalendarAsText(RESULT, ENTRIES);
    expect(text).not.toMatch(/kw-1|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/gemini|openrouter|ollama|jobId/i);
  });

  it("27. contains no fabricated metric", () => {
    expect(formatCalendarAsText(RESULT, ENTRIES)).not.toMatch(/search volume|monthly searches|ranks #|traffic|impressions/i);
  });
});

describe("calendar entry → Content Brief hand-off", () => {
  const entry = {
    scheduledDate: "2026-10-01",
    topic: "Pillar page",
    contentType: "GUIDE",
    role: "PILLAR",
    keywordTerm: "self storage investing",
    notes: "Cover the fundamentals.",
  };

  it("28. maps the types with an honest Brief equivalent, and OTHER for the rest", () => {
    expect(mapCalendarTypeToBriefType("ARTICLE")).toBe("BLOG_POST");
    expect(mapCalendarTypeToBriefType("GUIDE")).toBe("PILLAR_PAGE");
    expect(mapCalendarTypeToBriefType("LANDING_PAGE")).toBe("LANDING_PAGE");
    for (const type of ["FAQ_PAGE", "CASE_STUDY", "COMPARISON", "OTHER"]) {
      expect(mapCalendarTypeToBriefType(type)).toBe("OTHER");
    }
    expect(mapCalendarTypeToBriefType(null)).toBeNull();
    expect(mapCalendarTypeToBriefType("WEBINAR")).toBeNull();
  });

  it("29. carries the planned role into the notes, so a supporting page is not written as a pillar", () => {
    expect(buildBriefNotesFromCalendarEntry(entry)).toMatch(/planned as a pillar page/i);
    expect(buildBriefNotesFromCalendarEntry({ ...entry, role: "SUPPORTING" })).toMatch(/rather than repeating the pillar/i);
  });

  it("30. carries the date, keyword and notes, and labels the plan as a plan", () => {
    const notes = buildBriefNotesFromCalendarEntry(entry);
    expect(notes).toContain("Scheduled for: 2026-10-01");
    expect(notes).toContain("Target keyword for this page: self storage investing");
    expect(notes).toContain("Planning notes: Cover the fundamentals.");
    expect(notes).toMatch(/a plan, not a measurement/);
  });

  it("31. states no metric FIGURE, and says outright that it carries none", () => {
    const notes = buildBriefNotesFromCalendarEntry(entry);
    // A metric word beside a number is a claim; the disclaimer below uses the
    // same words precisely to say no such data exists, so the check is for
    // figures rather than for the vocabulary.
    expect(notes).not.toMatch(/\d[\d,.]*\s*(?:searches|impressions|clicks|visits)|ranks?\s*#?\d|volume\s*(?:of|is|:)?\s*\d/i);
    expect(notes).toMatch(/carries no ranking, traffic or search-volume data/);
  });

  it("32. declines when there is no project or no topic", () => {
    expect(buildCalendarEntryBriefHandoff("", entry)).toBeNull();
    expect(buildCalendarEntryBriefHandoff(PROJECT_ID, { ...entry, topic: "  " })).toBeNull();
  });

  it("33. round-trips through the EXISTING Brief route contract — no second mechanism", () => {
    const handoff = buildCalendarEntryBriefHandoff(PROJECT_ID, entry)!;
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
    expect(parsed.notes).toContain("Pillar page");
  });

  it("34. carries ids and editable text only — never company, ownership or authority", () => {
    const handoff = buildCalendarEntryBriefHandoff(PROJECT_ID, entry)!;
    expect(Object.keys(handoff).sort()).toEqual(["contentType", "notes", "seoProjectId"]);
    expect(JSON.stringify(handoff)).not.toMatch(/companyId|userId|role"|isOwner|calendarId|entryId/i);
  });
});

describe("user-facing messages", () => {
  it("35. the project hint prompts a choice rather than claiming a problem", () => {
    expect(SELECT_PROJECT_HINT).toMatch(/Select an SEO project/);
    expect(SELECT_PROJECT_HINT).not.toMatch(/error|invalid|failed/i);
  });

  it("36. the topic-source labels describe real sources, not AI capability", () => {
    expect(TOPIC_SOURCE_LABELS.PROJECT_DATA).toMatch(/keywords and existing pages/i);
    expect(TOPIC_SOURCE_LABELS.TOPIC_CLUSTER).toMatch(/topic clusters/i);
    expect(TOPIC_SOURCE_LABELS.USER_TOPICS).toMatch(/type myself/i);
  });

  it("37. the null-result message blames the response, not the user's input", () => {
    expect(CALENDAR_NULL_RESULT_MESSAGE).toMatch(/didn't meet our requirements/);
    expect(CALENDAR_NULL_RESULT_MESSAGE).not.toMatch(/your topics|your project|not enough/i);
  });
});
