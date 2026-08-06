import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listClientOptions } from "@/features/clients/services/client.service";
import ProjectForm from "@/features/projects/components/ProjectForm";
import { getProjectById } from "@/features/projects/services/project.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, assertPermission, Permissions } from "@/lib/authorization";

type EditProjectPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditProjectPage({
  params,
}: EditProjectPageProps) {
  const { id } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageProjects);

  const project = await getProjectById(id);
  if (!project) {
    notFound();
  }

  assertCompanyAccess(user, project.companyId);

  const [userOptions, clientOptions] = await Promise.all([
    listUserOptions(user.companyId),
    listClientOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${project.name}`}
        description="Update this project's details."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm
            project={project}
            userOptions={userOptions}
            clientOptions={clientOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
