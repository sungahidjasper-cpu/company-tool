import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";

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
  archiveProject,
  restoreProject,
} from "@/features/projects/actions/project.actions";
import { listProjects } from "@/features/projects/services/project.service";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { getTotalPages } from "@/lib/pagination";
import { cn, formatEnumLabel } from "@/lib/utils";

type ProjectsPageProps = {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps) {
  const user = await requireUser();
  const canManage = Permissions.manageProjects(user.role);

  const params = await searchParams;
  const { projects, totalCount, page, pageSize } = await listProjects(
    user.companyId,
    params
  );
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = params.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title="Projects"
        description="Track your company's projects and deliverables."
        actions={
          canManage ? (
            <Link href="/projects/new" className={cn(buttonVariants())}>
              <Plus size={16} /> New project
            </Link>
          ) : undefined
        }
      />

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action="/projects"
          defaultValue={params.q}
          placeholder="Search projects..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href="/projects"
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
            href="/projects?status=archived"
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

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects found"
          description="Try adjusting your search, or create the first project."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                {canManage && (
                  <TableHead className="text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-medium hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {project.client?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {project.owner
                      ? `${project.owner.firstName} ${project.owner.lastName}`
                      : "Unassigned"}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {formatEnumLabel(project.priority)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={project.deletedAt ? "ARCHIVED" : project.status}
                    />
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {project.deletedAt ? (
                        <RecordActionButton
                          id={project.id}
                          action={restoreProject}
                          label="Restore"
                          successMessage="Project restored"
                        />
                      ) : (
                        <RecordActionButton
                          id={project.id}
                          action={archiveProject}
                          label="Archive"
                          variant="destructive"
                          confirmMessage="Archive this project?"
                          successMessage="Project archived"
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
          return `/projects?${sp.toString()}`;
        }}
      />
    </PageContainer>
  );
}
