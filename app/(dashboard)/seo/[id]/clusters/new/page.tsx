import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KeywordClusterForm from "@/features/seo/components/KeywordClusterForm";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

type NewClusterPageProps = {
  params: Promise<{ id: string }>;
};

export default async function NewClusterPage({ params }: NewClusterPageProps) {
  const { id: seoProjectId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title="New keyword cluster"
        description={`For ${seoProject.name}.`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Cluster details</CardTitle>
        </CardHeader>
        <CardContent>
          <KeywordClusterForm seoProjectId={seoProjectId} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
