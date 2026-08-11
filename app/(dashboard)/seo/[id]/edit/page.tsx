import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SeoProjectForm from "@/features/seo/components/SeoProjectForm";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { listClientOptions } from "@/features/clients/services/client.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

type EditSeoProjectPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditSeoProjectPage({ params }: EditSeoProjectPageProps) {
  const { id } = await params;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProject = await getSeoProjectById(id);
  if (!seoProject) {
    notFound();
  }

  assertCompanyAccess(user, seoProject.companyId);

  const [clientOptions, userOptions] = await Promise.all([
    listClientOptions(user.companyId),
    listUserOptions(user.companyId),
  ]);

  return (
    <PageContainer>
      <DashboardHeader
        title={`Edit ${seoProject.name}`}
        description="Update this SEO project's details."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>SEO project details</CardTitle>
        </CardHeader>
        <CardContent>
          <SeoProjectForm
            seoProject={seoProject}
            clientOptions={clientOptions}
            userOptions={userOptions}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
