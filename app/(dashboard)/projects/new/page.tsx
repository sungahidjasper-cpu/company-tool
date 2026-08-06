import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listClientOptions } from "@/features/clients/services/client.service";
import ProjectForm from "@/features/projects/components/ProjectForm";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewProjectPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageProjects);

  const [userOptions, clientOptions] = await Promise.all([
    listUserOptions(user.companyId),
    listClientOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title="New project"
        description="Create a new project for your workspace."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm userOptions={userOptions} clientOptions={clientOptions} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
