import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { notFound } from "next/navigation";

import SavedCalendarView, { type SavedCalendarEntry } from "@/features/ai-workspace/components/SavedCalendarView";
import { getOwnedCalendar } from "@/features/ai-workspace/services/content-calendar.repository";
import { formatIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

/**
 * One saved calendar.
 *
 * `getOwnedCalendar` joins through the project to the actor's company, so a
 * calendar of another company, a trashed calendar, and one whose project has
 * been trashed all resolve to null and produce the same notFound() — the page
 * never discloses which case applied.
 */
type SavedCalendarPageProps = {
  params: Promise<{ calendarId: string }>;
};

export default async function SavedCalendarPage({ params }: SavedCalendarPageProps) {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const { calendarId } = await params;
  const calendar = await getOwnedCalendar(calendarId, user.companyId);
  if (!calendar) notFound();

  const entries: SavedCalendarEntry[] = calendar.entries.map((entry) => ({
    id: entry.id,
    scheduledDate: formatIsoDate(entry.scheduledDate),
    topic: entry.topic,
    contentType: entry.contentType,
    role: entry.role,
    status: entry.status,
    notes: entry.notes,
    keywordTerm: entry.keyword?.term ?? null,
    // A page that has since been trashed is not offered as a link.
    contentId: entry.content && !entry.content.deletedAt ? entry.content.id : null,
    contentTitle: entry.content && !entry.content.deletedAt ? entry.content.title : null,
  }));

  return (
    <PageContainer>
      <DashboardHeader
        title={calendar.name}
        description={`${calendar.seoProject.name} · ${formatIsoDate(calendar.startDate)} to ${formatIsoDate(calendar.endDate)} · ${entries.length} entr${
          entries.length === 1 ? "y" : "ies"
        }`}
      />

      <Card>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Link href="/ai/content-calendar" className="text-sm font-medium text-primary hover:underline">
              ← All content calendars
            </Link>
            {calendar.notes && <p className="text-xs text-slate-500">{calendar.notes}</p>}
          </div>

          {entries.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">This calendar has no entries.</p>
          ) : (
            <SavedCalendarView calendarId={calendar.id} seoProjectId={calendar.seoProjectId} entries={entries} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
