import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Search } from "lucide-react";
import Link from "next/link";

import ContentGapAnalysisPicker from "@/features/ai-workspace/components/ContentGapAnalysisPicker";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewContentGapAnalysisPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProjectOptions = await listSeoProjectOptions(user.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title="Content Gap Analysis"
        description="Surfaces content opportunities from the project's latest SEO audit, checked against your existing content. Nothing is saved — review and decide what to create or update yourself."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No SEO projects yet"
              description="Create an SEO project and run a Website Analysis first, then come back here to find content opportunities."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <ContentGapAnalysisPicker seoProjectOptions={seoProjectOptions} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
