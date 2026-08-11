import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KeywordClusterForm from "@/features/seo/components/KeywordClusterForm";
import { getClusterById } from "@/features/seo/services/keyword-cluster.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

type EditClusterPageProps = {
  params: Promise<{ id: string; clusterId: string }>;
};

export default async function EditClusterPage({ params }: EditClusterPageProps) {
  const { id: seoProjectId, clusterId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const cluster = await getClusterById(clusterId);
  if (!cluster || cluster.seoProjectId !== seoProjectId) {
    notFound();
  }
  assertCompanyAccess(user, cluster.seoProject.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${cluster.name}`}
        description={`Part of ${cluster.seoProject.name}.`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Cluster details</CardTitle>
        </CardHeader>
        <CardContent>
          <KeywordClusterForm seoProjectId={seoProjectId} cluster={cluster} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
