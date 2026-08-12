import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { listClientOptions } from "@/features/clients/services/client.service";
import WebsiteAnalysisWorkspace from "@/features/seo/components/WebsiteAnalysisWorkspace";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import {
  getWebsiteAnalysisJobById,
  listRecentWebsiteAnalysisJobs,
} from "@/features/seo/services/website-analysis.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

type WebsiteAnalysisPageProps = {
  searchParams: Promise<{ jobId?: string; seoProjectId?: string }>;
};

export default async function WebsiteAnalysisPage({ searchParams }: WebsiteAnalysisPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const { jobId, seoProjectId } = await searchParams;
  const [history, clientOptions, initialJob, seoProjectOptions] = await Promise.all([
    listRecentWebsiteAnalysisJobs(user.companyId),
    listClientOptions(user.companyId),
    jobId ? getWebsiteAnalysisJobById(jobId) : Promise.resolve(null),
    // Only needed to resolve seoProjectId -> a display name, and to confirm it belongs
    // to this company — company-scoped, so a foreign/invalid id simply resolves to
    // nothing below (falls back to standalone) rather than leaking cross-company data.
    seoProjectId ? listSeoProjectOptions(user.companyId) : Promise.resolve(null),
  ]);

  const scopedSeoProject = seoProjectId ? seoProjectOptions?.find((option) => option.id === seoProjectId) ?? null : null;

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
        seoProjectId={scopedSeoProject?.id ?? null}
        seoProjectName={scopedSeoProject?.name ?? null}
      />
    </PageContainer>
  );
}
