import { prisma } from "@/lib/prisma";
import { toContentItem, toPlanItem, type WorkspaceItem } from "@/features/content-workspace/services/content-calendar-feed";
import { listClientOptions } from "@/features/clients/services/client.service";

/**
 * SERVER-ONLY reads for the Content Workspace.
 *
 * Deliberately separate from content-calendar-feed.ts: that module is imported
 * by the calendar's client component, and anything importing `prisma` cannot be
 * — it drags the database client into the browser bundle. Keeping the pure
 * shaping/filtering logic and the queries in different files is what lets both
 * sides share one definition of an item without shipping the server to the
 * client.
 *
 * Read-only. Nothing here writes.
 */
// ---------------------------------------------------------------------------
// Queries — company-scoped, soft-delete aware, read-only
// ---------------------------------------------------------------------------

/**
 * Loads the workspace feed for one company.
 *
 * Both queries scope through the SEO project to the company, and both require
 * the project to be live. That second condition is not decoration: live
 * content can belong to a soft-deleted project, and such a page must not
 * appear in a workspace whose project the user has already trashed.
 *
 * `select` is narrow on purpose — no bodies, no brief JSON, no revisions. The
 * calendar needs a title, a date, a status and its owning project.
 */
export type WorkspaceFeedScope = {
  /**
   * Which client's content to load.
   *   undefined → every client in the company
   *   null      → content that belongs to no client
   *   a string  → that client only
   */
  clientId?: string | null;
  /**
   * Optional project narrowing. When present it can only REDUCE the result —
   * it is a filter, never a source of scope. An empty array means "the chosen
   * project matched nothing", which must return nothing rather than silently
   * widening back to the whole client.
   */
  projectIds?: readonly string[];
};

/**
 * The workspace feed, scoped CLIENT-FIRST.
 *
 * This used to be scoped through `seoProject`, which meant a client with no
 * SEO project could own no content and see nothing — the calendar was an SEO
 * calendar wearing a client selector. Content now carries its own company and
 * client, so the query asks the question the workspace actually asks: what
 * does this client have?
 *
 * The company is always part of the where clause, so it remains the security
 * boundary regardless of which filters are applied.
 */
export async function loadWorkspaceFeed(companyId: string, scope: WorkspaceFeedScope = {}): Promise<WorkspaceItem[]> {
  const { clientId, projectIds } = scope;

  // An explicitly empty project filter means "nothing matched", not "no filter".
  if (projectIds && projectIds.length === 0) return [];

  const clientClause = clientId === undefined ? {} : { clientId };
  const projectClause = projectIds ? { seoProjectId: { in: [...projectIds] } } : {};

  const [contentRows, planRows] = await Promise.all([
    prisma.content.findMany({
      where: { deletedAt: null, companyId, ...clientClause, ...projectClause },
      select: {
        id: true,
        title: true,
        url: true,
        status: true,
        publishedAt: true,
        // Phase 5 — a scheduled page appears on its scheduled day.
        scheduledAt: true,
        scheduledTimezone: true,
        // Phase 6 — so the calendar can say "Social post" where it is one.
        socialPost: { select: { id: true } },
        updatedAt: true,
        generatedByAi: true,
        clientId: true,
        client: { select: { id: true, name: true } },
        contentType: true,
        seoProjectId: true,
        seoProject: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
      },
      orderBy: [{ publishedAt: "desc" }, { title: "asc" }],
    }),
    /*
     * Planned items are an SEO-planning artefact: a ContentCalendar belongs to
     * an SEOProject, so they stay project-scoped. A client with no project
     * simply has none, which is the truth rather than a gap.
     */
    prisma.contentCalendarEntry.findMany({
      where: {
        deletedAt: null,
        calendar: {
          deletedAt: null,
          seoProject: {
            companyId,
            deletedAt: null,
            ...(clientId === undefined ? {} : { clientId }),
            ...(projectIds ? { id: { in: [...projectIds] } } : {}),
          },
        },
      },
      select: {
        id: true,
        topic: true,
        scheduledDate: true,
        status: true,
        contentType: true,
        role: true,
        notes: true,
        contentId: true,
        keyword: { select: { term: true } },
        calendar: {
          select: {
            id: true,
            name: true,
            seoProject: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ scheduledDate: "asc" }, { sortOrder: "asc" }],
    }),
  ]);

  return [...contentRows.map(toContentItem), ...planRows.map(toPlanItem)];
}

/** The client and project options the filter panel offers — derived from live projects only. */
export async function loadWorkspaceScope(companyId: string) {
  /*
   * Phase 2 — clients come from listClientOptions, the helper the Lead and
   * Project forms already use, rather than being derived from the projects
   * that happen to have one. That difference matters: a client with no SEO
   * project yet must still be selectable, so the workspace can say plainly
   * that it has nothing rather than hiding the client entirely.
   *
   * Both queries are company-scoped and exclude soft-deleted rows, so a
   * deleted client and another company's client are simply absent — which is
   * what makes the pure resolver's "must appear in the options" rule
   * sufficient.
   */
  const [projects, clients] = await Promise.all([
    prisma.sEOProject.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, clientId: true },
      orderBy: { name: "asc" },
    }),
    listClientOptions(companyId),
  ]);

  return {
    projects: projects.map((project) => ({ id: project.id, name: project.name, clientId: project.clientId })),
    clients,
    hasProjectWithoutClient: projects.some((project) => project.clientId === null),
  };
}
