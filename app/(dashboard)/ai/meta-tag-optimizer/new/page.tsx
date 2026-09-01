import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Tags } from "lucide-react";
import Link from "next/link";

import MetaTagOptimizerPicker from "@/features/ai-workspace/components/MetaTagOptimizerPicker";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export default async function NewMetaTagOptimizerPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const [seoProjectOptions, content] = await Promise.all([
    listSeoProjectOptions(user.companyId),
    prisma.content.findMany({
      where: { seoProject: { companyId: user.companyId }, deletedAt: null },
      select: { id: true, title: true, url: true, metaTitle: true, metaDescription: true, seoProjectId: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const contentByProject: Record<string, { id: string; title: string; url: string | null; currentMetaTitle: string | null; currentMetaDescription: string | null }[]> = {};
  for (const item of content) {
    (contentByProject[item.seoProjectId] ??= []).push({
      id: item.id,
      title: item.title,
      url: item.url,
      currentMetaTitle: item.metaTitle,
      currentMetaDescription: item.metaDescription,
    });
  }

  return (
    <PageContainer>
      <DashboardHeader
        title="Meta Tag Optimizer"
        description="Suggests improved meta titles and descriptions for existing pages. Nothing is saved automatically — review each suggestion before applying it yourself."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to optimize its content's meta tags."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <MetaTagOptimizerPicker seoProjectOptions={seoProjectOptions} contentByProject={contentByProject} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
