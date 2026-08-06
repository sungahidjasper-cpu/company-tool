import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TaskForm from "@/features/tasks/components/TaskForm";
import { getTaskById } from "@/features/tasks/services/task.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, assertPermission, Permissions } from "@/lib/authorization";

type EditTaskPageProps = {
  params: Promise<{ id: string; taskId: string }>;
};

export default async function EditTaskPage({ params }: EditTaskPageProps) {
  const { id: projectId, taskId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageProjects);

  const task = await getTaskById(taskId);
  if (!task || task.projectId !== projectId) {
    notFound();
  }

  assertCompanyAccess(user, task.project.companyId);

  const userOptions = await listUserOptions(user.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${task.title}`}
        description="Update this task's details."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Task details</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskForm projectId={projectId} task={task} userOptions={userOptions} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
