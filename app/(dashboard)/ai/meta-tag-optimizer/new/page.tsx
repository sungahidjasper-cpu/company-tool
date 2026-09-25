import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Tags } from "lucide-react";
import Link from "next/link";

import MetaTagOptimizerPicker from "@/features/ai-workspace/components/MetaTagOptimizerPicker";
import { parseContentOptimizerParams, resolveContentOptimizerSelection } from "@/features/ai-workspace/services/content-optimizer-handoff";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

/**
 * Phase C4.1 — accepts an optional contextual hand-off from a Content record
 * (?seoProjectId=&contentId=). These are PRESELECTION HINTS ONLY: they are
 * resolved below against this route's own company-scoped, non-soft-deleted
 * query, and the generate/apply actions re-verify company, project and
 * soft-delete state independently before anything is generated or written.
 */
type NewMetaTagOptimizerPageProps = {
  searchParams: Promise<{ seoProjectId?: string; contentId?: string }>;
};

export default async function NewMetaTagOptimizerPage({ searchParams }: NewMetaTagOptimizerPageProps) {
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
    /*
     * These tools are SEO-project scoped: they are picked BY project, so a
     * client-owned row with no project has no group to appear under and is
     * not eligible for them. Skipped rather than forced into a bucket.
     */
    if (item.seoProjectId === null) continue;
    (contentByProject[item.seoProjectId] ??= []).push({
      id: item.id,
      title: item.title,
      url: item.url,
      currentMetaTitle: item.metaTitle,
      currentMetaDescription: item.metaDescription,
    });
  }

  const preselection = resolveContentOptimizerSelection(
    parseContentOptimizerParams(await searchParams),
    seoProjectOptions.map((option) => option.id),
    contentByProject
  );

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
            <MetaTagOptimizerPicker
              seoProjectOptions={seoProjectOptions}
              contentByProject={contentByProject}
              initialSeoProjectId={preselection.seoProjectId}
              initialSelectedContentIds={preselection.contentIds}
            />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
