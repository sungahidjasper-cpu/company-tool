import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KeywordForm from "@/features/seo/components/KeywordForm";
import { listClusterOptions } from "@/features/seo/services/keyword-cluster.service";
import { getKeywordById } from "@/features/seo/services/keyword.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

type EditKeywordPageProps = {
  params: Promise<{ id: string; keywordId: string }>;
};

export default async function EditKeywordPage({ params }: EditKeywordPageProps) {
  const { id: seoProjectId, keywordId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const keyword = await getKeywordById(keywordId);
  if (!keyword || keyword.seoProjectId !== seoProjectId) {
    notFound();
  }
  assertCompanyAccess(user, keyword.seoProject.companyId);

  const [clusterOptions, userOptions] = await Promise.all([
    listClusterOptions(seoProjectId),
    listUserOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${keyword.term}`}
        description={`Part of ${keyword.seoProject.name}.`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Keyword details</CardTitle>
        </CardHeader>
        <CardContent>
          <KeywordForm
            seoProjectId={seoProjectId}
            keyword={keyword}
            clusterOptions={clusterOptions}
            userOptions={userOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
