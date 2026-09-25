import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Network } from "lucide-react";
import Link from "next/link";

import TopicClusterPlannerPicker from "@/features/ai-workspace/components/TopicClusterPlannerPicker";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export default async function NewTopicClusterPlannerPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  // Company-scoped and soft-delete-aware, exactly like every other tool's
  // route query. The picker only ever offers what this query returned, and
  // the start action re-verifies every keyword id against the chosen project
  // regardless of what the client sends back.
  const [seoProjectOptions, keywords] = await Promise.all([
    listSeoProjectOptions(user.companyId),
    prisma.keyword.findMany({
      where: { seoProject: { companyId: user.companyId, deletedAt: null }, deletedAt: null },
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
        title="Topic Cluster Planner"
        description="Plans a pillar topic and the supporting topics that should link to it, starting from a topic you provide. Nothing is saved — copy the plan you want to use."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to plan a topic cluster for it."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <TopicClusterPlannerPicker seoProjectOptions={seoProjectOptions} keywordsByProject={keywordsByProject} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
