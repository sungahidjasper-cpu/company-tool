import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import AnalysisCompareView from "@/features/seo/components/AnalysisCompareView";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { getWebsiteAnalysisJobById } from "@/features/seo/services/website-analysis.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess } from "@/lib/authorization";

type CompareAnalysisPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
};

export default async function CompareAnalysisPage({ params, searchParams }: CompareAnalysisPageProps) {
  const { id: seoProjectId } = await params;
  const { a, b } = await searchParams;
  const user = await requireUser();

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  if (!a || !b) {
    notFound();
  }

  const [jobA, jobB] = await Promise.all([getWebsiteAnalysisJobById(a), getWebsiteAnalysisJobById(b)]);
  if (!jobA || !jobB || jobA.companyId !== user.companyId || jobB.companyId !== user.companyId) {
    notFound();
  }

  return (
    <PageContainer>
      <DashboardHeader
        title={`${seoProject.name} — Compare Analyses`}
        description={`Comparing ${jobA.domain} runs from ${jobA.createdAt.toLocaleDateString()} and ${jobB.createdAt.toLocaleDateString()}.`}
      />

      <AnalysisCompareView jobA={jobA} jobB={jobB} />
    </PageContainer>
  );
}
