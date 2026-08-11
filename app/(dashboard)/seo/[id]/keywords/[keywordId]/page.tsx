import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveKeyword, restoreKeyword } from "@/features/seo/actions/keyword.actions";
import { getKeywordById } from "@/features/seo/services/keyword.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn, formatEnumLabel } from "@/lib/utils";

type KeywordDetailPageProps = {
  params: Promise<{ id: string; keywordId: string }>;
};

export default async function KeywordDetailPage({ params }: KeywordDetailPageProps) {
  const { id: seoProjectId, keywordId } = await params;
  const user = await requireUser();

  const keyword = await getKeywordById(keywordId);
  if (!keyword || keyword.seoProjectId !== seoProjectId) {
    notFound();
  }

  assertCompanyAccess(user, keyword.seoProject.companyId);

  const canManage = Permissions.manageSeoProjects(user.role);

  return (
    <PageContainer>
      <DashboardHeader
        title={keyword.term}
        description={`Part of ${keyword.seoProject.name}.`}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={`/seo/${seoProjectId}/keywords/${keyword.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil size={16} /> Edit
              </Link>
              {keyword.deletedAt ? (
                <RecordActionButton
                  id={keyword.id}
                  action={restoreKeyword}
                  label="Restore"
                  successMessage="Keyword restored"
                />
              ) : (
                <RecordActionButton
                  id={keyword.id}
                  action={archiveKeyword}
                  label="Archive"
                  variant="destructive"
                  confirmMessage="Archive this keyword?"
                  successMessage="Keyword archived"
                />
              )}
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <StatusBadge status={keyword.deletedAt ? "ARCHIVED" : keyword.status} />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Cluster</span>
              {keyword.cluster ? (
                <Link
                  href={`/seo/${seoProjectId}/clusters/${keyword.cluster.id}`}
                  className="hover:underline"
                >
                  {keyword.cluster.name}
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Owner</span>
              <span>
                {keyword.owner
                  ? `${keyword.owner.firstName} ${keyword.owner.lastName}`
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Search volume</span>
              <span>{keyword.searchVolume?.toLocaleString() ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Difficulty</span>
              <span>{keyword.difficulty ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Current rank</span>
              <span>{keyword.currentRank ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Intent</span>
              <span>{keyword.intent ? formatEnumLabel(keyword.intent) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Priority</span>
              <span>{formatEnumLabel(keyword.priority)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Target URL</span>
              {keyword.targetUrl ? (
                <a
                  href={keyword.targetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline"
                >
                  {keyword.targetUrl}
                </a>
              ) : (
                <span>—</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content targeting this keyword</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {keyword.content.length === 0 && (
              <p className="text-sm text-slate-500">No content targets this keyword yet.</p>
            )}
            {keyword.content.map((item) => (
              <Link
                key={item.id}
                href={`/seo/${seoProjectId}/content/${item.id}`}
                className="flex items-center justify-between text-sm hover:underline"
              >
                <span>{item.title}</span>
                <span className="text-slate-500">{formatEnumLabel(item.status)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
