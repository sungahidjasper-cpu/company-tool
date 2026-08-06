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
  addTaskComment,
  archiveTask,
  restoreTask,
} from "@/features/tasks/actions/task.actions";
import QuickAddSubtask from "@/features/tasks/components/QuickAddSubtask";
import TaskStatusSelect from "@/features/tasks/components/TaskStatusSelect";
import { getTaskById } from "@/features/tasks/services/task.service";
import { listFilesFor } from "@/features/files/services/file.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, Permissions } from "@/lib/authorization";
import { cn, formatEnumLabel } from "@/lib/utils";

type TaskDetailPageProps = {
  params: Promise<{ id: string; taskId: string }>;
};

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id: projectId, taskId } = await params;
  const user = await requireUser();

  const task = await getTaskById(taskId);
  if (!task || task.projectId !== projectId) {
    notFound();
  }

  assertCompanyAccess(user, task.project.companyId);

  const canManage = Permissions.manageProjects(user.role);
  const canActOnStatus = canManage || task.assigneeId === user.id;
  const files = await listFilesFor("task", task.id);

  return (
    <PageContainer>
      <DashboardHeader
        title={task.title}
        description={
          task.parentTask
            ? `Subtask of "${task.parentTask.title}"`
            : `Part of ${task.project.name}`
        }
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Link
                href={`/projects/${projectId}/tasks/${task.id}/edit`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <Pencil size={16} /> Edit
              </Link>
              {task.deletedAt ? (
                <RecordActionButton
                  id={task.id}
                  action={restoreTask}
                  label="Restore"
                  successMessage="Task restored"
                />
              ) : (
                <RecordActionButton
                  id={task.id}
                  action={archiveTask}
                  label="Archive"
                  variant="destructive"
                  confirmMessage="Archive this task?"
                  successMessage="Task archived"
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
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Status</span>
              {canActOnStatus ? (
                <TaskStatusSelect taskId={task.id} status={task.status} />
              ) : (
                <StatusBadge status={task.deletedAt ? "ARCHIVED" : task.status} />
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Priority</span>
              <span>{formatEnumLabel(task.priority)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Assignee</span>
              <span>
                {task.assignee
                  ? `${task.assignee.firstName} ${task.assignee.lastName}`
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Due date</span>
              <span>
                {task.dueDate ? task.dueDate.toLocaleDateString() : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Created by</span>
              <span>
                {task.createdBy
                  ? `${task.createdBy.firstName} ${task.createdBy.lastName}`
                  : "—"}
              </span>
            </div>
            {task.parentTask && (
              <div className="flex justify-between">
                <span className="text-slate-500">Parent task</span>
                <Link
                  href={`/projects/${projectId}/tasks/${task.parentTask.id}`}
                  className="hover:underline"
                >
                  {task.parentTask.title}
                </Link>
              </div>
            )}
            {task.description && (
              <p className="border-t border-slate-200 pt-3 text-slate-600">
                {task.description}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subtasks</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {task.subtasks.length === 0 && (
              <p className="text-sm text-slate-500">No subtasks yet.</p>
            )}
            {task.subtasks.map((subtask) => (
              <div
                key={subtask.id}
                className="flex items-center justify-between text-sm"
              >
                <Link
                  href={`/projects/${projectId}/tasks/${subtask.id}`}
                  className="hover:underline"
                >
                  {subtask.title}
                </Link>
                <StatusBadge status={subtask.status} />
              </div>
            ))}
            {canManage && <QuickAddSubtask parentTaskId={task.id} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline activities={task.activities} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <NoteForm action={addTaskComment.bind(null, task.id)} />
          <NotesList notes={task.notes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canActOnStatus && (
            <FileUploadForm entityType="task" entityId={task.id} />
          )}
          <FileList files={files} canDelete={canActOnStatus} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
