import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import ExistingBriefLongFormGenerator from "@/features/ai-workspace/components/ExistingBriefLongFormGenerator";
import { getContentById } from "@/features/seo/services/content.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, assertPermission, Permissions } from "@/lib/authorization";

type GenerateLongFormFromContentPageProps = {
  params: Promise<{ contentId: string }>;
};

export default async function GenerateLongFormFromContentPage({ params }: GenerateLongFormFromContentPageProps) {
  const { contentId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const content = await getContentById(contentId);
  if (!content) {
    notFound();
  }
  assertCompanyAccess(user, content.seoProject.companyId);

  // Only reachable for a row Phase 15's saveContentBriefAction already
  // populated — a manually-authored row, or one with no saved brief,
  // has nothing for this flow to generate an article from.
  if (!content.generatedByAi || !content.metaTitle || !content.metaDescription || !content.aiBriefDetails) {
    notFound();
  }

  return (
    <PageContainer>
      <DashboardHeader title="Generate Long-Form Content" description={`From the saved brief for "${content.title}."`} />
      <Card>
        <CardContent>
          <ExistingBriefLongFormGenerator
            contentId={content.id}
            seoProjectId={content.seoProjectId}
            title={content.title}
            metaTitle={content.metaTitle}
            metaDescription={content.metaDescription}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
