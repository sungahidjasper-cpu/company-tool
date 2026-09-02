import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { FileEdit } from "lucide-react";
import Link from "next/link";

import ContentRewriterPicker from "@/features/ai-workspace/components/ContentRewriterPicker";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

function countWords(body: string): number {
  const trimmed = body.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export default async function NewContentRewriterPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const [seoProjectOptions, content] = await Promise.all([
    listSeoProjectOptions(user.companyId),
    prisma.content.findMany({
      where: { seoProject: { companyId: user.companyId }, deletedAt: null, body: { not: null } },
      select: { id: true, title: true, url: true, body: true, seoProjectId: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const contentByProject: Record<string, { id: string; title: string; url: string | null; wordCount: number }[]> = {};
  for (const item of content) {
    // Only pages with a REAL, non-empty body are eligible — matches the
    // exact rule startContentRewriteAction/dispatchContentRewriter both
    // enforce server-side. A whitespace-only body ("   ") passes Prisma's
    // `not: null` filter but has nothing to rewrite, so it's excluded here
    // too — this is a display convenience only, never the actual security
    // or eligibility boundary (the action re-checks this itself).
    if (!item.body || !item.body.trim()) continue;
    (contentByProject[item.seoProjectId] ??= []).push({
      id: item.id,
      title: item.title,
      url: item.url,
      wordCount: countWords(item.body),
    });
  }

  return (
    <PageContainer>
      <DashboardHeader
        title="Content Rewriter"
        description="Rewrites and refreshes one existing page's title, meta title, meta description, and body — grounded in that page's own current content. Nothing is saved automatically — review the rewrite before applying it yourself."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={FileEdit}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to rewrite its pages."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <ContentRewriterPicker seoProjectOptions={seoProjectOptions} contentByProject={contentByProject} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
