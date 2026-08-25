import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Layers, ListChecks, Pencil } from "lucide-react";

import ActivityTimeline from "@/components/dashboard/ActivityTimeline";
import DashboardGrid from "@/components/dashboard/DashboardGrid";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import FileList from "@/components/dashboard/FileList";
import FileUploadForm from "@/components/dashboard/FileUploadForm";
import NoteForm from "@/components/dashboard/NoteForm";
import NotesList from "@/components/dashboard/NotesList";
import PageContainer from "@/components/dashboard/PageContainer";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import StatsCard from "@/components/dashboard/StatsCard";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  addSeoProjectNote,
  archiveSeoProject,
  deleteSeoProjectNote,
  restoreSeoProject,
  updateSeoProjectNote,
} from "@/features/seo/actions/seo-project.actions";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { listWebsiteAnalysisHistory } from "@/features/seo/services/website-analysis.service";
import { listFilesFor } from "@/features/files/services/file.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn, formatEnumLabel } from "@/lib/utils";

type SeoProjectDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SeoProjectDetailPage({
  params,
}: SeoProjectDetailPageProps) {
  const { id } = await params;
  const user = await requireUser();

  const seoProject = await getSeoProjectById(id);
  if (!seoProject) {
    notFound();
  }

  assertCompanyAccess(user, seoProject.companyId);

  const canManage = Permissions.manageSeoProjects(user.role);
  const canAct = canManage || seoProject.ownerId === user.id;
  const [files, analysisHistory] = await Promise.all([
    listFilesFor("seoProject", seoProject.id),
    listWebsiteAnalysisHistory(user.companyId, { seoProjectId: seoProject.id }),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title={seoProject.name}
        description={seoProject.domain}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={`/seo/${seoProject.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil size={16} /> Edit
              </Link>
              {seoProject.deletedAt ? (
                <RecordActionButton
                  id={seoProject.id}
                  action={restoreSeoProject}
                  label="Restore"
                  successMessage="SEO project restored"
                />
              ) : (
                <RecordActionButton
                  id={seoProject.id}
                  action={archiveSeoProject}
                  label="Archive"
                  variant="destructive"
                  confirmMessage="Archive this SEO project?"
                  successMessage="SEO project archived"
                />
              )}
            </div>
          ) : undefined
        }
      />

      <DashboardGrid>
        <StatsCard
          title="Keyword Clusters"
          value={seoProject._count.keywordClusters}
          icon={Layers}
        />
        <StatsCard title="Keywords" value={seoProject._count.keywords} icon={ListChecks} />
        <StatsCard title="Content" value={seoProject._count.content} icon={FileText} />
      </DashboardGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <StatusBadge status={seoProject.deletedAt ? "ARCHIVED" : seoProject.status} />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Client</span>
              {seoProject.client ? (
                <Link href={`/clients/${seoProject.client.id}`} className="hover:underline">
                  {seoProject.client.name}
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Owner</span>
              <span>
                {seoProject.owner
                  ? `${seoProject.owner.firstName} ${seoProject.owner.lastName}`
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Start date</span>
              <span>
                {seoProject.startDate
                  ? seoProject.startDate.toLocaleDateString()
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Keyword clusters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {seoProject.keywordClusters.length === 0 && (
              <p className="text-sm text-slate-500">No clusters yet.</p>
            )}
            {seoProject.keywordClusters.map((cluster) => (
              <Link
                key={cluster.id}
                href={`/seo/${seoProject.id}/clusters/${cluster.id}`}
                className="flex items-center justify-between text-sm hover:underline"
              >
                <span>{cluster.name}</span>
                <span className="text-slate-500">{cluster._count.keywords} keywords</span>
              </Link>
            ))}
            <Link
              href={`/seo/${seoProject.id}/clusters`}
              className="mt-2 text-sm font-medium hover:underline"
            >
              View all clusters →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent keywords</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {seoProject.keywords.length === 0 && (
              <p className="text-sm text-slate-500">No keywords yet.</p>
            )}
            {seoProject.keywords.map((keyword) => (
              <Link
                key={keyword.id}
                href={`/seo/${seoProject.id}/keywords/${keyword.id}`}
                className="flex items-center justify-between text-sm hover:underline"
              >
                <span>{keyword.term}</span>
                <span className="text-slate-500">{keyword.currentRank ?? "—"}</span>
              </Link>
            ))}
            <Link
              href={`/seo/${seoProject.id}/keywords`}
              className="mt-2 text-sm font-medium hover:underline"
            >
              View all keywords →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent content</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {seoProject.content.length === 0 && (
            <p className="text-sm text-slate-500">No content yet.</p>
          )}
          {seoProject.content.map((item) => (
            <Link
              key={item.id}
              href={`/seo/${seoProject.id}/content/${item.id}`}
              className="flex items-center justify-between text-sm hover:underline"
            >
              <span>{item.title}</span>
              <span className="text-slate-500">{formatEnumLabel(item.status)}</span>
            </Link>
          ))}
          <Link
            href={`/seo/${seoProject.id}/content`}
            className="mt-2 text-sm font-medium hover:underline"
          >
            View all content →
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Website analyses</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {analysisHistory.length === 0 && (
            <p className="text-sm text-slate-500">No analyses run for this project yet.</p>
          )}
          {analysisHistory.slice(0, 3).map((entry) => (
            <Link
              key={entry.id}
              href={`/seo/website-analysis?jobId=${entry.id}`}
              className="flex items-center justify-between text-sm hover:underline"
            >
              <span>{entry.domain}</span>
              <span className="text-slate-500">
                {entry.overallScore !== null ? `${entry.overallScore}/100` : formatEnumLabel(entry.status)}
              </span>
            </Link>
          ))}
          <div className="mt-2 flex items-center justify-between text-sm">
            <Link href={`/seo/${seoProject.id}/analysis-history`} className="font-medium hover:underline">
              View analysis history →
            </Link>
            <Link href={`/seo/website-analysis?seoProjectId=${seoProject.id}`} className="font-medium hover:underline">
              Analyze new website →
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NoteForm action={addSeoProjectNote.bind(null, seoProject.id)} />
            <NotesList
              notes={seoProject.notes}
              currentUserId={user.id}
              canManage={canManage}
              onEdit={updateSeoProjectNote}
              onDelete={deleteSeoProjectNote}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline activities={seoProject.activities} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canAct && <FileUploadForm entityType="seoProject" entityId={seoProject.id} />}
          <FileList files={files} canDelete={canManage} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
