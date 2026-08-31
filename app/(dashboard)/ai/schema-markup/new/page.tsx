import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import SchemaMarkupGeneratorPicker from "@/features/ai-workspace/components/SchemaMarkupGeneratorPicker";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

export default async function NewSchemaMarkupPage() {
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
            <SchemaMarkupGeneratorPicker seoProjectOptions={seoProjectOptions} contentByProject={contentByProject} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
