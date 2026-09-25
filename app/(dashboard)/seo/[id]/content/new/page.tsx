import { notFound } from "next/navigation";

import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ContentForm from "@/features/seo/components/ContentForm";
import { formatScheduledFor, isValidTimeZone, zonedWallTimeToInstant } from "@/features/content-workspace/services/content-scheduling";
import { listKeywordOptions } from "@/features/seo/services/keyword.service";
import { getSeoProjectById } from "@/features/seo/services/seo-project.service";
import { listUserOptions } from "@/features/users/services/user.service";
import { requireUser } from "@/lib/auth";
import {
  assertCompanyAccess,
  assertPermission,
  Permissions,
} from "@/lib/authorization";

/**
 * Phase 5 — this route is the Blog Post creation entry point the calendar
 * hands off to. The schedule the user chose travels in the query string as
 * the wall time and zone they picked (never a pre-computed instant), and is
 * re-validated here and again in createContent before anything is written.
 * A malformed or missing schedule simply produces an ordinary new-content
 * form rather than an error.
 */
type NewContentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scheduleDate?: string; scheduleTime?: string; scheduleTz?: string }>;
};

export default async function NewContentPage({ params, searchParams }: NewContentPageProps) {
  const { id: seoProjectId } = await params;
  const query = await searchParams;
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProject = await getSeoProjectById(seoProjectId);
  if (!seoProject) {
    notFound();
  }
  assertCompanyAccess(user, seoProject.companyId);

  const [userOptions, keywordOptions] = await Promise.all([
    listUserOptions(user.companyId),
    listKeywordOptions(seoProjectId),
  ]);

  const scheduleInstant =
    query.scheduleDate && query.scheduleTime && query.scheduleTz && isValidTimeZone(query.scheduleTz)
      ? zonedWallTimeToInstant(query.scheduleDate, query.scheduleTime, query.scheduleTz)
      : null;
  const schedule = scheduleInstant
    ? {
        dateIso: query.scheduleDate!,
        time: query.scheduleTime!,
        timeZone: query.scheduleTz!,
        readable: formatScheduledFor(scheduleInstant, query.scheduleTz!),
      }
    : undefined;

  return (
    <PageContainer>
      <DashboardHeader
        title={schedule ? "New blog post" : "New content"}
        description={schedule ? `For ${seoProject.name}, scheduled from the content calendar.` : `For ${seoProject.name}.`}
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Content details</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentForm
            seoProjectId={seoProjectId}
            userOptions={userOptions}
            keywordOptions={keywordOptions}
            schedule={schedule}
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
