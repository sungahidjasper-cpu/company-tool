import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import AnalysisHistoryList from "@/features/seo/components/AnalysisHistoryList";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { listWebsiteAnalysisHistory } from "@/features/seo/services/website-analysis.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess } from "@/lib/authorization";

type AnalysisHistoryPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AnalysisHistoryPage({ params }: AnalysisHistoryPageProps) {
  const { id: seoProjectId } = await params;
  const user = await requireUser();

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  const history = await listWebsiteAnalysisHistory(user.companyId, { seoProjectId });

  return (
    <PageContainer>
      <DashboardHeader
        title={`${seoProject.name} — Analysis History`}
        description="Every website analysis ever run for this project, newest first. Select two to compare."
      />

      <Card>
        <CardContent>
          <AnalysisHistoryList seoProjectId={seoProjectId} history={history} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
