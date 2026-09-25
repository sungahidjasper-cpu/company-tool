import { describe, expect, it } from "vitest";

import { parseIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import {
  buildContentCalendarResult,
  buildPrompt,
  CONTENT_CALENDAR_SYSTEM_PROMPT,
  normalizeCalendarContentType,
  normalizeCalendarRole,
  resolveKeywordByTerm,
  type CalendarKeyword,
  type ContentCalendarContext,
} from "@/features/ai-workspace/services/content-calendar.service";

const KEYWORDS: CalendarKeyword[] = [
  { id: "kw-1", term: "self storage investing", intent: "INFORMATIONAL" },
  { id: "kw-2", term: "storage unit sizes", intent: "COMMERCIAL" },
];

const CTX: ContentCalendarContext = {
  seoProjectId: "01a002a5-ffa5-705e-9731-806267514305",
  companyId: "00000000-0000-0000-0000-000000000001",
  seoProjectName: "Storage Moguls",
  domain: "https://www.storagemoguls.com/",
  calendarName: "Q4 plan",
  range: { start: parseIsoDate("2026-10-01")!, end: parseIsoDate("2026-10-31")! },
  cadence: "WEEKLY",
  slotCount: 5,
  keywords: KEYWORDS,
  existingContentTitles: ["How Self Storage Investing Works"],
  clusterName: null,
  clusterKeywordTerms: [],
  userTopics: [],
};

const VALID = {
  items: [
    { topic: "Evaluating a storage facility", contentType: "GUIDE", role: "PILLAR", primaryKeywordTerm: "self storage investing", rationale: "Foundational.", notes: "" },
    { topic: "Choosing the right unit size", contentType: "ARTICLE", role: "SUPPORTING", primaryKeywordTerm: "storage unit sizes", rationale: "Common question.", notes: "Include a table." },
  ],
  reasoning: "Pillar first, then a supporting piece that links back to it.",
};

describe("CONTENT_CALENDAR_SYSTEM_PROMPT", () => {
  it("1. tells the model it is not choosing dates", () => {
    expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toMatch(/You are NOT choosing dates/);
    expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toMatch(/Never write a date, a day, a week number, a month or a deadline/i);
  });

  it("2. forbids inventing identifiers of any kind", () => {
    expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toMatch(/Do not return a content id, keyword id, cluster id or database id/i);
  });

  it("3. requires keywords to be named by exact supplied text", () => {
    expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toMatch(/name it using the EXACT keyword text supplied/i);
    expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toMatch(/leave it empty rather than inventing one/i);
  });

  it("4. forbids every metric the platform has no data for", () => {
    for (const forbidden of ["search volume", "keyword difficulty", "ranking", "traffic", "click count", "impression count", "conversion rate"]) {
      expect(CONTENT_CALENDAR_SYSTEM_PROMPT.toLowerCase()).toContain(forbidden);
    }
  });

  it("5. forbids promising a ranking or traffic outcome", () => {
    expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toMatch(/Never promise that publishing something will improve rankings or traffic/i);
  });

  it("6. defines the three roles explicitly", () => {
    for (const role of ["PILLAR", "SUPPORTING", "RELATED"]) {
      expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toContain(role);
    }
  });

  it("7. tells the model not to plan two competing pages", () => {
    expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toMatch(/Do not plan two pieces that would compete for the same search intent/i);
  });

  it("8. treats user-supplied topics as the plan", () => {
    expect(CONTENT_CALENDAR_SYSTEM_PROMPT).toMatch(/those are the plan/i);
  });
});

describe("normalizeCalendarContentType / normalizeCalendarRole", () => {
  it("9. accepts the real vocabulary, case- and spacing-insensitively", () => {
    expect(normalizeCalendarContentType("guide")).toBe("GUIDE");
    expect(normalizeCalendarContentType("landing page")).toBe("LANDING_PAGE");
    expect(normalizeCalendarRole("pillar")).toBe("PILLAR");
  });

  it("10. falls back to OTHER / RELATED for anything unrecognised — never a guessed specific value", () => {
    expect(normalizeCalendarContentType("tweet")).toBe("OTHER");
    expect(normalizeCalendarContentType(null)).toBe("OTHER");
    expect(normalizeCalendarContentType(42)).toBe("OTHER");
    expect(normalizeCalendarRole("hero")).toBe("RELATED");
    expect(normalizeCalendarRole(null)).toBe("RELATED");
  });
});

describe("resolveKeywordByTerm — ids come from the database, never from the model", () => {
  it("11. resolves an exact supplied term to its real keyword row", () => {
    expect(resolveKeywordByTerm("self storage investing", KEYWORDS)?.id).toBe("kw-1");
  });

  it("12. is case- and whitespace-insensitive on the term itself", () => {
    expect(resolveKeywordByTerm("  Self Storage Investing  ", KEYWORDS)?.id).toBe("kw-1");
  });

  it("13. refuses a term that is not a real project keyword — no fuzzy guessing", () => {
    expect(resolveKeywordByTerm("storage", KEYWORDS)).toBeNull();
    expect(resolveKeywordByTerm("self storage investing tips", KEYWORDS)).toBeNull();
  });

  it("14. refuses empty or non-string terms", () => {
    expect(resolveKeywordByTerm("", KEYWORDS)).toBeNull();
    expect(resolveKeywordByTerm("   ", KEYWORDS)).toBeNull();
    expect(resolveKeywordByTerm(null, KEYWORDS)).toBeNull();
    expect(resolveKeywordByTerm({ id: "kw-1" }, KEYWORDS)).toBeNull();
  });
});

describe("buildPrompt — real data, user input and the request kept separate", () => {
  it("15. states how many slots exist and forbids dates", () => {
    const prompt = buildPrompt(CTX);
    expect(prompt).toContain("Publishing slots available: 5");
    expect(prompt).toMatch(/Do NOT write any dates/);
  });

  it("16. lists the project's REAL keywords and says no metrics were supplied", () => {
    const prompt = buildPrompt(CTX);
    expect(prompt).toContain("REAL PROJECT KEYWORDS");
    expect(prompt).toContain("self storage investing (intent: INFORMATIONAL)");
    expect(prompt).toContain("no metrics are supplied");
  });

  it("17. lists existing pages so the plan does not repeat them", () => {
    expect(buildPrompt(CTX)).toContain("How Self Storage Investing Works");
  });

  it("18. states plainly when the project has no keywords, rather than leaving a gap", () => {
    const prompt = buildPrompt({ ...CTX, keywords: [] });
    expect(prompt).toMatch(/this project has no keywords yet — leave primaryKeywordTerm empty/i);
  });

  it("19. includes the chosen cluster's real name and terms when one was chosen", () => {
    const prompt = buildPrompt({ ...CTX, clusterName: "Storage investing", clusterKeywordTerms: ["cap rate", "occupancy"] });
    expect(prompt).toContain("Cluster: Storage investing");
    expect(prompt).toContain("cap rate, occupancy");
  });

  it("20. says so when the chosen cluster has no keywords attached", () => {
    expect(buildPrompt({ ...CTX, clusterName: "Empty cluster", clusterKeywordTerms: [] })).toMatch(/no keywords attached yet/i);
  });

  it("21. presents user-supplied topics as the plan to order, not replace", () => {
    const prompt = buildPrompt({ ...CTX, userTopics: ["My first topic", "My second topic"] });
    expect(prompt).toMatch(/TOPICS THE USER SUPPLIED \(these are the plan — order them, do not replace them\)/);
    expect(prompt).toContain("- My first topic");
  });

  it("22. closes by forbidding dates, ids, invented keywords and metrics", () => {
    expect(buildPrompt(CTX)).toContain("No dates. No ids. No invented keywords. No metrics, rankings or traffic claims.");
  });
});

describe("buildContentCalendarResult — dates are assigned, never accepted", () => {
  it("23. assigns real slot dates in the model's proposed ORDER", () => {
    const result = buildContentCalendarResult(VALID, CTX)!;
    expect(result.entries.map((entry) => entry.scheduledDate)).toEqual(["2026-10-01", "2026-10-08"]);
    expect(result.entries[0].topic).toBe("Evaluating a storage facility");
  });

  it("24. IGNORES any date the model tries to supply", () => {
    const withDates = {
      ...VALID,
      items: VALID.items.map((item) => ({ ...item, scheduledDate: "2030-01-01", date: "2030-01-01" })),
    };
    const result = buildContentCalendarResult(withDates, CTX)!;
    expect(result.entries.map((entry) => entry.scheduledDate)).toEqual(["2026-10-01", "2026-10-08"]);
    expect(JSON.stringify(result)).not.toContain("2030");
  });

  it("25. IGNORES any id the model tries to supply", () => {
    const withIds = {
      ...VALID,
      items: VALID.items.map((item) => ({ ...item, contentId: "fake-content", keywordId: "fake-keyword", id: "fake-id" })),
    };
    const result = buildContentCalendarResult(withIds, CTX)!;
    expect(JSON.stringify(result)).not.toMatch(/fake-content|fake-keyword|fake-id/);
    // The keyword id present is the REAL one, resolved from the term.
    expect(result.entries[0].keywordId).toBe("kw-1");
  });

  it("26. resolves keyword links from the term and drops an invented keyword", () => {
    const result = buildContentCalendarResult(
      { ...VALID, items: [{ ...VALID.items[0], primaryKeywordTerm: "a keyword that does not exist" }] },
      CTX
    )!;
    expect(result.entries[0].keywordId).toBeNull();
    expect(result.entries[0].keywordTerm).toBeNull();
  });

  it("27. never exceeds the available slots, and reports what did not fit", () => {
    const many = { ...VALID, items: Array.from({ length: 9 }, (_, i) => ({ ...VALID.items[0], topic: `Topic ${i}`, primaryKeywordTerm: "" })) };
    const result = buildContentCalendarResult(many, { ...CTX, slotCount: 5 })!;
    expect(result.entries).toHaveLength(5);
    expect(result.droppedForLackOfSlots).toBe(4);
  });

  it("28. reports zero dropped when everything fits", () => {
    expect(buildContentCalendarResult(VALID, CTX)!.droppedForLackOfSlots).toBe(0);
  });

  it("29. echoes the range and cadence the APPLICATION decided", () => {
    const result = buildContentCalendarResult(VALID, CTX)!;
    expect(result.startDate).toBe("2026-10-01");
    expect(result.endDate).toBe("2026-10-31");
    expect(result.cadence).toBe("WEEKLY");
    expect(result.name).toBe("Q4 plan");
  });
});

describe("buildContentCalendarResult — malformed and fabricated output", () => {
  it("30. rejects a non-object, a missing items array or a blank reasoning", () => {
    expect(buildContentCalendarResult(null, CTX)).toBeNull();
    expect(buildContentCalendarResult({ reasoning: "r" }, CTX)).toBeNull();
    expect(buildContentCalendarResult({ items: VALID.items, reasoning: "  " }, CTX)).toBeNull();
  });

  it("31. rejects a plan whose every item is unusable", () => {
    expect(buildContentCalendarResult({ items: [], reasoning: "r" }, CTX)).toBeNull();
    expect(buildContentCalendarResult({ items: [null, { topic: "   " }, { notTopic: 1 }], reasoning: "r" }, CTX)).toBeNull();
  });

  it("32. skips a malformed item but keeps the good ones", () => {
    const result = buildContentCalendarResult({ items: [null, VALID.items[0], { topic: 5 }], reasoning: "r" }, CTX)!;
    expect(result.entries).toHaveLength(1);
  });

  it("33. drops an item whose topic fabricates a metric", () => {
    const result = buildContentCalendarResult(
      { items: [{ ...VALID.items[0], topic: "The keyword with 12,000 monthly searches" }, VALID.items[1]], reasoning: "r" },
      CTX
    )!;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].topic).toBe("Choosing the right unit size");
  });

  it("34. keeps the item but clears NOTES that fabricate a metric", () => {
    const result = buildContentCalendarResult(
      { items: [{ ...VALID.items[0], notes: "This ranks #1 already." }], reasoning: "r" },
      CTX
    )!;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].notes).toBe("");
  });

  it("35. drops an exact duplicate topic rather than scheduling it twice", () => {
    const result = buildContentCalendarResult(
      { items: [VALID.items[0], { ...VALID.items[0], topic: "  evaluating A storage FACILITY " }], reasoning: "r" },
      CTX
    )!;
    expect(result.entries).toHaveLength(1);
  });

  it("36. returns null when the range and cadence leave no slots", () => {
    expect(buildContentCalendarResult(VALID, { ...CTX, slotCount: 0 })).toBeNull();
  });
});

describe("buildContentCalendarResult — cannibalisation is flagged, never deleted", () => {
  it("37. flags two planned topics that substantially overlap, keeping both", () => {
    const result = buildContentCalendarResult(
      {
        items: [
          { ...VALID.items[0], topic: "Choosing a storage unit size", primaryKeywordTerm: "" },
          { ...VALID.items[0], topic: "How to choose storage unit size", primaryKeywordTerm: "" },
        ],
        reasoning: "r",
      },
      CTX
    )!;
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].overlapNote).toMatch(/Looks close to another planned piece/);
    expect(result.entries[1].overlapNote).toMatch(/Looks close to another planned piece/);
  });

  it("38. flags two pieces targeting the SAME keyword, even when the wording differs", () => {
    const result = buildContentCalendarResult(
      {
        items: [
          { ...VALID.items[0], topic: "Facility evaluation checklist", primaryKeywordTerm: "self storage investing" },
          { ...VALID.items[0], topic: "Why we like this asset class", primaryKeywordTerm: "self storage investing" },
        ],
        reasoning: "r",
      },
      CTX
    )!;
    expect(result.entries).toHaveLength(2);
    for (const entry of result.entries) {
      expect(entry.overlapNote).toContain('also targets the keyword "self storage investing"');
    }
  });

  it("39. leaves genuinely distinct topics unflagged", () => {
    const result = buildContentCalendarResult(VALID, CTX)!;
    expect(result.entries.every((entry) => entry.overlapNote === null)).toBe(true);
  });

  it("40. flags a topic that looks close to an EXISTING page, hedged as a title match", () => {
    const result = buildContentCalendarResult(
      { items: [{ ...VALID.items[0], topic: "How self storage investing works", primaryKeywordTerm: "" }], reasoning: "r" },
      CTX
    )!;
    expect(result.entries[0].existingContentTitle).toBe("How Self Storage Investing Works");
  });

  it("41. reports no existing-page match when there is none", () => {
    expect(buildContentCalendarResult(VALID, CTX)!.entries.every((entry) => entry.existingContentTitle === null)).toBe(true);
  });

  it("42. keeps pillar and supporting roles distinct on the result", () => {
    const result = buildContentCalendarResult(VALID, CTX)!;
    expect(result.entries.map((entry) => entry.role)).toEqual(["PILLAR", "SUPPORTING"]);
  });

  it("43. stores no AI reasoning on the entries themselves", () => {
    const result = buildContentCalendarResult(VALID, CTX)!;
    for (const entry of result.entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "contentType",
        "existingContentTitle",
        "keywordId",
        "keywordTerm",
        "notes",
        "overlapNote",
        "role",
        "scheduledDate",
        "topic",
      ]);
    }
  });
});
