import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LeadForm from "@/features/leads/components/LeadForm";
import { getLeadById } from "@/features/leads/services/lead.service";
import { listClientOptions } from "@/features/clients/services/client.service";
import { listProjectOptions } from "@/features/projects/services/project.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

type EditLeadPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditLeadPage({ params }: EditLeadPageProps) {
  const { id } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageLeads);

  const lead = await getLeadById(id);
  if (!lead) {
    notFound();
  }

  assertCompanyAccess(user, lead.companyId);

  const [userOptions, clientOptions, projectOptions] = await Promise.all([
    listUserOptions(user.companyId),
    listClientOptions(user.companyId),
    listProjectOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${lead.name}`}
        description="Update this lead's details."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Lead details</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadForm
            lead={lead}
            userOptions={userOptions}
            clientOptions={clientOptions}
            projectOptions={projectOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
