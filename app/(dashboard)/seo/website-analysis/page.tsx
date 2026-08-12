import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { listClientOptions } from "@/features/clients/services/client.service";
import WebsiteAnalysisWorkspace from "@/features/seo/components/WebsiteAnalysisWorkspace";
import {
  getWebsiteAnalysisJobById,
  listRecentWebsiteAnalysisJobs,
} from "@/features/seo/services/website-analysis.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

type WebsiteAnalysisPageProps = {
  searchParams: Promise<{ jobId?: string }>;
};

export default async function WebsiteAnalysisPage({ searchParams }: WebsiteAnalysisPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const { jobId } = await searchParams;
  const [history, clientOptions, initialJob] = await Promise.all([
    listRecentWebsiteAnalysisJobs(user.companyId),
    listClientOptions(user.companyId),
    jobId ? getWebsiteAnalysisJobById(jobId) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title="Website Analysis"
        description="Enter a domain to automatically detect its business type, services, locations, and content topics."
      />

      <WebsiteAnalysisWorkspace
        initialHistory={history}
        clientOptions={clientOptions}
        initialJob={initialJob && initialJob.companyId === user.companyId ? initialJob : null}
      />
    </PageContainer>
  );
}
