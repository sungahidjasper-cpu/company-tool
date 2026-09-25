import { describe, expect, it } from "vitest";

import {
  buildContentOptimizerHandoff,
  buildEmailNewsletterHref,
  buildContentRewriterHref,
  buildInternalLinkAnalyzerHref,
  buildMetaTagOptimizerHref,
  buildSchemaMarkupHref,
  buildSocialSnippetHref,
  canOfferContentOptimizerActions,
  canOfferContentRewrite,
  canOfferInternalLinkAnalysis,
  parseContentOptimizerParams,
  resolveContentOptimizerSelection,
} from "@/features/ai-workspace/services/content-optimizer-handoff";

/**
 * Phase C4.1 — the Content → Meta Tag Optimizer contextual hand-off.
 *
 * The hand-off is navigation only. These tests pin the resolution step, which
 * is the defence-in-depth layer in front of the actions' own checks: the route
 * resolves a requested id against its OWN company-scoped, non-soft-deleted
 * query, so a foreign, wrong-project or trashed id is silently dropped rather
 * than preselected. `applyMetaTagSuggestionAction` and
 * `startMetaTagOptimizerAction` still re-verify company + project +
 * soft-delete server-side, and their existing tests remain unchanged.
 */
const PROJECT_A = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_B = "00000000-0000-4000-8000-0000000000b2";
const CONTENT_IN_A = "00000000-0000-4000-8000-00000000c001";
const CONTENT_IN_B = "00000000-0000-4000-8000-00000000c002";

/** Mirrors what the route derives: company-scoped and already excluding soft-deleted rows. */
const OWN_PROJECT_IDS = [PROJECT_A, PROJECT_B];
const OWN_CONTENT_BY_PROJECT = {
  [PROJECT_A]: [{ id: CONTENT_IN_A }],
  [PROJECT_B]: [{ id: CONTENT_IN_B }],
};

describe("buildContentOptimizerHandoff / buildMetaTagOptimizerHref", () => {
  it("1. builds a hand-off carrying only the two ids", () => {
    const handoff = buildContentOptimizerHandoff(PROJECT_A, CONTENT_IN_A);
    expect(handoff).toEqual({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
  });

  it("2. declines to build one when either id is missing, so no action is rendered", () => {
    expect(buildContentOptimizerHandoff("", CONTENT_IN_A)).toBeNull();
    expect(buildContentOptimizerHandoff(PROJECT_A, "")).toBeNull();
    expect(buildContentOptimizerHandoff("  ", "  ")).toBeNull();
  });

  it("3. targets the EXISTING Meta Tag Optimizer route — no new route is introduced", () => {
    const href = buildMetaTagOptimizerHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect(href).toMatch(/^\/ai\/meta-tag-optimizer\/new\?/);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("seoProjectId")).toBe(PROJECT_A);
    expect(params.get("contentId")).toBe(CONTENT_IN_A);
  });

  it("4. never carries company identity, actor identity, or any content field value", () => {
    const href = buildMetaTagOptimizerHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect(href).not.toMatch(/companyId|companyName|projectName|domain|actorId|userId|metaTitle|metaDescription/i);
  });

  it("5. round-trips through the query string", () => {
    const href = buildMetaTagOptimizerHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    const parsed = parseContentOptimizerParams(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(parsed).toEqual({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
  });

  it("6. tolerates absent params — a direct visit preselects nothing", () => {
    expect(parseContentOptimizerParams({})).toEqual({ seoProjectId: "", contentId: "" });
  });
});

describe("resolveContentOptimizerSelection — preselection is resolved against the actor's own data", () => {
  it("7. OWN content in its OWN project is preselected", () => {
    const resolved = resolveContentOptimizerSelection({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A }, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT);
    expect(resolved).toEqual({ seoProjectId: PROJECT_A, contentIds: [CONTENT_IN_A] });
  });

  it("8. ANOTHER COMPANY's project id is dropped entirely — it is absent from the actor's options", () => {
    const resolved = resolveContentOptimizerSelection(
      { seoProjectId: "00000000-0000-4000-8000-0000000000ff", contentId: CONTENT_IN_A },
      OWN_PROJECT_IDS,
      OWN_CONTENT_BY_PROJECT
    );
    expect(resolved).toEqual({ seoProjectId: "", contentIds: [] });
  });

  it("9. ANOTHER COMPANY's content id is not preselected, even under an owned project", () => {
    const resolved = resolveContentOptimizerSelection(
      { seoProjectId: PROJECT_A, contentId: "00000000-0000-4000-8000-00000000cfff" },
      OWN_PROJECT_IDS,
      OWN_CONTENT_BY_PROJECT
    );
    expect(resolved).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });

  it("10. PROJECT MISMATCH — content belonging to another project is not preselected", () => {
    const resolved = resolveContentOptimizerSelection({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_B }, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT);
    expect(resolved).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });

  it("11. SOFT-DELETED content is not preselected — the route's own query excludes it, so it is simply absent", () => {
    // A trashed row never appears in contentByProject; requesting it resolves to no selection.
    const resolved = resolveContentOptimizerSelection({ seoProjectId: PROJECT_A, contentId: "trashed-row" }, OWN_PROJECT_IDS, { [PROJECT_A]: [] });
    expect(resolved).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });

  it("12. preselects at most the ONE requested record — never a bulk selection", () => {
    const resolved = resolveContentOptimizerSelection({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A }, OWN_PROJECT_IDS, {
      [PROJECT_A]: [{ id: CONTENT_IN_A }, { id: "another" }, { id: "yet-another" }],
    });
    expect(resolved.contentIds).toEqual([CONTENT_IN_A]);
  });

  it("13. an empty request preselects nothing (a direct visit to the tool)", () => {
    expect(resolveContentOptimizerSelection({ seoProjectId: "", contentId: "" }, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({
      seoProjectId: "",
      contentIds: [],
    });
  });

  it("14. a project with no content resolves to the project only, so the user still lands in the right place", () => {
    const resolved = resolveContentOptimizerSelection({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A }, OWN_PROJECT_IDS, {});
    expect(resolved).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });
});

describe("canOfferContentOptimizerActions — when the action is shown at all", () => {
  const LIVE = { canManage: true, contentDeletedAt: null, projectDeletedAt: null };

  it("15. offered for a live record in a live project", () => {
    expect(canOfferContentOptimizerActions(LIVE)).toBe(true);
  });

  it("16. NOT offered for a soft-deleted Content record", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, contentDeletedAt: new Date("2026-08-12") })).toBe(false);
  });

  it("17. NOT offered when the owning PROJECT is soft-deleted — browser verification found a live row under a trashed project, where the tool cannot preselect it and the action would dead-end", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, projectDeletedAt: new Date("2026-08-12") })).toBe(false);
  });

  it("18. NOT offered without manage permission", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, canManage: false })).toBe(false);
  });

  it("19. eligibility does NOT depend on generatedByAi — a manually-authored page is a valid optimization target", () => {
    // The input has no generatedByAi field at all, by design.
    expect(Object.keys(LIVE).sort()).toEqual(["canManage", "contentDeletedAt", "projectDeletedAt"]);
    expect(canOfferContentOptimizerActions(LIVE)).toBe(true);
  });
});

/**
 * Phase C4.2 — the Content → Content Rewriter contextual hand-off.
 *
 * Same navigation-only contract as C4.1, reusing the same helpers, with one
 * extra rule: the Rewriter needs an existing body to rewrite.
 */
describe("buildContentRewriterHref", () => {
  it("20. targets the EXISTING Content Rewriter route — no new route is introduced", () => {
    const href = buildContentRewriterHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect(href).toMatch(/^\/ai\/content-rewriter\/new\?/);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("seoProjectId")).toBe(PROJECT_A);
    expect(params.get("contentId")).toBe(CONTENT_IN_A);
  });

  it("21. carries the ids only — never company identity, actor identity, or any content field value", () => {
    const href = buildContentRewriterHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect(href).not.toMatch(/companyId|companyName|projectName|domain|actorId|userId|title|body/i);
    expect([...new URL(href, "http://x").searchParams.keys()].sort()).toEqual(["contentId", "seoProjectId"]);
  });

  it("22. round-trips through the same parser as the Meta Tag Optimizer — one shared parameter contract", () => {
    const href = buildContentRewriterHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    const parsed = parseContentOptimizerParams(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(parsed).toEqual({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    // Resolves against the actor's own data exactly like the C4.1 hand-off.
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({
      seoProjectId: PROJECT_A,
      contentIds: [CONTENT_IN_A],
    });
  });

  it("23. a Rewriter hand-off for ANOTHER COMPANY's project resolves to no selection", () => {
    const href = buildContentRewriterHref({ seoProjectId: "00000000-0000-4000-8000-0000000000ff", contentId: CONTENT_IN_A });
    const parsed = parseContentOptimizerParams(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({ seoProjectId: "", contentIds: [] });
  });
});

describe("canOfferContentRewrite — HAS_ARTICLE plus the shared eligibility rule", () => {
  const LIVE_WITH_BODY = { canManage: true, contentDeletedAt: null, projectDeletedAt: null, body: "An existing article body." };

  it("24. offered for a live record, in a live project, that has a body", () => {
    expect(canOfferContentRewrite(LIVE_WITH_BODY)).toBe(true);
  });

  it("25. NOT offered for a BRIEF_ONLY record — a null body has nothing to rewrite", () => {
    expect(canOfferContentRewrite({ ...LIVE_WITH_BODY, body: null })).toBe(false);
  });

  it("26. NOT offered for an empty or whitespace-only body — matches the rule the Rewriter route and action both enforce", () => {
    expect(canOfferContentRewrite({ ...LIVE_WITH_BODY, body: "" })).toBe(false);
    expect(canOfferContentRewrite({ ...LIVE_WITH_BODY, body: "   \n\t " })).toBe(false);
  });

  it("27. eligibility does NOT depend on generatedByAi — manually created content is rewritable too", () => {
    // No generatedByAi field is accepted at all, by design.
    expect(Object.keys(LIVE_WITH_BODY).sort()).toEqual(["body", "canManage", "contentDeletedAt", "projectDeletedAt"]);
    expect(canOfferContentRewrite(LIVE_WITH_BODY)).toBe(true);
  });

  it("28. NOT offered for a soft-deleted Content record, even with a body", () => {
    expect(canOfferContentRewrite({ ...LIVE_WITH_BODY, contentDeletedAt: new Date("2026-08-12") })).toBe(false);
  });

  it("29. NOT offered when the owning PROJECT is trashed — the Rewriter cannot preselect it, so the action would dead-end", () => {
    expect(canOfferContentRewrite({ ...LIVE_WITH_BODY, projectDeletedAt: new Date("2026-08-12") })).toBe(false);
  });

  it("30. NOT offered without manage permission", () => {
    expect(canOfferContentRewrite({ ...LIVE_WITH_BODY, canManage: false })).toBe(false);
  });
});

/**
 * Phase C4.3 — the Content → Schema Markup Generator contextual hand-off.
 *
 * Same ids-only navigation contract as C4.1/C4.2, resolved through the same
 * shared helpers. The distinguishing property of this tool is that it is
 * REVIEW-ONLY: it never writes to the database, so there is no apply path,
 * no ContentRevision, and no extra eligibility rule beyond the shared one.
 */
describe("buildSchemaMarkupHref", () => {
  it("31. targets the EXISTING Schema Markup Generator route — no new route is introduced", () => {
    const href = buildSchemaMarkupHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect(href).toMatch(/^\/ai\/schema-markup\/new\?/);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("seoProjectId")).toBe(PROJECT_A);
    expect(params.get("contentId")).toBe(CONTENT_IN_A);
  });

  it("32. carries the two ids ONLY — never company identity, actor identity, or content field values", () => {
    const href = buildSchemaMarkupHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect(href).not.toMatch(/companyId|companyName|projectName|domain|actorId|userId|title|metaDescription|body/i);
    expect([...new URL(href, "http://x").searchParams.keys()].sort()).toEqual(["contentId", "seoProjectId"]);
  });

  it("33. round-trips through the SAME parser as its two siblings — one shared parameter contract, not a third one", () => {
    const href = buildSchemaMarkupHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    const parsed = parseContentOptimizerParams(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(parsed).toEqual({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({
      seoProjectId: PROJECT_A,
      contentIds: [CONTENT_IN_A],
    });
  });

  it("34. all three optimizer hand-offs differ ONLY by route — the id contract is identical", () => {
    const handoff = { seoProjectId: PROJECT_A, contentId: CONTENT_IN_A };
    const query = (href: string) => new URL(href, "http://x").search;
    expect(query(buildSchemaMarkupHref(handoff))).toBe(query(buildMetaTagOptimizerHref(handoff)));
    expect(query(buildSchemaMarkupHref(handoff))).toBe(query(buildContentRewriterHref(handoff)));
    expect(new URL(buildSchemaMarkupHref(handoff), "http://x").pathname).toBe("/ai/schema-markup/new");
  });
});

describe("Schema Markup eligibility — the shared rule, with no body requirement", () => {
  const LIVE = { canManage: true, contentDeletedAt: null, projectDeletedAt: null };

  it("35. offered for a live record in a live project", () => {
    expect(canOfferContentOptimizerActions(LIVE)).toBe(true);
  });

  it("36. offered for BRIEF-ONLY content with NO body — schema grounds itself in title/metaDescription/url, so unlike the Rewriter it needs no article body", () => {
    expect(canOfferContentOptimizerActions(LIVE)).toBe(true);
    expect(canOfferContentRewrite({ ...LIVE, body: null })).toBe(false);
  });

  it("37. offered for MANUALLY created content — generatedByAi is not an eligibility input at all", () => {
    expect(Object.keys(LIVE).sort()).toEqual(["canManage", "contentDeletedAt", "projectDeletedAt"]);
    expect(canOfferContentOptimizerActions(LIVE)).toBe(true);
  });

  it("38. NOT offered for soft-deleted Content", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, contentDeletedAt: new Date("2026-08-12") })).toBe(false);
  });

  it("39. NOT offered when the owning PROJECT is trashed — the tool's project list excludes trashed projects, so the action would dead-end", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, projectDeletedAt: new Date("2026-08-12") })).toBe(false);
  });

  it("40. NOT offered without manage permission", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, canManage: false })).toBe(false);
  });
});

describe("Schema Markup hand-off — a manipulated URL cannot preselect what the actor may not reach", () => {
  it("41. ANOTHER COMPANY's project id resolves to no selection at all", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSchemaMarkupHref({ seoProjectId: "00000000-0000-4000-8000-0000000000ff", contentId: CONTENT_IN_A }), "http://x").searchParams)
    );
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({ seoProjectId: "", contentIds: [] });
  });

  it("42. a WRONG-PROJECT content id is dropped, leaving the project only", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSchemaMarkupHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_B }), "http://x").searchParams)
    );
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });

  it("43. a SOFT-DELETED content id is absent from the route's own query, so it resolves to no content", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSchemaMarkupHref({ seoProjectId: PROJECT_A, contentId: "trashed-row" }), "http://x").searchParams)
    );
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, { [PROJECT_A]: [] })).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });

  it("44. an INVALID/empty hand-off preselects nothing — identical to opening the tool directly", () => {
    expect(resolveContentOptimizerSelection(parseContentOptimizerParams({}), OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({
      seoProjectId: "",
      contentIds: [],
    });
  });

  it("45. preselects at most the ONE requested record — a review-only tool still never bulk-selects", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSchemaMarkupHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A }), "http://x").searchParams)
    );
    const resolved = resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, {
      [PROJECT_A]: [{ id: CONTENT_IN_A }, { id: "another" }, { id: "yet-another" }],
    });
    expect(resolved.contentIds).toEqual([CONTENT_IN_A]);
  });
});

/**
 * Phase C4.5 — the Content → Social Snippet Generator contextual hand-off.
 *
 * Same ids-only navigation contract as C4.1/C4.2/C4.3, resolved through the
 * same shared helpers. Review-only, like Schema Markup: nothing is written,
 * posted or scheduled, so there is no apply path and no extra eligibility
 * rule beyond the shared one.
 */
describe("buildSocialSnippetHref", () => {
  it("46. targets the EXISTING Social Snippet Generator route — no new route is introduced", () => {
    const href = buildSocialSnippetHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect(href).toMatch(/^\/ai\/social-snippet-generator\/new\?/);
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("seoProjectId")).toBe(PROJECT_A);
    expect(params.get("contentId")).toBe(CONTENT_IN_A);
  });

  it("47. carries EXACTLY the two id keys — no companyId, actorId, companyName, title, meta fields, body, or AI output", () => {
    const href = buildSocialSnippetHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    expect([...new URL(href, "http://x").searchParams.keys()].sort()).toEqual(["contentId", "seoProjectId"]);
    // Checked against the QUERY only: the route's own path legitimately
    // contains "snippet", which is a route name, not carried data.
    const query = new URL(href, "http://x").search;
    expect(query).not.toMatch(/companyId|companyName|actorId|userId|title|metaTitle|metaDescription|body|platform|snippet/i);
  });

  it("48. round-trips through the SAME parser as its three siblings — one shared parameter contract", () => {
    const href = buildSocialSnippetHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
    const parsed = parseContentOptimizerParams(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(parsed).toEqual({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A });
  });

  it("49. resolves to EXACTLY the requested Content — never a bulk selection", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSocialSnippetHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_A }), "http://x").searchParams)
    );
    const resolved = resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, {
      [PROJECT_A]: [{ id: CONTENT_IN_A }, { id: "another" }],
    });
    expect(resolved).toEqual({ seoProjectId: PROJECT_A, contentIds: [CONTENT_IN_A] });
  });

  it("50. all four optimizer hand-offs differ ONLY by route — the id contract is identical", () => {
    const handoff = { seoProjectId: PROJECT_A, contentId: CONTENT_IN_A };
    const query = (href: string) => new URL(href, "http://x").search;
    expect(query(buildSocialSnippetHref(handoff))).toBe(query(buildSchemaMarkupHref(handoff)));
    expect(query(buildSocialSnippetHref(handoff))).toBe(query(buildMetaTagOptimizerHref(handoff)));
    expect(query(buildSocialSnippetHref(handoff))).toBe(query(buildContentRewriterHref(handoff)));
    expect(new URL(buildSocialSnippetHref(handoff), "http://x").pathname).toBe("/ai/social-snippet-generator/new");
  });
});

describe("Social Snippet hand-off — invalid or unauthorized ids never preselect", () => {
  it("51. FOREIGN project id resolves to no selection at all", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSocialSnippetHref({ seoProjectId: "00000000-0000-4000-8000-0000000000ff", contentId: CONTENT_IN_A }), "http://x").searchParams)
    );
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({ seoProjectId: "", contentIds: [] });
  });

  it("52. FOREIGN content id under an owned project is dropped", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSocialSnippetHref({ seoProjectId: PROJECT_A, contentId: "00000000-0000-4000-8000-00000000cfff" }), "http://x").searchParams)
    );
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });

  it("53. PROJECT MISMATCH — content belonging to another project is dropped", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSocialSnippetHref({ seoProjectId: PROJECT_A, contentId: CONTENT_IN_B }), "http://x").searchParams)
    );
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });

  it("54. SOFT-DELETED content is absent from the route's own query, so it resolves to no content", () => {
    const parsed = parseContentOptimizerParams(
      Object.fromEntries(new URL(buildSocialSnippetHref({ seoProjectId: PROJECT_A, contentId: "trashed-row" }), "http://x").searchParams)
    );
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, { [PROJECT_A]: [] })).toEqual({ seoProjectId: PROJECT_A, contentIds: [] });
  });

  it("55. INVALID/garbage ids preselect nothing rather than throwing", () => {
    const parsed = parseContentOptimizerParams({ seoProjectId: "not-a-uuid", contentId: "also-not-a-uuid" });
    expect(resolveContentOptimizerSelection(parsed, OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({ seoProjectId: "", contentIds: [] });
  });

  it("56. an ABSENT hand-off preselects nothing — a direct visit still behaves normally", () => {
    expect(resolveContentOptimizerSelection(parseContentOptimizerParams({}), OWN_PROJECT_IDS, OWN_CONTENT_BY_PROJECT)).toEqual({
      seoProjectId: "",
      contentIds: [],
    });
  });
});

describe("Social Snippet eligibility — the shared rule, no body requirement", () => {
  const LIVE = { canManage: true, contentDeletedAt: null, projectDeletedAt: null };

  it("57. ALLOWED — active Content in an active project", () => {
    expect(canOfferContentOptimizerActions(LIVE)).toBe(true);
  });

  it("58. ALLOWED — MANUAL content (generatedByAi is not an eligibility input at all)", () => {
    expect(Object.keys(LIVE).sort()).toEqual(["canManage", "contentDeletedAt", "projectDeletedAt"]);
    expect(canOfferContentOptimizerActions(LIVE)).toBe(true);
  });

  it("59. ALLOWED — brief-only content with no body; snippets ground in the title, which every live row has", () => {
    expect(canOfferContentOptimizerActions(LIVE)).toBe(true);
    expect(canOfferContentRewrite({ ...LIVE, body: null })).toBe(false);
  });

  it("60. BLOCKED — soft-deleted Content", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, contentDeletedAt: new Date("2026-08-12") })).toBe(false);
  });

  it("61. BLOCKED — soft-deleted project", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, projectDeletedAt: new Date("2026-08-12") })).toBe(false);
  });

  it("62. BLOCKED — without manage permission", () => {
    expect(canOfferContentOptimizerActions({ ...LIVE, canManage: false })).toBe(false);
  });
});

describe("buildEmailNewsletterHref — Content record → Email Newsletter Drafter", () => {
  const HANDOFF = { seoProjectId: "project-1", contentId: "content-1" };

  it("targets the drafter route and carries both ids", () => {
    const href = buildEmailNewsletterHref(HANDOFF);
    expect(href.startsWith("/ai/email-newsletter/new?")).toBe(true);
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("seoProjectId")).toBe("project-1");
    expect(params.get("contentId")).toBe("content-1");
  });

  it("carries ids only — never company, ownership or any other authority", () => {
    const href = buildEmailNewsletterHref(HANDOFF);
    const params = new URL(href, "https://example.test").searchParams;
    expect([...params.keys()].sort()).toEqual(["contentId", "seoProjectId"]);
    expect(href).not.toMatch(/companyId|userId|role|isOwner/i);
  });

  it("url-encodes ids rather than letting them break out of the query string", () => {
    const href = buildEmailNewsletterHref({ seoProjectId: "a b&c=d", contentId: "e/f" });
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("seoProjectId")).toBe("a b&c=d");
    expect(params.get("contentId")).toBe("e/f");
  });
});

describe("buildInternalLinkAnalyzerHref — Content record → Internal Link Analyzer", () => {
  const HANDOFF = { seoProjectId: "project-1", contentId: "content-1" };

  it("targets the analyzer's EXISTING route and carries both ids", () => {
    const href = buildInternalLinkAnalyzerHref(HANDOFF);
    expect(href.startsWith("/ai/internal-link-analyzer/new?")).toBe(true);
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("seoProjectId")).toBe("project-1");
    expect(params.get("contentId")).toBe("content-1");
  });

  it("carries ids only — never company, ownership or any other authority", () => {
    const params = new URL(buildInternalLinkAnalyzerHref(HANDOFF), "https://example.test").searchParams;
    expect([...params.keys()].sort()).toEqual(["contentId", "seoProjectId"]);
  });

  it("url-encodes ids rather than letting them break out of the query string", () => {
    const params = new URL(buildInternalLinkAnalyzerHref({ seoProjectId: "a b&c=d", contentId: "e/f" }), "https://example.test").searchParams;
    expect(params.get("seoProjectId")).toBe("a b&c=d");
    expect(params.get("contentId")).toBe("e/f");
  });
});

describe("canOfferInternalLinkAnalysis", () => {
  const LIVE = { canManage: true, contentDeletedAt: null, projectDeletedAt: null, body: "<p>Real prose.</p>" };

  it("ALLOWED — a live record with a body under a live project", () => {
    expect(canOfferInternalLinkAnalysis(LIVE)).toBe(true);
  });

  it("BLOCKED — no body to place an anchor in", () => {
    for (const body of [null, "", "   "]) {
      expect(canOfferInternalLinkAnalysis({ ...LIVE, body })).toBe(false);
    }
  });

  it("BLOCKED — trashed record, trashed project, or no manage permission", () => {
    expect(canOfferInternalLinkAnalysis({ ...LIVE, contentDeletedAt: new Date("2026-08-12") })).toBe(false);
    expect(canOfferInternalLinkAnalysis({ ...LIVE, projectDeletedAt: new Date("2026-08-12") })).toBe(false);
    expect(canOfferInternalLinkAnalysis({ ...LIVE, canManage: false })).toBe(false);
  });

  it("matches the Rewriter's rule exactly — both need real prose to work from", () => {
    for (const body of [null, "", "   ", "words"]) {
      expect(canOfferInternalLinkAnalysis({ ...LIVE, body })).toBe(canOfferContentRewrite({ ...LIVE, body }));
    }
  });
});
