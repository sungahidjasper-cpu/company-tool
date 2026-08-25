import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Sparkles } from "lucide-react";

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
import {
  addContentNote,
  archiveContent,
  deleteContentNote,
  restoreContent,
  updateContentNote,
} from "@/features/seo/actions/content.actions";
import AdvanceContentStatusButton from "@/features/seo/components/AdvanceContentStatusButton";
import ContentVersionHistory from "@/features/seo/components/ContentVersionHistory";
import { CONTENT_STATUS_ORDER } from "@/features/seo/schemas/content.schema";
import { getContentById } from "@/features/seo/services/content.service";
import { getContentRevisions } from "@/features/seo/services/content-revision.service";
import { listFilesFor } from "@/features/files/services/file.service";
import PublishContentPanel from "@/features/publishing/components/PublishContentPanel";
import { getContentPublicationState, isContentStatusPublishable } from "@/features/publishing/services/content-publication-state.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn, formatEnumLabel } from "@/lib/utils";

type ContentDetailPageProps = {
  params: Promise<{ id: string; contentId: string }>;
};

export default async function ContentDetailPage({ params }: ContentDetailPageProps) {
  const { id: seoProjectId, contentId } = await params;
  const user = await requireUser();

  const content = await getContentById(contentId);
  if (!content || content.seoProjectId !== seoProjectId) {
    notFound();
  }

  assertCompanyAccess(user, content.seoProject.companyId);

  const canManage = Permissions.manageSeoProjects(user.role);
  const canAct = canManage || content.authorId === user.id;
  const files = await listFilesFor("content", content.id);
  const canPublish = canManage && !content.deletedAt && !!content.body && isContentStatusPublishable(content.status);
  const publicationState = canPublish ? await getContentPublicationState(content.id, content.seoProject.companyId) : [];
  const revisions = canManage ? await getContentRevisions(content.id, content.seoProject.companyId) : [];

  const currentIndex = CONTENT_STATUS_ORDER.indexOf(content.status);
  const nextStatus = CONTENT_STATUS_ORDER[currentIndex + 1];

  return (
    <PageContainer>
      <DashboardHeader
        title={content.title}
        description={`Part of ${content.seoProject.name}.`}
        actions={
          canManage ? (
            <div className="flex gap-2">
              {nextStatus && !content.deletedAt && (
                <AdvanceContentStatusButton
                  contentId={content.id}
                  nextStatusLabel={formatEnumLabel(nextStatus)}
                />
              )}
              <Link
                href={`/seo/${seoProjectId}/content/${content.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil size={16} /> Edit
              </Link>
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
            <div className="flex justify-between">
              <span className="text-slate-500">Author</span>
              <span>
                {content.author
                  ? `${content.author.firstName} ${content.author.lastName}`
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Published</span>
              <span>
                {content.publishedAt ? content.publishedAt.toLocaleDateString() : "—"}
              </span>
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
            {content.keywords.map((keyword) => (
              <Link
                key={keyword.id}
                href={`/seo/${seoProjectId}/keywords/${keyword.id}`}
                className="text-sm hover:underline"
              >
                {keyword.term}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Article</CardTitle>
        </CardHeader>
        <CardContent>
          {content.body ? (
            <div className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
              {content.body}
            </div>
          ) : content.generatedByAi ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-slate-500">
                This content has a saved brief but no article yet.
              </p>
              <Link
                href={`/ai/content-brief/${content.id}/long-form`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Sparkles size={16} /> Generate Long-Form Content
              </Link>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No article body yet.</p>
          )}
        </CardContent>
      </Card>

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
