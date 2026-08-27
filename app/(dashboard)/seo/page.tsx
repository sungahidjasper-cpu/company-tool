import Link from "next/link";
import { BookMarked, Plus, Search, Sparkles } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import Pagination from "@/components/dashboard/Pagination";
import RecordActionButton from "@/components/dashboard/RecordActionButton";
import SearchInput from "@/components/dashboard/SearchInput";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  archiveSeoProject,
  restoreSeoProject,
} from "@/features/seo/actions/seo-project.actions";
import { listSeoProjects } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type SeoPageProps = {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function SeoPage({ searchParams }: SeoPageProps) {
  const user = await requireUser();
  const canManage = Permissions.manageSeoProjects(user.role);

  const params = await searchParams;
  const { seoProjects, totalCount, page, pageSize } = await listSeoProjects(
    user.companyId,
    params
  );
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = params.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title="SEO Workspace"
        description="Track keywords, content, and search performance."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href="/seo/website-analysis"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Sparkles size={16} /> Website Analysis
              </Link>
              <Link
                href="/seo/knowledge-sources"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <BookMarked size={16} /> Knowledge Sources
              </Link>
              <Link href="/seo/new" className={cn(buttonVariants())}>
                <Plus size={16} /> New SEO project
              </Link>
            </div>
          ) : undefined
        }
      />

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action="/seo"
          defaultValue={params.q}
          placeholder="Search SEO projects..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href="/seo"
            className={cn(
              buttonVariants({
                variant: showingArchived ? "outline" : "secondary",
                size: "sm",
              })
            )}
          >
            Active
          </Link>
          <Link
            href="/seo?status=archived"
            className={cn(
              buttonVariants({
                variant: showingArchived ? "secondary" : "outline",
                size: "sm",
              })
            )}
          >
            Archived
          </Link>
        </div>
      </div>

      {seoProjects.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No SEO projects found"
          description="Try adjusting your search, or create the first SEO project."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Keywords</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {seoProjects.map((seoProject) => (
                <TableRow key={seoProject.id}>
                  <TableCell>
                    <Link
                      href={`/seo/${seoProject.id}`}
                      className="font-medium hover:underline"
                    >
                      {seoProject.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">{seoProject.domain}</TableCell>
                  <TableCell className="text-slate-500">
                    {seoProject.client?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {seoProject._count.keywords}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {seoProject._count.content}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={seoProject.deletedAt ? "ARCHIVED" : seoProject.status}
                    />
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
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
          const sp = new URLSearchParams();
          if (params.q) sp.set("q", params.q);
          if (params.status) sp.set("status", params.status);
          sp.set("page", String(targetPage));
          return `/seo?${sp.toString()}`;
        }}
      />
    </PageContainer>
  );
}
