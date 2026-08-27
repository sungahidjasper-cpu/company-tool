import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KnowledgeSourceForm from "@/features/seo/components/KnowledgeSourceForm";
import { getKnowledgeSourceById } from "@/features/seo/services/knowledge-source.service";
import { requireUser } from "@/lib/auth";
import { assertCompanyAccess, assertPermission, Permissions } from "@/lib/authorization";

type EditKnowledgeSourcePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditKnowledgeSourcePage({ params }: EditKnowledgeSourcePageProps) {
  const { id } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const knowledgeSource = await getKnowledgeSourceById(id);
  if (!knowledgeSource) {
    notFound();
  }

  assertCompanyAccess(user, knowledgeSource.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${knowledgeSource.title}`}
        description={knowledgeSource.deletedAt ? "This source is archived." : "Update this knowledge source's details."}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Source details</CardTitle>
        </CardHeader>
        <CardContent>
          <KnowledgeSourceForm knowledgeSource={knowledgeSource} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
