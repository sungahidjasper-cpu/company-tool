import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ContentForm from "@/features/seo/components/ContentForm";
import { getContentById } from "@/features/seo/services/content.service";
import { listKeywordOptions } from "@/features/seo/services/keyword.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

type EditContentPageProps = {
  params: Promise<{ id: string; contentId: string }>;
};

export default async function EditContentPage({ params }: EditContentPageProps) {
  const { id: seoProjectId, contentId } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const content = await getContentById(contentId);
  if (!content || content.seoProjectId !== seoProjectId) {
    notFound();
  }
  assertCompanyAccess(user, content.seoProject.companyId);

  const [userOptions, keywordOptions] = await Promise.all([
    listUserOptions(user.companyId),
    listKeywordOptions(seoProjectId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${content.title}`}
        description={`Part of ${content.seoProject.name}.`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Content details</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentForm
            seoProjectId={seoProjectId}
            content={content}
            userOptions={userOptions}
            keywordOptions={keywordOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
