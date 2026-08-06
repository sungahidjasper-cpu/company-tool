import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TaskForm from "@/features/tasks/components/TaskForm";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

type NewTaskPageProps = {
  params: Promise<{ id: string }>;
};

export default async function NewTaskPage({ params }: NewTaskPageProps) {
  const { id: projectId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageProjects);

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    notFound();
  }

  assertCompanyAccess(user, project.companyId);

  const userOptions = await listUserOptions(user.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title="New task"
        description={`Add a task to ${project.name}.`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Task details</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskForm projectId={projectId} userOptions={userOptions} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
