import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";
import Link from "next/link";

import ContentBriefPicker from "@/features/ai-workspace/components/ContentBriefPicker";
import { parseBriefHandoffParams } from "@/features/ai-workspace/services/content-gap-to-brief";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

/**
 * Phase C2.2 — accepts an optional Content Gap Analysis hand-off in the query
 * string. These are FORM PREFILLS ONLY: every value is parsed defensively,
 * rendered into editable fields, and re-validated server-side on generate and
 * save. A hand-crafted URL cannot widen what the actor may generate against —
 * ownership is re-derived from the authenticated user, never from these params.
 */
type NewContentBriefPageProps = {
  searchParams: Promise<{ seoProjectId?: string; notes?: string; contentType?: string }>;
};

export default async function NewContentBriefPage({ searchParams }: NewContentBriefPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);
  const canPreviewPrompt = Permissions.manageCompanies(user.role);
  const handoff = parseBriefHandoffParams(await searchParams);

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
            <ContentBriefPicker
              seoProjectOptions={seoProjectOptions}
              keywordsByProject={keywordsByProject}
              canPreviewPrompt={canPreviewPrompt}
              initialSeoProjectId={seoProjectOptions.some((option) => option.id === handoff.seoProjectId) ? handoff.seoProjectId : ""}
              initialNotes={handoff.notes}
              initialContentType={handoff.contentType}
            />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
