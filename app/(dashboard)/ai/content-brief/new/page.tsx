import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";
import Link from "next/link";

import ContentBriefPicker from "@/features/ai-workspace/components/ContentBriefPicker";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function NewContentBriefPage() {
  const user = await requireUser();

  const [seoProjectOptions, keywords] = await Promise.all([
    listSeoProjectOptions(user.companyId),
    prisma.keyword.findMany({
      where: { seoProject: { companyId: user.companyId }, deletedAt: null },
      select: { id: true, term: true, seoProjectId: true },
      orderBy: { term: "asc" },
    }),
  ]);

  const keywordsByProject: Record<string, { id: string; term: string }[]> = {};
  for (const keyword of keywords) {
    (keywordsByProject[keyword.seoProjectId] ??= []).push({ id: keyword.id, term: keyword.term });
  }

  return (
    <PageContainer>
      <DashboardHeader
        title="SEO Content Brief"
        description="Generates a title, meta tags, outline, and SEO/GEO/AEO suggestions. Nothing is saved until you review it and click Save as Draft."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to generate a content brief for one of its keywords."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <ContentBriefPicker seoProjectOptions={seoProjectOptions} keywordsByProject={keywordsByProject} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
