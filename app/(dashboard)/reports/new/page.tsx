import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ReportForm from "@/features/reports/components/ReportForm";
import { listClientOptions } from "@/features/clients/services/client.service";
import { listProjectOptions } from "@/features/projects/services/project.service";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewReportPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageReports);

  const [clientOptions, projectOptions, seoProjectOptions] = await Promise.all([
    listClientOptions(user.companyId),
    listProjectOptions(user.companyId),
    listSeoProjectOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title="Generate report"
        description="Choose a report type and, optionally, scope it to one client or project."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Report details</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportForm
            clientOptions={clientOptions}
            projectOptions={projectOptions}
            seoProjectOptions={seoProjectOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
