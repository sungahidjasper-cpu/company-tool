import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Sparkles } from "lucide-react";

import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import FileList from "@/components/dashboard/FileList";
import FileUploadForm from "@/components/dashboard/FileUploadForm";
import NoteForm from "@/components/dashboard/NoteForm";
import NotesList from "@/components/dashboard/NotesList";
import PageContainer from "@/components/dashboard/PageContainer";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SavedContentBriefCard from "@/features/ai-workspace/components/SavedContentBriefCard";
import { deriveContentWorkflowStage, readSavedBriefSummary } from "@/features/ai-workspace/services/saved-brief-summary";
import ArticleMarkdownPreview from "@/features/ai-workspace/components/ArticleMarkdownPreview";
import ContentOperationsPanel from "@/features/content-workspace/components/ContentOperationsPanel";
import ContentSchedulePanel from "@/features/content-workspace/components/ContentSchedulePanel";
import { describeSchedulingState, instantToZonedParts } from "@/features/content-workspace/services/content-scheduling";
import {
  buildContentOperations,
  describeContentIdentity,
  describeOperationsUnavailable,
  workspaceSelectionForContent,
} from "@/features/content-workspace/services/content-operations";
import { planTypeLabel } from "@/features/content-workspace/services/content-calendar-feed";
import { buildWorkspaceHref } from "@/features/content-workspace/services/workspace-context";
import {
  addContentNote,
  archiveContent,
  deleteContentNote,
  restoreContent,
  updateContentNote,
} from "@/features/seo/actions/content.actions";
import AdvanceContentStatusButton from "@/features/seo/components/AdvanceContentStatusButton";
import ContentVersionHistory from "@/features/seo/components/ContentVersionHistory";
import { nextContentStatus } from "@/features/seo/schemas/content.schema";
import { getContentById } from "@/features/seo/services/content.service";
import { getContentRevisions } from "@/features/seo/services/content-revision.service";
import { listFilesFor } from "@/features/files/services/file.service";
import PublishContentPanel from "@/features/publishing/components/PublishContentPanel";
import { getContentPublicationState, isContentStatusPublishable } from "@/features/publishing/services/content-publication-state.service";
import PlatformMark from "@/features/social/components/PlatformMark";
import { SOCIAL_PLATFORM_LABELS } from "@/features/social/services/social-composer";
import { describeAccount } from "@/features/social/services/social-platforms";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn, formatEnumLabel, isUuid } from "@/lib/utils";

export type ContentDetailProps = {
  contentId: string;
  /**
   * The project the URL claims this content is in.
   *
   * Supplied by the project-scoped route so a mismatched pair is a clean
   * not-found; omitted by the client-scoped route, which addresses a record
   * by its own id and does not assert a project at all.
   */
  expectedSeoProjectId?: string;
};

/**
 * ONE content detail view, reachable at two addresses.
 *
 * `/seo/[project]/content/[id]` is the long-standing SEO address and keeps
 * working exactly as before, mismatch check included. `/content/[id]` is the
 * client-first address, and is the only one a record with no SEO project can
 * have. Both render this component — there is no second detail system.
 */
export default async function ContentDetail({ contentId, expectedSeoProjectId }: ContentDetailProps) {
  const user = await requireUser();

  /*
   * Phase 4 — a malformed id is a not-found, not an error.
   *
   * Postgres rejects a non-uuid value for a uuid column, so
   * prisma.content.findUnique THREW before any ownership check could run,
   * turning /content/not-a-uuid into an error page instead of a clean 404.
   * Browser verification reproduced it. Nothing leaked — the error boundary
   * caught it — but the same defect class was already fixed in
   * seo-project.service.ts and content-calendar.repository.ts, and this is
   * the same one-line guard. Ordered after requireUser so an unauthenticated
   * visitor is still sent to the login page rather than shown a 404.
   */
  if (!isUuid(contentId)) {
    notFound();
  }

  const content = await getContentById(contentId);
  if (!content) {
    notFound();
  }
  // The project-scoped address must still name the record's actual project.
  if (expectedSeoProjectId !== undefined && content.seoProjectId !== expectedSeoProjectId) {
    notFound();
  }

  // Authorization roots at the content's own company, not a joined project.
  assertCompanyAccess(user, content.companyId);

  const canManage = Permissions.manageSeoProjects(user.role);
  const canAct = canManage || content.authorId === user.id;
  const files = await listFilesFor("content", content.id);
  const canPublish = canManage && !content.deletedAt && !!content.body && isContentStatusPublishable(content.status);
  const publicationState = canPublish ? await getContentPublicationState(content.id, content.companyId) : [];
  const revisions = canManage ? await getContentRevisions(content.id, content.companyId) : [];
  // Phase C3 — workflow state derived from the row itself; no stored status.
  const savedBrief = readSavedBriefSummary(content.aiBriefDetails);
  const workflowStage = deriveContentWorkflowStage(content);
  /*
   * Phase 4 — every content operation resolved in one place.
   *
   * The hrefs are navigation hints only and carry no authority: each tool
   * re-derives ownership from the authenticated actor and re-checks company,
   * project and both soft-delete states before generating or writing anything.
   * The per-tool eligibility rules live in content-optimizer-handoff.ts and
   * are reused, not restated, so the button and the tool agree by construction.
   */
  const operationSections = buildContentOperations({
    seoProjectId: content.seoProjectId ?? null,
    contentId: content.id,
    canManage,
    contentDeletedAt: content.deletedAt,
    projectDeletedAt: content.seoProject?.deletedAt ?? null,
    body: content.body,
    workflowStage,
  });
  const operationsUnavailableReason = describeOperationsUnavailable({
    canManage,
    contentDeletedAt: content.deletedAt,
    projectDeletedAt: content.seoProject?.deletedAt ?? null,
  });

  // Phase 4 — what this record IS, from its own columns only.
  const identity = describeContentIdentity({
    clientId: (content.clientId ?? content.seoProject?.clientId ?? null),
    clientName: (content.client?.name ?? content.seoProject?.client?.name) ?? null,
    seoProjectName: content.seoProject?.name ?? null,
    body: content.body,
    workflowStage,
  });

  /*
   * Phase 4 — the return leg of the workspace round-trip. The calendar already
   * deep-links here (content-calendar-feed.ts builds this exact path), but
   * there was no way back, so arriving from a client's calendar meant losing
   * that context. The link carries the client selection the record itself
   * implies; /content re-resolves it against the actor's own scope, so a
   * client the actor cannot see simply falls back to the default view.
   */
  const workspaceHref = buildWorkspaceHref(workspaceSelectionForContent((content.clientId ?? content.seoProject?.clientId ?? null), content.seoProjectId));

  /** The record's OWN project, if it has one. Project-only links hide without it. */
  const seoProjectId = content.seoProjectId;

  const nextStatus = nextContentStatus(content.status);

  /*
   * Phase 5 — the record's publication state, resolved once from its own
   * columns. PUBLISHED comes only from publishedAt; a schedule is an
   * intention and never counts as a publication.
   */
  const schedulingState = describeSchedulingState(content);
  const scheduleParts = content.scheduledAt && content.scheduledTimezone ? instantToZonedParts(content.scheduledAt, content.scheduledTimezone) : null;
  const canSchedule = canManage && !content.deletedAt && !content.seoProject?.deletedAt && content.status !== "PUBLISHED" && content.status !== "ARCHIVED";
  const scheduleDisabledReason = !canManage
    ? "Scheduling is available to users who can manage SEO projects."
    : content.deletedAt
      ? "This content is in the trash. Restore it before scheduling."
      : content.seoProject?.deletedAt ?? null
        ? "The SEO project this content belongs to is in the trash. Restore the project before scheduling."
        : content.status === "PUBLISHED"
          ? "This content is already published, so it cannot be scheduled."
          : content.status === "ARCHIVED"
            ? "This content is archived. Restore it before scheduling."
            : null;

  return (
    <PageContainer>
      {/*
        Phase 4 — client → project → this record, stated before anything else.
        The client was previously absent from this page entirely, so a record
        could only be traced back to its client by opening its SEO project.
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
        <Link href={workspaceHref} className="inline-flex items-center gap-1 font-medium text-slate-600 hover:underline">
          <ArrowLeft size={14} /> Content workspace
        </Link>
        <span aria-hidden="true">/</span>
        {identity.clientId && identity.clientName ? (
          <Link href={`/clients/${identity.clientId}`} className="hover:underline">
            {identity.clientName}
          </Link>
        ) : (
          <span className="italic">No client assigned</span>
        )}
        {/* The project segment appears only when the record has one. */}
        {seoProjectId && identity.seoProjectName && (
          <>
            <span aria-hidden="true">/</span>
            <Link href={`/seo/${seoProjectId}`} className="hover:underline">
              {identity.seoProjectName}
            </Link>
          </>
        )}
      </div>

      <DashboardHeader
        title={content.title}
        description={identity.stageDetail}
        actions={
          canManage ? (
            <div className="flex gap-2">
              {nextStatus && !content.deletedAt && (
                <AdvanceContentStatusButton
                  contentId={content.id}
                  nextStatusLabel={formatEnumLabel(nextStatus)}
                />
              )}
              {seoProjectId && (
                <Link
                  href={`/seo/${seoProjectId}/content/${content.id}/edit`}
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  <Pencil size={16} /> Edit
                </Link>
              )}
              {content.deletedAt ? (
                <RecordActionButton
                  id={content.id}
                  action={restoreContent}
                  label="Restore"
                  successMessage="Content restored"
                />
              ) : (
                <RecordActionButton
                  id={content.id}
                  action={archiveContent}
                  label="Archive"
                  variant="destructive"
                  confirmMessage="Archive this content?"
                  successMessage="Content archived"
                />
              )}
            </div>
          ) : undefined
        }
      />

      {content.generatedByAi && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Sparkles size={16} /> AI-generated draft — verify all facts, figures, and claims before publishing.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <StatusBadge status={content.deletedAt ? "TRASHED" : content.status} />
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-slate-500">Client</span>
              {identity.clientId && identity.clientName ? (
                <Link href={`/clients/${identity.clientId}`} className="truncate text-right hover:underline">
                  {identity.clientName}
                </Link>
              ) : (
                <span className="text-right text-slate-500 italic">No client assigned</span>
              )}
            </div>
            {/*
              Client -> Content type -> SEO project, deliberately in that
              order: who it belongs to, what it is, then the optional context.
              The type sits here rather than further down because it is now one
              of the three things that identify a record.
            */}
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-slate-500">Content type</span>
              <span className={cn("text-right", !content.contentType && "text-slate-500 italic")}>
                {content.contentType ? planTypeLabel(content.contentType) : "Not recorded"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-slate-500">SEO project</span>
              {/*
                Linked only when there IS one. This used to render
                href="/seo/null" with an empty label for client-owned content —
                a broken link to a page that cannot exist.
              */}
              {seoProjectId && identity.seoProjectName ? (
                <Link href={`/seo/${seoProjectId}`} className="truncate text-right hover:underline">
                  {identity.seoProjectName}
                </Link>
              ) : (
                <span className="text-right text-slate-500 italic">None — optional</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Stage</span>
              <span>{identity.stageLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Author</span>
              <span>
                {content.author
                  ? `${content.author.firstName} ${content.author.lastName}`
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-slate-500">Publication</span>
              <span className="text-right">{schedulingState.detail}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">URL</span>
              {content.url ? (
                <a
                  href={content.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline"
                >
                  {content.url}
                </a>
              ) : (
                <span>—</span>
              )}
            </div>
            {(content.metaTitle || content.metaDescription) && (
              <>
                <div className="flex justify-between gap-4">
                  <span className="shrink-0 text-slate-500">Meta title</span>
                  <span className="truncate text-right">{content.metaTitle ?? "—"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-slate-500">Meta description</span>
                  <span>{content.metaDescription ?? "—"}</span>
                </div>
              </>
            )}
            <p className="border-t border-slate-100 pt-3 text-xs leading-snug text-slate-400">
              A publish date is recorded only once the content is actually published — a schedule is an intention, not a publication.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Target keywords</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {content.keywords.length === 0 && (
              <p className="text-sm text-slate-500">No keywords targeted yet.</p>
            )}
            {content.keywords.map((keyword) =>
              /* A keyword lives in a project; without one there is nowhere to link. */
              seoProjectId ? (
                <Link key={keyword.id} href={`/seo/${seoProjectId}/keywords/${keyword.id}`} className="text-sm hover:underline">
                  {keyword.term}
                </Link>
              ) : (
                <span key={keyword.id} className="text-sm text-slate-700">
                  {keyword.term}
                </span>
              )
            )}
          </CardContent>
        </Card>
      </div>

      {content.socialPost && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Social post</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {content.socialPost.targets.some((target) => target.caption !== null) ? "Shared caption" : "Caption"}
              </span>
              <p className="whitespace-pre-wrap text-slate-800">{content.socialPost.caption}</p>
            </div>
            {content.socialPost.link && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Link</span>
                <a href={content.socialPost.link} target="_blank" rel="noreferrer" className="truncate text-slate-800 hover:underline">
                  {content.socialPost.link}
                </a>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Accounts</span>
              {content.socialPost.targets.length === 0 ? (
                <p className="text-slate-500">
                  No social account is selected — Select a connected social account before publishing this post.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {content.socialPost.targets.map((target) => (
                    <li key={target.socialAccount.id} className="flex flex-col gap-1.5 rounded-lg border border-slate-200 p-2.5">
                      <span className="flex items-center gap-2">
                        <PlatformMark platform={target.socialAccount.platform} size="sm" decorative />
                        <span className="min-w-0 flex-1 truncate text-slate-800">
                          {describeAccount(target.socialAccount).primary}
                          <span className="text-slate-500">
                            {" · "}
                            {SOCIAL_PLATFORM_LABELS[target.socialAccount.platform]}
                          </span>
                        </span>
                        {target.caption !== null && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Own caption</span>
                        )}
                      </span>
                      {/*
                        Only a target that HAS its own caption shows one. The
                        rest post the shared caption above, and repeating it
                        under every account would suggest a difference that
                        does not exist.
                      */}
                      {target.caption !== null && <p className="whitespace-pre-wrap text-slate-700">{target.caption}</p>}
                      {target.link !== null && target.link.length > 0 && (
                        <a href={target.link} target="_blank" rel="noreferrer" className="truncate text-xs text-slate-600 hover:underline">
                          {target.link}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canManage && !content.deletedAt && (
              <Link
                href={`/content/create/social?contentId=${content.id}`}
                className={cn(buttonVariants({ variant: "outline" }), "self-start")}
              >
                <Pencil size={16} /> Edit in composer
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/*
        Phase 6 — a social post has a caption, not an article, and its own card
        above shows it. Rendering "No article body yet" underneath would be
        noise about a field that does not apply to this kind of record.
      */}
      {!content.socialPost && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Article</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {content.body ? (
              <>
                {/*
                  Phase 7 — rendered, not raw. The body is Markdown and can now
                  contain images placed inside the article, so showing the
                  source text would show `![alt](...)` where the reader should
                  see the picture. Uses the SAME renderer the studio's preview
                  uses, so the two cannot drift.
                */}
                <div className="max-h-[32rem] overflow-y-auto">
                  <ArticleMarkdownPreview title={content.title} body={content.body} />
                </div>
                {canManage && !content.deletedAt && (
                  <Link href={`/content/create/blog?contentId=${content.id}`} className={cn(buttonVariants({ variant: "outline" }), "self-start")}>
                    <Pencil size={16} /> Edit in studio
                  </Link>
                )}
              </>
            ) : workflowStage === "BRIEF_ONLY" ? (
              <p className="text-sm text-slate-500">Brief saved — the next step is generating the article.</p>
            ) : (
              <p className="text-sm text-slate-500">No article body yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/*
        Phase C3/C4 — the contextual AI actions for this record. Each action
        appears only when its required input actually exists, and each opens an
        EXISTING AI Workspace tool already focused on this Content; the tool
        re-derives ownership server-side regardless of what the link carries.
        Deliberately a grouped set of contextual actions, not a workflow
        stepper: the Content record is the centre of the workflow.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduling</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentSchedulePanel
            contentId={content.id}
            state={{ kind: schedulingState.kind, label: schedulingState.label, detail: schedulingState.detail }}
            initialDateIso={scheduleParts?.dateIso ?? ""}
            initialTime={scheduleParts?.time ?? "09:00"}
            initialTimeZone={content.scheduledTimezone}
            canSchedule={canSchedule}
            disabledReason={scheduleDisabledReason}
          />
        </CardContent>
      </Card>

      <ContentOperationsPanel sections={operationSections} unavailableReason={operationsUnavailableReason} />

      {savedBrief && <SavedContentBriefCard summary={savedBrief} />}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Version History</CardTitle>
          </CardHeader>
          <CardContent>
            <ContentVersionHistory
              contentId={content.id}
              current={{ title: content.title, metaTitle: content.metaTitle, metaDescription: content.metaDescription, body: content.body }}
              revisions={revisions}
            />
          </CardContent>
        </Card>
      )}

      {canPublish && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publishing</CardTitle>
          </CardHeader>
          <CardContent>
            <PublishContentPanel contentId={content.id} connections={publicationState.map((state) => ({ id: state.connectionId, label: state.connectionLabel }))} publicationState={publicationState} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NoteForm action={addContentNote.bind(null, content.id)} />
            <NotesList
              notes={content.notes}
              currentUserId={user.id}
              canManage={canManage}
              onEdit={updateContentNote}
              onDelete={deleteContentNote}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline activities={content.activities} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canAct && <FileUploadForm entityType="content" entityId={content.id} />}
          <FileList files={files} canDelete={canManage} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
