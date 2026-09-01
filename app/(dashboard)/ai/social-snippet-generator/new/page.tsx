import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquareText } from "lucide-react";
import Link from "next/link";

import SocialSnippetGeneratorPicker from "@/features/ai-workspace/components/SocialSnippetGeneratorPicker";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export default async function NewSocialSnippetGeneratorPage() {
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
    (contentByProject[item.seoProjectId] ??= []).push({ id: item.id, title: item.title });
  }

  return (
    <PageContainer>
      <DashboardHeader
        title="Social Snippet Generator"
        description="Turns an existing piece of content into short, platform-ready promotional snippets. Nothing is posted or saved automatically — copy what you want to use."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to generate social snippets for its content."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <SocialSnippetGeneratorPicker seoProjectOptions={seoProjectOptions} contentByProject={contentByProject} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
