import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckSquare, Plus } from "lucide-react";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import Pagination from "@/components/dashboard/Pagination";
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
import { listTasksForProject } from "@/features/tasks/services/task.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { getTotalPages } from "@/lib/pagination";
import { cn, formatEnumLabel } from "@/lib/utils";

type ProjectTasksPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
};

export default async function ProjectTasksPage({
  params,
  searchParams,
}: ProjectTasksPageProps) {
  const { id: projectId } = await params;
  const user = await requireUser();

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    notFound();
  }

  assertCompanyAccess(user, project.companyId);
  const canManage = Permissions.manageProjects(user.role);

  const sp = await searchParams;
  const { tasks, totalCount, page, pageSize } = await listTasksForProject(
    projectId,
    sp
  );
  const totalPages = getTotalPages(totalCount, pageSize);
  const showingArchived = sp.status === "archived";

  return (
    <PageContainer>
      <DashboardHeader
        title={`Tasks — ${project.name}`}
        description="Track work items for this project."
        actions={
          canManage ? (
            <Link
              href={`/projects/${projectId}/tasks/new`}
              className={cn(buttonVariants())}
            >
              <Plus size={16} /> New task
            </Link>
          ) : undefined
        }
      />

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          action={`/projects/${projectId}/tasks`}
          defaultValue={sp.q}
          placeholder="Search tasks..."
          hiddenFields={showingArchived ? { status: "archived" } : undefined}
        />

        <div className="flex gap-2">
          <Link
            href={`/projects/${projectId}/tasks`}
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
            href={`/projects/${projectId}/tasks?status=archived`}
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

      {tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks found"
          description="Try adjusting your search, or create the first task."
        />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Subtasks</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Link
                      href={`/projects/${projectId}/tasks/${task.id}`}
                      className="font-medium hover:underline"
                    >
                      {task.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {task.assignee
                      ? `${task.assignee.firstName} ${task.assignee.lastName}`
                      : "Unassigned"}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {formatEnumLabel(task.priority)}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {task._count.subtasks}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={task.deletedAt ? "ARCHIVED" : task.status}
                    />
                  </TableCell>
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
          return `/projects/${projectId}/tasks?${params.toString()}`;
        }}
      />
    </PageContainer>
  );
}
