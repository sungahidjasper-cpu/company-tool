import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Link2 } from "lucide-react";
import Link from "next/link";

import InternalLinkAnalyzerPicker from "@/features/ai-workspace/components/InternalLinkAnalyzerPicker";
import { parseContentOptimizerParams, resolveContentOptimizerSelection } from "@/features/ai-workspace/services/content-optimizer-handoff";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

/**
 * Phase 4 — accepts an optional contextual hand-off from a Content record
 * (?seoProjectId=&contentId=), the same contract the Meta Tag Optimizer,
 * Content Rewriter, Schema Markup, Social Snippet and Email Newsletter routes
 * already accept.
 *
 * These are PRESELECTION HINTS ONLY. They are resolved below against this
 * route's own company-scoped, non-soft-deleted query, and
 * startInternalLinkAnalysisAction re-verifies company, project, content
 * ownership and soft-delete state independently before generating anything.
 */
type NewInternalLinkAnalysisPageProps = {
  searchParams: Promise<{ seoProjectId?: string; contentId?: string }>;
};

export default async function NewInternalLinkAnalysisPage({ searchParams }: NewInternalLinkAnalysisPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const [seoProjectOptions, content] = await Promise.all([
    listSeoProjectOptions(user.companyId),
    prisma.content.findMany({
      where: { seoProject: { companyId: user.companyId }, deletedAt: null },
      select: { id: true, title: true, seoProjectId: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const contentByProject: Record<string, { id: string; title: string }[]> = {};
  for (const item of content) {
    /*
     * These tools are SEO-project scoped: they are picked BY project, so a
     * client-owned row with no project has no group to appear under and is
     * not eligible for them. Skipped rather than forced into a bucket.
     */
    if (item.seoProjectId === null) continue;
    (contentByProject[item.seoProjectId] ??= []).push({ id: item.id, title: item.title });
  }

  const preselection = resolveContentOptimizerSelection(
    parseContentOptimizerParams(await searchParams),
    seoProjectOptions.map((option) => option.id),
    contentByProject
  );

  return (
    <PageContainer>
      <DashboardHeader
        title="Internal Link Analyzer"
        description="Recommends internal links from a selected page to other real, existing pages in the same project. Nothing is saved or inserted automatically — review each recommendation before adding it yourself."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to analyze internal-linking opportunities for its pages."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <InternalLinkAnalyzerPicker
              seoProjectOptions={seoProjectOptions}
              contentByProject={contentByProject}
              initialSeoProjectId={preselection.seoProjectId}
              initialContentId={preselection.contentIds[0] ?? ""}
            />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
