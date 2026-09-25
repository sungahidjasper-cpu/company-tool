import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";
import Link from "next/link";

import CompetitorContentAnalysisPicker from "@/features/ai-workspace/components/CompetitorContentAnalysisPicker";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewCompetitorContentAnalysisPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  // Brand Profile is company-scoped by its own primary key, and the company id
  // comes from the authenticated actor — never from the client.
  const [seoProjectOptions, brandProfile] = await Promise.all([
    listSeoProjectOptions(user.companyId),
    getBrandProfileByCompanyId(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title="Competitor Content Analysis"
        description="Reads a sample of pages from a competitor's site and compares what they actually cover against your own content. Nothing is saved — copy the analysis you want to keep."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to analyse a competitor against it."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <CompetitorContentAnalysisPicker
              seoProjectOptions={seoProjectOptions}
              brandProfileCompetitorUrls={brandProfile?.competitorUrls ?? []}
            />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
