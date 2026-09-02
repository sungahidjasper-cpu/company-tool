import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Newspaper } from "lucide-react";
import Link from "next/link";

import PressReleaseGeneratorPicker from "@/features/ai-workspace/components/PressReleaseGeneratorPicker";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

export default async function NewPressReleaseGeneratorPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProjectOptions = await listSeoProjectOptions(user.companyId);

  return (
    <PageContainer>
      <DashboardHeader
        title="Press Release Generator"
        description="Drafts a press release from the announcement facts you provide, grounded in your company's Brand Profile. Nothing is saved automatically — copy the result to use it yourself."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={Newspaper}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to draft a press release."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <PressReleaseGeneratorPicker seoProjectOptions={seoProjectOptions} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
