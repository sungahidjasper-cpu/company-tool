import Link from "next/link";
import { notFound } from "next/navigation";
import { Layers, Plus } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import Pagination from "@/components/dashboard/Pagination";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import SearchInput from "@/components/dashboard/SearchInput";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { archiveCluster, restoreCluster } from "@/features/seo/actions/keyword-cluster.actions";
import { listClustersForProject } from "@/features/seo/services/keyword-cluster.service";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type ClustersPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function ClustersPage({ params, searchParams }: ClustersPageProps) {
  const { id: seoProjectId } = await params;
  const user = await requireUser();

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  const canManage = Permissions.manageSeoProjects(user.role);
  const sp = await searchParams;
  const { clusters, totalCount, page, pageSize } = await listClustersForProject(
    seoProjectId,
    sp
  );
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = sp.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title={`${seoProject.name} — Keyword Clusters`}
        description="Group related keywords together."
        actions={
          canManage ? (
            <Link
              href={`/seo/${seoProjectId}/clusters/new`}
              className={cn(buttonVariants())}
            >
              <Plus size={16} /> New cluster
            </Link>
          ) : undefined
        }
      />

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action={`/seo/${seoProjectId}/clusters`}
          defaultValue={sp.q}
          placeholder="Search clusters..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href={`/seo/${seoProjectId}/clusters`}
            className={cn(
              buttonVariants({ variant: showingArchived ? "outline" : "secondary", size: "sm" })
            )}
          >
            Active
          </Link>
          <Link
            href={`/seo/${seoProjectId}/clusters?status=archived`}
            className={cn(
              buttonVariants({ variant: showingArchived ? "secondary" : "outline", size: "sm" })
            )}
          >
            Archived
          </Link>
        </div>
      </div>

      {clusters.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No clusters found"
          description="Try adjusting your search, or create the first cluster."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Keywords</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {clusters.map((cluster) => (
                <TableRow key={cluster.id}>
                  <TableCell>
                    <Link
                      href={`/seo/${seoProjectId}/clusters/${cluster.id}`}
                      className="font-medium hover:underline"
                    >
                      {cluster.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">{cluster._count.keywords}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
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
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        buildHref={(targetPage) => {
          const params = new URLSearchParams();
          if (sp.q) params.set("q", sp.q);
          if (sp.status) params.set("status", sp.status);
          params.set("page", String(targetPage));
          return `/seo/${seoProjectId}/clusters?${params.toString()}`;
        }}
      />
    </PageContainer>
  );
}
