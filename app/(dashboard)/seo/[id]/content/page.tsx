import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText, Plus } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import Pagination from "@/components/dashboard/Pagination";
import SearchInput from "@/components/dashboard/SearchInput";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ContentImportForm from "@/features/seo/components/ContentImportForm";
import ContentListTable from "@/features/seo/components/ContentListTable";
import { listContentForProject } from "@/features/seo/services/content.service";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type ContentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function ContentPage({ params, searchParams }: ContentPageProps) {
  const { id: seoProjectId } = await params;
  const user = await requireUser();

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  const canManage = Permissions.manageSeoProjects(user.role);
  const sp = await searchParams;
  const { content, totalCount, page, pageSize } = await listContentForProject(
    seoProjectId,
    sp
  );
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = sp.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title={`${seoProject.name} — Content`}
        description="Track articles and pages targeting your keywords."
        actions={
          <div className="flex gap-2">
            <a
              href={`/api/seo/${seoProjectId}/content/export`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download size={16} /> Export CSV
            </a>
            {canManage && (
              <Link
                href={`/seo/${seoProjectId}/content/new`}
                className={cn(buttonVariants())}
              >
                <Plus size={16} /> New content
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
            <ContentImportForm seoProjectId={seoProjectId} />
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action={`/seo/${seoProjectId}/content`}
          defaultValue={sp.q}
          placeholder="Search content..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href={`/seo/${seoProjectId}/content`}
            className={cn(
              buttonVariants({ variant: showingArchived ? "outline" : "secondary", size: "sm" })
            )}
          >
            Active
          </Link>
          <Link
            href={`/seo/${seoProjectId}/content?status=archived`}
            className={cn(
              buttonVariants({ variant: showingArchived ? "secondary" : "outline", size: "sm" })
            )}
          >
            Archived
          </Link>
        </div>
      </div>

      {content.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No content found"
          description="Try adjusting your search, or create the first content item."
        />
      ) : (
        <ContentListTable
          seoProjectId={seoProjectId}
          content={content}
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
          urlParams.set("page", String(targetPage));
          return `/seo/${seoProjectId}/content?${urlParams.toString()}`;
        }}
      />
    </PageContainer>
  );
}
