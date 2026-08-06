import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ClientForm from "@/features/clients/components/ClientForm";
import { getClientById } from "@/features/clients/services/client.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, assertPermission, Permissions } from "@/lib/authorization";

type EditClientPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditClientPage({ params }: EditClientPageProps) {
  const { id } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageClients);

  const client = await getClientById(id);
  if (!client) {
    notFound();
  }

  assertCompanyAccess(user, client.companyId);

  const userOptions = await listUserOptions(user.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${client.name}`}
        description="Update this client's profile."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Client details</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm client={client} userOptions={userOptions} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
