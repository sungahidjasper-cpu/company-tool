import CompanyForm from "@/features/companies/components/CompanyForm";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";

export default async function NewCompanyPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageCompanies);

  return (
    <PageContainer>
      <DashboardHeader
        title="New company"
        description="Create a new tenant workspace."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Company details</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyForm />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
