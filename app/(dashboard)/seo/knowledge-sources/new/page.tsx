import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KnowledgeSourceForm from "@/features/seo/components/KnowledgeSourceForm";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewKnowledgeSourcePage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  return (
    <PageContainer>
      <DashboardHeader
        title="New knowledge source"
        description="Add a verified, authoritative source your team can link to SEO projects."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Source details</CardTitle>
        </CardHeader>
        <CardContent>
          <KnowledgeSourceForm />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
