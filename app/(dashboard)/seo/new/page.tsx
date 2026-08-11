import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SeoProjectForm from "@/features/seo/components/SeoProjectForm";
import { listClientOptions } from "@/features/clients/services/client.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewSeoProjectPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const [clientOptions, userOptions] = await Promise.all([
    listClientOptions(user.companyId),
    listUserOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title="New SEO project"
        description="Track a new domain's search performance."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>SEO project details</CardTitle>
        </CardHeader>
        <CardContent>
          <SeoProjectForm clientOptions={clientOptions} userOptions={userOptions} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
