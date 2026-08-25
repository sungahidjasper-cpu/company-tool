import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  addProjectNote,
  archiveProject,
  deleteProjectNote,
  restoreProject,
  updateProjectNote,
} from "@/features/projects/actions/project.actions";
import { listFilesFor } from "@/features/files/services/file.service";
import { getProjectById } from "@/features/projects/services/project.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn, formatEnumLabel } from "@/lib/utils";

type ProjectDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { id } = await params;
  const user = await requireUser();

  const project = await getProjectById(id);
  if (!project) {
    notFound();
  }

  assertCompanyAccess(user, project.companyId);

  const canManage = Permissions.manageProjects(user.role);
  const files = await listFilesFor("project", project.id);

  const taskCounts = project.tasks.reduce<Record<string, number>>(
    (acc, task) => {
      acc[task.status] = (acc[task.status] ?? 0) + 1;
      return acc;
    },
    {}
  );

  return (
    <PageContainer>
      <DashboardHeader
        title={project.name}
        description={project.client?.name ?? "No client assigned"}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={`/projects/${project.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil size={16} /> Edit
              </Link>
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
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overview</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <StatusBadge
                status={project.deletedAt ? "ARCHIVED" : project.status}
              />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Priority</span>
              <span>{formatEnumLabel(project.priority)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Owner</span>
              <span>
                {project.owner
                  ? `${project.owner.firstName} ${project.owner.lastName}`
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Start date</span>
              <span>
                {project.startDate
                  ? project.startDate.toLocaleDateString()
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">End date</span>
              <span>
                {project.dueDate ? project.dueDate.toLocaleDateString() : "—"}
              </span>
            </div>
            {project.description && (
              <p className="border-t border-slate-200 pt-3 text-slate-600">
                {project.description}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assigned users</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {project.assignedUsers.length === 0 && (
              <p className="text-sm text-slate-500">No users assigned.</p>
            )}
            {project.assignedUsers.map((assignee) => (
              <Link
                key={assignee.id}
                href={`/users/${assignee.id}`}
                className="text-sm hover:underline"
              >
                {assignee.firstName} {assignee.lastName}
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasks</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {project.tasks.length === 0 && (
              <p className="text-slate-500">No tasks yet.</p>
            )}
            {Object.entries(taskCounts).map(([status, count]) => (
              <div key={status} className="flex justify-between">
                <span className="text-slate-500">{formatEnumLabel(status)}</span>
                <span>{count}</span>
              </div>
            ))}
            <Link
              href={`/projects/${project.id}/tasks`}
              className="mt-2 text-sm font-medium hover:underline"
            >
              View all tasks →
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NoteForm action={addProjectNote.bind(null, project.id)} />
            <NotesList
              notes={project.notes}
              currentUserId={user.id}
              canManage={canManage}
              onEdit={updateProjectNote}
              onDelete={deleteProjectNote}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline activities={project.activities} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canManage && (
            <FileUploadForm entityType="project" entityId={project.id} />
          )}
          <FileList files={files} canDelete={canManage} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
