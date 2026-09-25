import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";

import ContentWorkspaceCalendar from "@/features/content-workspace/components/ContentWorkspaceCalendar";
import { loadWorkspaceFeed, loadWorkspaceScope } from "@/features/content-workspace/services/content-workspace.queries";
import { todayUtc } from "@/features/content-workspace/services/calendar-grid";
import {
  ALL_CLIENTS_SELECTION,
  NO_CLIENT_SELECTION,
  parseSelectionCookie,
  resolveSelection,
  selectedProjectIds,
  WORKSPACE_COOKIE_NAME,
} from "@/features/content-workspace/services/workspace-context";
import { formatIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

/**
 * The Content Workspace — Phase 2.
 *
 * Still READ-ONLY. Phase 2 adds a persistent client/workspace context on top
 * of the Phase 1 calendar, using the hierarchy that already exists:
 * Company → Client → SEO Project → Content.
 *
 * How the selection is decided, and why it is safe:
 *
 * 1. The company comes from the authenticated actor. Nothing else.
 * 2. The company's live clients and live SEO projects are fetched first.
 * 3. The requested selection is read from the URL, falling back to a cookie
 *    that remembers the last visit. BOTH are untrusted input.
 * 4. `resolveSelection` keeps a client or project id only if it appears in
 *    those server-built option lists — so another company's id, a deleted
 *    record's id, a malformed id, or a project belonging to a different client
 *    all collapse to a safe default instead of selecting anything.
 * 5. The feed query is then bounded by `selectedProjectIds`, an explicit list
 *    of already-verified ids.
 *
 * The cookie is a display preference, never an authorization token: it is
 * re-validated on every request, so at worst it preselects a different one of
 * the user's own clients.
 */
type ContentWorkspacePageProps = {
  searchParams: Promise<{ client?: string; project?: string; view?: string; date?: string }>;
};

export default async function ContentWorkspacePage({ searchParams }: ContentWorkspacePageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const scope = await loadWorkspaceScope(user.companyId);

  const params = await searchParams;
  const cookieStore = await cookies();
  const remembered = parseSelectionCookie(cookieStore.get(WORKSPACE_COOKIE_NAME)?.value);

  /*
   * The URL wins whenever it names EITHER part of the selection; only a bare
   * /content falls back to the remembered one.
   *
   * Checking both matters: buildWorkspaceHref omits the client when it is the
   * default, so a project chosen while viewing all clients produces
   * `/content?project=…` with no client — and keying off the client alone
   * silently dropped it, breaking the round-trip and any shared link.
   *
   * Either way this is only a REQUEST; resolveSelection decides what is real.
   */
  const urlNamesSelection = params.client !== undefined || params.project !== undefined;
  const requested = urlNamesSelection ? { clientId: params.client, projectId: params.project } : remembered;
  const selection = resolveSelection(requested, scope);

  /*
   * CLIENT-FIRST. The feed is scoped by the chosen client, and the project is
   * applied only as a narrowing filter when one is actually chosen. This is
   * what lets a client with no SEO project have a working calendar: before,
   * the scope WAS the project list, so an empty list meant an empty screen.
   */
  const feedScope =
    selection.clientId === ALL_CLIENTS_SELECTION
      ? { clientId: undefined }
      : selection.clientId === NO_CLIENT_SELECTION
        ? { clientId: null }
        : { clientId: selection.clientId };

  const items = await loadWorkspaceFeed(user.companyId, {
    ...feedScope,
    ...(selection.projectId !== "" ? { projectIds: selectedProjectIds(selection, scope.projects) } : {}),
  });

  return (
    <PageContainer>
      <DashboardHeader
        title="Content Workspace"
        description="Your content and planned items on one calendar, per client. Read-only for now — open an item to work on it in its own page."
      />

      <Card>
        <CardContent>
          {scope.projects.length === 0 && scope.clients.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No clients yet"
              description="Content belongs to a client. Add a client to start filling the calendar — an SEO project is optional, and only needed for keyword-driven work."
              action={
                <Link href="/clients/new" className="text-sm font-medium text-primary hover:underline">
                  Add a client →
                </Link>
              }
            />
          ) : (
            <ContentWorkspaceCalendar
              items={items}
              clients={scope.clients}
              projects={scope.projects}
              hasProjectWithoutClient={scope.hasProjectWithoutClient}
              selection={selection}
              initialView={params.view}
              initialDate={params.date}
              today={formatIsoDate(todayUtc())}
            />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
