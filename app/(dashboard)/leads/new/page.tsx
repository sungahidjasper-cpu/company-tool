import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LeadForm from "@/features/leads/components/LeadForm";
import { listClientOptions } from "@/features/clients/services/client.service";
import { listProjectOptions } from "@/features/projects/services/project.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewLeadPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageLeads);

  const [userOptions, clientOptions, projectOptions] = await Promise.all([
    listUserOptions(user.companyId),
    listClientOptions(user.companyId),
    listProjectOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title="New lead"
        description="Add a new prospective deal to your pipeline."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Lead details</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadForm
            userOptions={userOptions}
            clientOptions={clientOptions}
            projectOptions={projectOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
