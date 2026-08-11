import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ContentForm from "@/features/seo/components/ContentForm";
import { listKeywordOptions } from "@/features/seo/services/keyword.service";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

type NewContentPageProps = {
  params: Promise<{ id: string }>;
};

export default async function NewContentPage({ params }: NewContentPageProps) {
  const { id: seoProjectId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  const [userOptions, keywordOptions] = await Promise.all([
    listUserOptions(user.companyId),
    listKeywordOptions(seoProjectId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title="New content"
        description={`For ${seoProject.name}.`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Content details</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentForm
            seoProjectId={seoProjectId}
            userOptions={userOptions}
            keywordOptions={keywordOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
