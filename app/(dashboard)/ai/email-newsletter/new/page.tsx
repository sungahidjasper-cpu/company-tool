import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Mail } from "lucide-react";
import Link from "next/link";

import EmailNewsletterPicker, { type ContentOption } from "@/features/ai-workspace/components/EmailNewsletterPicker";
import { parseContentOptimizerParams, resolveContentOptimizerSelection } from "@/features/ai-workspace/services/content-optimizer-handoff";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

/**
 * Accepts an optional contextual hand-off from a Content record
 * (?seoProjectId=&contentId=), the same contract C4.1–C4.5 already use.
 *
 * Preselection hints only: they are resolved below against this route's own
 * company-scoped query (which already excludes soft-deleted Content) and
 * against listSeoProjectOptions (which already excludes trashed projects),
 * and startEmailNewsletterAction re-verifies company ownership, the
 * project/content match and both soft-delete states server-side before
 * anything is generated.
 */
type NewEmailNewsletterPageProps = {
  searchParams: Promise<{ seoProjectId?: string; contentId?: string }>;
};

export default async function NewEmailNewsletterPage({ searchParams }: NewEmailNewsletterPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const [seoProjectOptions, content] = await Promise.all([
    listSeoProjectOptions(user.companyId),
    prisma.content.findMany({
      where: { seoProject: { companyId: user.companyId }, deletedAt: null },
      select: { id: true, title: true, seoProjectId: true, body: true },
      orderBy: { title: "asc" },
    }),
  ]);

  /*
   * `hasBody` rather than the body itself: the picker only needs to know
   * whether there is enough material to draft from, and shipping every
   * article body to the client to answer a boolean would be wasteful. The
   * server re-reads the real body when the job runs.
   */
  const contentByProject: Record<string, ContentOption[]> = {};
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
      hasBody: (item.body ?? "").trim().length > 0,
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
        title="Email Newsletter Drafter"
        description="Drafts an email newsletter from one of your existing content records. This tool only writes a draft — it never sends email, connects to an email provider, or creates a campaign."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to draft a newsletter from its content."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <EmailNewsletterPicker
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
