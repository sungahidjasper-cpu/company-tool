/**
 * Resolving which client and SEO project the Content Workspace is looking at.
 *
 * Everything here is pure, and everything here is a FILTER over options the
 * server has already fetched for the signed-in company. That is the whole
 * safety argument: a client or project id can only survive resolution if it
 * appears in a list the server built from the actor's own company, so a
 * hand-typed id — from the URL, from a stale cookie, from anywhere — resolves
 * to "not selected" rather than to someone else's data.
 *
 * No I/O, no React, no database.
 */

/** The sentinel for "projects that are not assigned to any client". */
export const NO_CLIENT_SELECTION = "unassigned";

/** The sentinel for "every client this company has". */
export const ALL_CLIENTS_SELECTION = "all";

export type ClientOption = { id: string; name: string };

/** A project as the server fetched it: already company-scoped and already live. */
export type ProjectOption = { id: string; name: string; clientId: string | null };

export type WorkspaceSelection = {
  /** A real client id, or one of the two sentinels. Never an unverified value. */
  clientId: string;
  /** A real project id belonging to the resolved client, or "" for all of them. */
  projectId: string;
};

export const DEFAULT_SELECTION: WorkspaceSelection = { clientId: ALL_CLIENTS_SELECTION, projectId: "" };

/**
 * The projects visible for a client selection.
 *
 * `all` is every live project of the company; a real client id is that
 * client's projects; `unassigned` is the projects with no client. A client id
 * that is not in the option list yields nothing, which is what makes an
 * unknown id harmless rather than dangerous.
 */
export function projectsForClient(projects: readonly ProjectOption[], clientId: string): ProjectOption[] {
  if (clientId === ALL_CLIENTS_SELECTION) return [...projects];
  if (clientId === NO_CLIENT_SELECTION) return projects.filter((project) => project.clientId === null);
  return projects.filter((project) => project.clientId === clientId);
}

/**
 * Resolves a requested selection against what the company actually has.
 *
 * The rules, in order:
 * - A client id that is not one of this company's clients falls back to "all".
 *   This covers another company's client, a deleted client, a malformed id and
 *   an empty value with one branch, because none of them appear in the option
 *   list the server built.
 * - `unassigned` is only offered when the company genuinely has a project with
 *   no client; otherwise it too falls back to "all".
 * - A project id is kept only when it belongs to the RESOLVED client. A project
 *   of another company, a deleted project, or a real project belonging to a
 *   different client are all dropped — which prevents the subtle case of a
 *   valid client paired with a valid project that is not theirs.
 */
export function resolveSelection(
  requested: { clientId?: string | null; projectId?: string | null },
  options: { clients: readonly ClientOption[]; projects: readonly ProjectOption[] }
): WorkspaceSelection {
  const requestedClient = (requested.clientId ?? "").trim();

  let clientId = ALL_CLIENTS_SELECTION;
  if (requestedClient === NO_CLIENT_SELECTION) {
    clientId = options.projects.some((project) => project.clientId === null) ? NO_CLIENT_SELECTION : ALL_CLIENTS_SELECTION;
  } else if (requestedClient !== "" && requestedClient !== ALL_CLIENTS_SELECTION) {
    clientId = options.clients.some((client) => client.id === requestedClient) ? requestedClient : ALL_CLIENTS_SELECTION;
  }

  const allowed = projectsForClient(options.projects, clientId);
  const requestedProject = (requested.projectId ?? "").trim();
  const projectId = allowed.some((project) => project.id === requestedProject) ? requestedProject : "";

  return { clientId, projectId };
}

/**
 * The project ids a resolved selection may read.
 *
 * Returning an explicit array — rather than "no restriction" — is deliberate:
 * the caller turns it straight into an `in` clause, so the database query is
 * bounded by ids the server already verified. An empty array means "this
 * selection has nothing", which the query must honour by returning nothing
 * rather than by ignoring the filter.
 */
export function selectedProjectIds(selection: WorkspaceSelection, projects: readonly ProjectOption[]): string[] {
  const allowed = projectsForClient(projects, selection.clientId);
  if (selection.projectId !== "") {
    return allowed.some((project) => project.id === selection.projectId) ? [selection.projectId] : [];
  }
  return allowed.map((project) => project.id);
}

/** How the current context reads in the UI — always a real name, never a raw id. */
export function describeSelection(
  selection: WorkspaceSelection,
  options: { clients: readonly ClientOption[]; projects: readonly ProjectOption[] }
): { clientLabel: string; projectLabel: string } {
  const clientLabel =
    selection.clientId === ALL_CLIENTS_SELECTION
      ? "All clients"
      : selection.clientId === NO_CLIENT_SELECTION
        ? "No client assigned"
        : (options.clients.find((client) => client.id === selection.clientId)?.name ?? "All clients");

  const projectLabel =
    selection.projectId === ""
      ? "All projects"
      : (options.projects.find((project) => project.id === selection.projectId)?.name ?? "All projects");

  return { clientLabel, projectLabel };
}

/**
 * True when the selection is valid but genuinely has nothing behind it — a
 * client with no live SEO projects. Worth distinguishing from "no content
 * yet", because the fix is different: one needs a project, the other needs
 * content.
 */
export function selectionHasNoProjects(selection: WorkspaceSelection, projects: readonly ProjectOption[]): boolean {
  return projectsForClient(projects, selection.clientId).length === 0;
}

// ---------------------------------------------------------------------------
// Carrying the selection between visits
// ---------------------------------------------------------------------------

/**
 * The cookie that remembers the last selection, so arriving at a bare
 * `/content` (from the sidebar, say) returns to the client the user was last
 * working on.
 *
 * A cookie is used because it is the ONLY UI-state persistence this
 * application already has — the sidebar's own open/closed state works exactly
 * this way — and because the server can read it, which a `localStorage` value
 * cannot. It stores a display preference and nothing else: the id inside is
 * re-validated against the company on every request, so a tampered or stale
 * cookie can only ever change which of the user's OWN clients is preselected.
 */
export const WORKSPACE_COOKIE_NAME = "content_workspace_context";
export const WORKSPACE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** `clientId|projectId`, deliberately trivial — there is nothing here worth a JSON parser. */
export function serializeSelection(selection: WorkspaceSelection): string {
  return `${selection.clientId}|${selection.projectId}`;
}

/**
 * Reads the cookie value back. Anything unexpected yields an empty request,
 * which `resolveSelection` then turns into the default — so a corrupt cookie
 * degrades to "all clients" instead of throwing.
 */
export function parseSelectionCookie(raw: string | undefined | null): { clientId?: string; projectId?: string } {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  const [clientId = "", projectId = ""] = raw.split("|");
  return { clientId: clientId.trim(), projectId: projectId.trim() };
}

/**
 * Builds the `/content` query string for a selection. Defaults are omitted so
 * the common case stays a clean URL, and the view is carried through so
 * switching client does not silently drop the user back to Month.
 */
export function buildWorkspaceHref(selection: WorkspaceSelection, view?: string, anchorIso?: string): string {
  const params = new URLSearchParams();
  if (selection.clientId !== ALL_CLIENTS_SELECTION) params.set("client", selection.clientId);
  if (selection.projectId !== "") params.set("project", selection.projectId);
  if (view && view !== "MONTH") params.set("view", view.toLowerCase());
  /*
   * Phase 3 — the period the user is looking at travels with the selection.
   *
   * Switching client navigates, so without this the calendar silently jumped
   * back to today: someone reviewing next quarter for one client lost their
   * place the moment they compared it with another. The value is re-validated
   * on arrival, so a nonsense date simply falls back to today.
   */
  if (anchorIso) params.set("date", anchorIso);
  const query = params.toString();
  return query === "" ? "/content" : `/content?${query}`;
}
