import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveCluster, restoreCluster } from "@/features/seo/actions/keyword-cluster.actions";
import { getClusterById } from "@/features/seo/services/keyword-cluster.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn } from "@/lib/utils";

type ClusterDetailPageProps = {
  params: Promise<{ id: string; clusterId: string }>;
};

export default async function ClusterDetailPage({ params }: ClusterDetailPageProps) {
  const { id: seoProjectId, clusterId } = await params;
  const user = await requireUser();

  const cluster = await getClusterById(clusterId);
  if (!cluster || cluster.seoProjectId !== seoProjectId) {
    notFound();
  }

  assertCompanyAccess(user, cluster.seoProject.companyId);

  const canManage = Permissions.manageSeoProjects(user.role);

  return (
    <PageContainer>
      <DashboardHeader
        title={cluster.name}
        description={`Part of ${cluster.seoProject.name}.`}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={`/seo/${seoProjectId}/clusters/${cluster.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil size={16} /> Edit
              </Link>
              {cluster.deletedAt ? (
                <RecordActionButton
                  id={cluster.id}
                  action={restoreCluster}
                  label="Restore"
                  successMessage="Cluster restored"
                />
              ) : (
                <RecordActionButton
                  id={cluster.id}
                  action={archiveCluster}
                  label="Archive"
                  variant="destructive"
                  confirmMessage="Archive this cluster?"
                  successMessage="Cluster archived"
                />
              )}
            </div>
          ) : undefined
        }
      />

      {cluster.description && (
        <p className="text-sm text-slate-500">{cluster.description}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keywords in this cluster</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {cluster.keywords.length === 0 && (
            <p className="text-sm text-slate-500">No keywords assigned yet.</p>
          )}
          {cluster.keywords.map((keyword) => (
            <Link
              key={keyword.id}
              href={`/seo/${seoProjectId}/keywords/${keyword.id}`}
              className="flex items-center justify-between text-sm hover:underline"
            >
              <span>{keyword.term}</span>
              <span className="text-slate-500">{keyword.currentRank ?? "—"}</span>
            </Link>
          ))}
          <Link
            href={`/seo/${seoProjectId}/keywords?clusterId=${cluster.id}`}
            className="mt-2 text-sm font-medium hover:underline"
          >
            View all →
          </Link>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
