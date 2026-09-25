import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import SchemaMarkupGeneratorPicker from "@/features/ai-workspace/components/SchemaMarkupGeneratorPicker";
import { parseContentOptimizerParams, resolveContentOptimizerSelection } from "@/features/ai-workspace/services/content-optimizer-handoff";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

/**
 * Phase C4.3 — accepts an optional contextual hand-off from a Content record
 * (?seoProjectId=&contentId=), the same contract C4.1/C4.2 use. Preselection
 * hints only: they are resolved below against this route’s own
 * company-scoped query (which already excludes soft-deleted Content) and
 * against listSeoProjectOptions (which already excludes trashed projects), and
 * startSchemaMarkupGenerationAction re-verifies company ownership plus the
 * project/content match server-side before anything is generated.
 */
type NewSchemaMarkupPageProps = {
  searchParams: Promise<{ seoProjectId?: string; contentId?: string }>;
};

export default async function NewSchemaMarkupPage({ searchParams }: NewSchemaMarkupPageProps) {
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
        title="Schema Markup Generator"
        description="Recommends schema.org structured-data (JSON-LD) for a page or business. Nothing is saved — copy the markup you want into your own CMS/site."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to generate schema markup recommendations for it."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <SchemaMarkupGeneratorPicker
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
