import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import Link from "next/link";

import ContentCalendarPicker, { type ProjectPlanningData } from "@/features/ai-workspace/components/ContentCalendarPicker";
import { listProjectCalendars } from "@/features/ai-workspace/services/content-calendar.repository";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";

/**
 * The Content Calendar Assistant's home: what the project already has to plan
 * from, the generator, and any calendars already saved.
 *
 * Every query is scoped by an owned project id (listSeoProjectOptions already
 * excludes trashed projects), and the server re-verifies ownership on both
 * generate and save regardless of anything shown here.
 */
export default async function ContentCalendarPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProjectOptions = await listSeoProjectOptions(user.companyId);

  const planningDataByProject: Record<string, ProjectPlanningData> = {};
  const savedByProject: Record<string, Awaited<ReturnType<typeof listProjectCalendars>>> = {};

  await Promise.all(
    seoProjectOptions.map(async (option) => {
      const [keywordCount, contentCount, clusters, calendars] = await Promise.all([
        prisma.keyword.count({ where: { seoProjectId: option.id, deletedAt: null } }),
        prisma.content.count({ where: { seoProjectId: option.id, deletedAt: null } }),
        prisma.keywordCluster.findMany({
          where: { seoProjectId: option.id, deletedAt: null },
          select: { id: true, name: true, _count: { select: { keywords: { where: { deletedAt: null } } } } },
          orderBy: { name: "asc" },
        }),
        listProjectCalendars(option.id),
      ]);

      planningDataByProject[option.id] = {
        keywordCount,
        contentCount,
        clusters: clusters.map((cluster) => ({ id: cluster.id, name: cluster.name, keywordCount: cluster._count.keywords })),
      };
      savedByProject[option.id] = calendars;
    })
  );

  const savedCalendars = seoProjectOptions.flatMap((option) =>
    (savedByProject[option.id] ?? []).map((calendar) => ({ ...calendar, projectName: option.name }))
  );

  return (
    <PageContainer>
      <DashboardHeader
        title="Content Calendar Assistant"
        description="Plans a publishing schedule for a date range using this project's own keywords, clusters and pages. You review and edit every entry before it is saved."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to plan its content."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <ContentCalendarPicker seoProjectOptions={seoProjectOptions} planningDataByProject={planningDataByProject} />
          )}
        </CardContent>
      </Card>

      {savedCalendars.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Saved calendars</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {savedCalendars.map((calendar) => (
                <li key={calendar.id}>
                  <Link
                    href={`/ai/content-calendar/${calendar.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 hover:border-slate-300"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-words text-slate-800">{calendar.name}</p>
                      <p className="text-xs text-slate-500">
                        {calendar.projectName} · {calendar.startDate.toISOString().slice(0, 10)} to {calendar.endDate.toISOString().slice(0, 10)}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {calendar.entryCount} entr{calendar.entryCount === 1 ? "y" : "ies"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
