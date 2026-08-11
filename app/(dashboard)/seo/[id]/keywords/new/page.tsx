import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KeywordForm from "@/features/seo/components/KeywordForm";
import { listClusterOptions } from "@/features/seo/services/keyword-cluster.service";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

type NewKeywordPageProps = {
  params: Promise<{ id: string }>;
};

export default async function NewKeywordPage({ params }: NewKeywordPageProps) {
  const { id: seoProjectId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  const [clusterOptions, userOptions] = await Promise.all([
    listClusterOptions(seoProjectId),
    listUserOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title="New keyword"
        description={`For ${seoProject.name}.`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Keyword details</CardTitle>
        </CardHeader>
        <CardContent>
          <KeywordForm
            seoProjectId={seoProjectId}
            clusterOptions={clusterOptions}
            userOptions={userOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
