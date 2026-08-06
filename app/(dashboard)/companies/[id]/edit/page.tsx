import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CompanyForm from "@/features/companies/components/CompanyForm";
import { getCompanyById } from "@/features/companies/services/company.service";
import { requireUser } from "@/lib/auth";
import { hasMinimumRole, Permissions, ForbiddenError } from "@/lib/authorization";

type EditCompanyPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCompanyPage({
  params,
}: EditCompanyPageProps) {
  const { id } = await params;
  const user = await requireUser();

  const company = await getCompanyById(id);
  if (!company) {
    notFound();
  }

  const canEdit =
    Permissions.manageCompanies(user.role) ||
    (hasMinimumRole(user.role, "ADMIN") && user.companyId === company.id);

  if (!canEdit) {
    throw new ForbiddenError("You do not have permission to edit this company.");
  }

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${company.name}`}
        description="Update this company's profile."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Company details</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyForm company={company} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
