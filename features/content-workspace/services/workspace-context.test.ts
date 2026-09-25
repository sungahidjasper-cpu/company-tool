import { describe, expect, it } from "vitest";

import {
  ALL_CLIENTS_SELECTION,
  DEFAULT_SELECTION,
  NO_CLIENT_SELECTION,
  WORKSPACE_COOKIE_MAX_AGE,
  WORKSPACE_COOKIE_NAME,
  buildWorkspaceHref,
  describeSelection,
  parseSelectionCookie,
  projectsForClient,
  resolveSelection,
  selectedProjectIds,
  selectionHasNoProjects,
  serializeSelection,
  type ClientOption,
  type ProjectOption,
} from "@/features/content-workspace/services/workspace-context";

/**
 * The option lists here stand for what the SERVER fetched for the signed-in
 * company: only live clients, only live company-owned projects. That is what
 * makes "must appear in the options" a sufficient ownership rule — anything
 * belonging to another company, or soft-deleted, is simply absent.
 */
const ACME = "01a00000-0000-4000-8000-00000000ac01";
const NORTH = "01a00000-0000-4000-8000-0000000000f0";
const OTHER_COMPANY_CLIENT = "01a00000-0000-4000-8000-0000000000ff";

const P_ACME_1 = "01a00000-0000-4000-8000-0000000000a1";
const P_ACME_2 = "01a00000-0000-4000-8000-0000000000a2";
const P_NORTH_1 = "01a00000-0000-4000-8000-0000000000b1";
const P_UNASSIGNED = "01a00000-0000-4000-8000-0000000000c1";
const P_OTHER_COMPANY = "01a00000-0000-4000-8000-0000000000d1";

const CLIENTS: ClientOption[] = [
  { id: ACME, name: "Acme Plumbing" },
  { id: NORTH, name: "Northside Dental" },
];

const PROJECTS: ProjectOption[] = [
  { id: P_ACME_1, name: "Acme SEO", clientId: ACME },
  { id: P_ACME_2, name: "Acme Blog", clientId: ACME },
  { id: P_NORTH_1, name: "Northside SEO", clientId: NORTH },
  { id: P_UNASSIGNED, name: "House project", clientId: null },
];

const OPTIONS = { clients: CLIENTS, projects: PROJECTS };

describe("projectsForClient", () => {
  it("1. 'all' is every live project of the company", () => {
    expect(projectsForClient(PROJECTS, ALL_CLIENTS_SELECTION).map((p) => p.id)).toEqual([P_ACME_1, P_ACME_2, P_NORTH_1, P_UNASSIGNED]);
  });

  it("2. a client with several projects gets all of theirs and only theirs", () => {
    expect(projectsForClient(PROJECTS, ACME).map((p) => p.id)).toEqual([P_ACME_1, P_ACME_2]);
  });

  it("3. a client with one project gets exactly that one", () => {
    expect(projectsForClient(PROJECTS, NORTH).map((p) => p.id)).toEqual([P_NORTH_1]);
  });

  it("4. 'unassigned' gets only the projects with no client", () => {
    expect(projectsForClient(PROJECTS, NO_CLIENT_SELECTION).map((p) => p.id)).toEqual([P_UNASSIGNED]);
  });

  it("5. an unknown client id gets nothing — never a fallback to everything", () => {
    expect(projectsForClient(PROJECTS, OTHER_COMPANY_CLIENT)).toEqual([]);
    expect(projectsForClient(PROJECTS, "garbage")).toEqual([]);
  });
});

describe("resolveSelection — a requested id only survives if the company owns it", () => {
  it("6. keeps a real client of this company", () => {
    expect(resolveSelection({ clientId: ACME }, OPTIONS)).toEqual({ clientId: ACME, projectId: "" });
  });

  it("7. falls back to all clients for ANOTHER company's client", () => {
    expect(resolveSelection({ clientId: OTHER_COMPANY_CLIENT }, OPTIONS)).toEqual(DEFAULT_SELECTION);
  });

  it("8. falls back for a deleted client — it is simply absent from the options", () => {
    // A soft-deleted client never reaches the option list, so its id behaves
    // exactly like any other unknown id.
    expect(resolveSelection({ clientId: ACME }, { clients: [], projects: PROJECTS })).toEqual(DEFAULT_SELECTION);
  });

  it("9. falls back for a malformed, empty or missing client id", () => {
    for (const clientId of ["", "   ", "not-a-uuid", "../../etc", undefined, null]) {
      expect(resolveSelection({ clientId }, OPTIONS).clientId).toBe(ALL_CLIENTS_SELECTION);
    }
  });

  it("10. accepts 'unassigned' only when an unassigned project genuinely exists", () => {
    expect(resolveSelection({ clientId: NO_CLIENT_SELECTION }, OPTIONS).clientId).toBe(NO_CLIENT_SELECTION);
    const noneUnassigned = { clients: CLIENTS, projects: PROJECTS.filter((p) => p.clientId !== null) };
    expect(resolveSelection({ clientId: NO_CLIENT_SELECTION }, noneUnassigned).clientId).toBe(ALL_CLIENTS_SELECTION);
  });

  it("11. keeps a project that belongs to the resolved client", () => {
    expect(resolveSelection({ clientId: ACME, projectId: P_ACME_2 }, OPTIONS)).toEqual({ clientId: ACME, projectId: P_ACME_2 });
  });

  it("12. DROPS a project belonging to a different client of the same company", () => {
    // The subtle case: both ids are real and both are ours, but the pair is not.
    expect(resolveSelection({ clientId: ACME, projectId: P_NORTH_1 }, OPTIONS)).toEqual({ clientId: ACME, projectId: "" });
  });

  it("13. DROPS another company's project id", () => {
    expect(resolveSelection({ clientId: ACME, projectId: P_OTHER_COMPANY }, OPTIONS).projectId).toBe("");
  });

  it("14. DROPS a deleted project — absent from the options means not selectable", () => {
    const withoutAcme2 = { clients: CLIENTS, projects: PROJECTS.filter((p) => p.id !== P_ACME_2) };
    expect(resolveSelection({ clientId: ACME, projectId: P_ACME_2 }, withoutAcme2).projectId).toBe("");
  });

  it("15. DROPS a malformed project id", () => {
    for (const projectId of ["", "   ", "nope", "../../x"]) {
      expect(resolveSelection({ clientId: ACME, projectId }, OPTIONS).projectId).toBe("");
    }
  });

  it("16. a project is still validated when the client falls back to 'all'", () => {
    // Bad client + good project: the client resets, and the project must still
    // be one of the company's own.
    expect(resolveSelection({ clientId: OTHER_COMPANY_CLIENT, projectId: P_ACME_1 }, OPTIONS)).toEqual({
      clientId: ALL_CLIENTS_SELECTION,
      projectId: P_ACME_1,
    });
    expect(resolveSelection({ clientId: OTHER_COMPANY_CLIENT, projectId: P_OTHER_COMPANY }, OPTIONS)).toEqual(DEFAULT_SELECTION);
  });

  it("17. an unassigned selection only accepts an unassigned project", () => {
    expect(resolveSelection({ clientId: NO_CLIENT_SELECTION, projectId: P_UNASSIGNED }, OPTIONS).projectId).toBe(P_UNASSIGNED);
    expect(resolveSelection({ clientId: NO_CLIENT_SELECTION, projectId: P_ACME_1 }, OPTIONS).projectId).toBe("");
  });

  it("18. a company with nothing resolves to the default rather than throwing", () => {
    expect(resolveSelection({ clientId: ACME, projectId: P_ACME_1 }, { clients: [], projects: [] })).toEqual(DEFAULT_SELECTION);
  });
});

describe("selectedProjectIds — the bound the database query is given", () => {
  it("19. 'all' yields every project id", () => {
    expect(selectedProjectIds({ clientId: ALL_CLIENTS_SELECTION, projectId: "" }, PROJECTS)).toEqual([P_ACME_1, P_ACME_2, P_NORTH_1, P_UNASSIGNED]);
  });

  it("20. a client yields only that client's project ids", () => {
    expect(selectedProjectIds({ clientId: ACME, projectId: "" }, PROJECTS)).toEqual([P_ACME_1, P_ACME_2]);
  });

  it("21. a chosen project narrows to exactly that one", () => {
    expect(selectedProjectIds({ clientId: ACME, projectId: P_ACME_2 }, PROJECTS)).toEqual([P_ACME_2]);
  });

  it("22. a client with no projects yields an EMPTY list — which must mean 'nothing', not 'everything'", () => {
    const clientWithNone = { clients: CLIENTS, projects: PROJECTS.filter((p) => p.clientId !== NORTH) };
    const selection = resolveSelection({ clientId: NORTH }, clientWithNone);
    expect(selectedProjectIds(selection, clientWithNone.projects)).toEqual([]);
  });

  it("23. never returns a project outside the selection, even if asked for one", () => {
    expect(selectedProjectIds({ clientId: ACME, projectId: P_NORTH_1 }, PROJECTS)).toEqual([]);
    expect(selectedProjectIds({ clientId: NO_CLIENT_SELECTION, projectId: P_ACME_1 }, PROJECTS)).toEqual([]);
  });

  it("24. an unknown client selection yields nothing", () => {
    expect(selectedProjectIds({ clientId: OTHER_COMPANY_CLIENT, projectId: "" }, PROJECTS)).toEqual([]);
  });
});

describe("selectionHasNoProjects", () => {
  it("25. true for a real client with no live projects", () => {
    const projects = PROJECTS.filter((p) => p.clientId !== NORTH);
    expect(selectionHasNoProjects({ clientId: NORTH, projectId: "" }, projects)).toBe(true);
  });

  it("26. false when the client has projects", () => {
    expect(selectionHasNoProjects({ clientId: ACME, projectId: "" }, PROJECTS)).toBe(false);
  });

  it("27. true for a company with no projects at all", () => {
    expect(selectionHasNoProjects(DEFAULT_SELECTION, [])).toBe(true);
  });
});

describe("describeSelection — always a real name, never a raw id", () => {
  it("28. names the chosen client and project", () => {
    expect(describeSelection({ clientId: ACME, projectId: P_ACME_2 }, OPTIONS)).toEqual({
      clientLabel: "Acme Plumbing",
      projectLabel: "Acme Blog",
    });
  });

  it("29. describes the two sentinels in plain words", () => {
    expect(describeSelection(DEFAULT_SELECTION, OPTIONS).clientLabel).toBe("All clients");
    expect(describeSelection({ clientId: NO_CLIENT_SELECTION, projectId: "" }, OPTIONS).clientLabel).toBe("No client assigned");
  });

  it("30. says 'All projects' when none is chosen", () => {
    expect(describeSelection({ clientId: ACME, projectId: "" }, OPTIONS).projectLabel).toBe("All projects");
  });

  it("31. never leaks a raw id when a name cannot be found", () => {
    const described = describeSelection({ clientId: OTHER_COMPANY_CLIENT, projectId: P_OTHER_COMPANY }, OPTIONS);
    expect(described.clientLabel).toBe("All clients");
    expect(described.projectLabel).toBe("All projects");
    expect(JSON.stringify(described)).not.toContain(OTHER_COMPANY_CLIENT);
  });
});

describe("carrying the selection between visits", () => {
  it("32. the cookie is a display preference with a name and lifetime, nothing more", () => {
    expect(WORKSPACE_COOKIE_NAME).toBe("content_workspace_context");
    expect(WORKSPACE_COOKIE_MAX_AGE).toBeGreaterThan(0);
  });

  it("33. serialises and re-parses a selection", () => {
    const selection = { clientId: ACME, projectId: P_ACME_2 };
    expect(parseSelectionCookie(serializeSelection(selection))).toEqual(selection);
  });

  it("34. a corrupt or empty cookie yields an empty request, which resolves to the default", () => {
    for (const raw of ["", "   ", undefined, null, "|", "garbage"]) {
      const parsed = parseSelectionCookie(raw);
      expect(resolveSelection(parsed, OPTIONS)).toEqual(DEFAULT_SELECTION);
    }
  });

  it("35. a TAMPERED cookie cannot select another company's data", () => {
    const tampered = serializeSelection({ clientId: OTHER_COMPANY_CLIENT, projectId: P_OTHER_COMPANY });
    expect(resolveSelection(parseSelectionCookie(tampered), OPTIONS)).toEqual(DEFAULT_SELECTION);
    expect(selectedProjectIds(resolveSelection(parseSelectionCookie(tampered), OPTIONS), PROJECTS)).not.toContain(P_OTHER_COMPANY);
  });

  it("36. a cookie naming a client that has since been deleted degrades to the default", () => {
    const cookie = serializeSelection({ clientId: ACME, projectId: P_ACME_1 });
    const afterDeletion = { clients: [], projects: [] };
    expect(resolveSelection(parseSelectionCookie(cookie), afterDeletion)).toEqual(DEFAULT_SELECTION);
  });
});

describe("buildWorkspaceHref", () => {
  it("37. omits defaults so the common case is a clean URL", () => {
    expect(buildWorkspaceHref(DEFAULT_SELECTION)).toBe("/content");
    expect(buildWorkspaceHref(DEFAULT_SELECTION, "MONTH")).toBe("/content");
  });

  it("38. carries the client, the project and the view", () => {
    const href = buildWorkspaceHref({ clientId: ACME, projectId: P_ACME_2 }, "WEEK");
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("client")).toBe(ACME);
    expect(params.get("project")).toBe(P_ACME_2);
    expect(params.get("view")).toBe("week");
  });

  it("39. round-trips back through resolveSelection", () => {
    const selection = { clientId: NO_CLIENT_SELECTION, projectId: P_UNASSIGNED };
    const params = new URL(buildWorkspaceHref(selection), "https://example.test").searchParams;
    expect(resolveSelection({ clientId: params.get("client"), projectId: params.get("project") }, OPTIONS)).toEqual(selection);
  });

  it("40. a project chosen under 'all clients' produces a URL with ONLY project — which must still round-trip", () => {
    // The builder omits the client when it is the default, so the reader must
    // not key off the client's presence alone. This pins the shape that broke.
    const selection = { clientId: ALL_CLIENTS_SELECTION, projectId: P_ACME_1 };
    const href = buildWorkspaceHref(selection);
    expect(href).toBe(`/content?project=${P_ACME_1}`);

    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("client")).toBeNull();
    expect(resolveSelection({ clientId: params.get("client"), projectId: params.get("project") }, OPTIONS)).toEqual(selection);
  });

  it("41. carries no company or authority value", () => {
    const href = buildWorkspaceHref({ clientId: ACME, projectId: P_ACME_1 }, "AGENDA");
    expect(href).not.toMatch(/companyId|userId|role|token/i);
  });
});

describe("Phase 3 — the period travels with the selection", () => {
  it("42. the href carries the anchor date when one is given", () => {
    const href = buildWorkspaceHref({ clientId: ACME, projectId: "" }, "WEEK", "2026-10-05");
    const params = new URL(href, "https://example.test").searchParams;
    expect(params.get("date")).toBe("2026-10-05");
    expect(params.get("client")).toBe(ACME);
    expect(params.get("view")).toBe("week");
  });

  it("43. omits the date when none is given, keeping the common URL clean", () => {
    expect(buildWorkspaceHref(DEFAULT_SELECTION, "MONTH")).toBe("/content");
    expect(buildWorkspaceHref(DEFAULT_SELECTION)).toBe("/content");
  });

  it("44. a date survives even when the client is the default", () => {
    // This is why switching client no longer loses the user's place: the date
    // is independent of whether a client is named.
    const href = buildWorkspaceHref(DEFAULT_SELECTION, "MONTH", "2027-01-15");
    expect(href).toBe("/content?date=2027-01-15");
  });

  it("45. still carries no company or authority value", () => {
    const href = buildWorkspaceHref({ clientId: ACME, projectId: P_ACME_1 }, "AGENDA", "2026-10-05");
    expect(href).not.toMatch(/companyId|userId|role|token/i);
  });
});
