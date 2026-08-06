import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ClientForm from "@/features/clients/components/ClientForm";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewClientPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageClients);

  const userOptions = await listUserOptions(user.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title="New client"
        description="Add a new client to your workspace."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Client details</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm userOptions={userOptions} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
