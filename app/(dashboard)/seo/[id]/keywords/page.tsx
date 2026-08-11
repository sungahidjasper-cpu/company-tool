import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ListChecks, Plus } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import Pagination from "@/components/dashboard/Pagination";
import SearchInput from "@/components/dashboard/SearchInput";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ClusterFilterSelect from "@/features/seo/components/ClusterFilterSelect";
import KeywordImportForm from "@/features/seo/components/KeywordImportForm";
import KeywordListTable from "@/features/seo/components/KeywordListTable";
import { listClusterOptions } from "@/features/seo/services/keyword-cluster.service";
import { listKeywordsForProject } from "@/features/seo/services/keyword.service";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type KeywordsPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string; status?: string; clusterId?: string }>;
};

export default async function KeywordsPage({ params, searchParams }: KeywordsPageProps) {
  const { id: seoProjectId } = await params;
  const user = await requireUser();

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  const canManage = Permissions.manageSeoProjects(user.role);
  const sp = await searchParams;
  const [{ keywords, totalCount, page, pageSize }, clusterOptions] = await Promise.all([
    listKeywordsForProject(seoProjectId, sp),
    listClusterOptions(seoProjectId),
  ]);
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = sp.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title={`${seoProject.name} — Keywords`}
        description="Track terms, rankings, and search demand."
        actions={
          <div className="flex gap-2">
            <a
              href={`/api/seo/${seoProjectId}/keywords/export`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download size={16} /> Export CSV
            </a>
            {canManage && (
              <Link
                href={`/seo/${seoProjectId}/keywords/new`}
                className={cn(buttonVariants())}
              >
                <Plus size={16} /> New keyword
              </Link>
            )}
          </div>
        }
      />

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bulk import</CardTitle>
          </CardHeader>
          <CardContent>
            <KeywordImportForm seoProjectId={seoProjectId} />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            action={`/seo/${seoProjectId}/keywords`}
            defaultValue={sp.q}
            placeholder="Search keywords..."
            hiddenFields={showingArchived ? { status: "archived" } : undefined}
          />
          <ClusterFilterSelect
            seoProjectId={seoProjectId}
            clusterOptions={clusterOptions}
            currentClusterId={sp.clusterId}
            q={sp.q}
            status={sp.status}
          />
        </div>

        <div className="flex gap-2">
          <Link
            href={`/seo/${seoProjectId}/keywords`}
            className={cn(
              buttonVariants({ variant: showingArchived ? "outline" : "secondary", size: "sm" })
            )}
          >
            Active
          </Link>
          <Link
            href={`/seo/${seoProjectId}/keywords?status=archived`}
            className={cn(
              buttonVariants({ variant: showingArchived ? "secondary" : "outline", size: "sm" })
            )}
          >
            Archived
          </Link>
        </div>
      </div>

      {keywords.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No keywords found"
          description="Try adjusting your search or filters, or add the first keyword."
        />
      ) : (
        <KeywordListTable
          seoProjectId={seoProjectId}
          keywords={keywords}
          canManage={canManage}
          showingArchived={showingArchived}
        />
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        buildHref={(targetPage) => {
          const urlParams = new URLSearchParams();
          if (sp.q) urlParams.set("q", sp.q);
          if (sp.status) urlParams.set("status", sp.status);
          if (sp.clusterId) urlParams.set("clusterId", sp.clusterId);
          urlParams.set("page", String(targetPage));
          return `/seo/${seoProjectId}/keywords?${urlParams.toString()}`;
        }}
      />
    </PageContainer>
  );
}
