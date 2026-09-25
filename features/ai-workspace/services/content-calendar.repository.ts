import { prisma } from "@/lib/prisma";

/**
 * Reads for saved content calendars.
 *
 * Every query is scoped by an ALREADY-VERIFIED project id, or joins back to
 * the project's company — a calendar has no companyId column of its own, so
 * the project relation is the single place ownership is decided. Soft-deleted
 * calendars and entries are excluded everywhere.
 */

export type CalendarSummary = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  entryCount: number;
  updatedAt: Date;
};

/** Lists a project's saved calendars, newest range first. */
export async function listProjectCalendars(seoProjectId: string): Promise<CalendarSummary[]> {
  const calendars = await prisma.contentCalendar.findMany({
    where: { seoProjectId, deletedAt: null },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      updatedAt: true,
      _count: { select: { entries: { where: { deletedAt: null } } } },
    },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });

  return calendars.map((calendar) => ({
    id: calendar.id,
    name: calendar.name,
    startDate: calendar.startDate,
    endDate: calendar.endDate,
    entryCount: calendar._count.entries,
    updatedAt: calendar.updatedAt,
  }));
}

/**
 * The id columns are `@db.Uuid`, so handing Postgres a value that is not a
 * UUID raises a driver error rather than simply matching nothing. Since these
 * ids arrive from a URL segment and from server-action input, the shape is
 * checked before the query — a garbage id is "not found", not a crash.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Reads one calendar, verifying ownership by joining through the project to
 * the actor's company. Returns null for a calendar of another company, a
 * trashed calendar, one whose project has been trashed, or an id that is not
 * even a UUID — the caller reports all of them identically.
 */
export async function getOwnedCalendar(calendarId: string, companyId: string) {
  if (!isUuid(calendarId)) return null;

  return prisma.contentCalendar.findFirst({
    where: {
      id: calendarId,
      deletedAt: null,
      seoProject: { companyId, deletedAt: null },
    },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      notes: true,
      updatedAt: true,
      seoProjectId: true,
      seoProject: { select: { id: true, name: true, domain: true } },
      entries: {
        where: { deletedAt: null },
        orderBy: [{ scheduledDate: "asc" }, { sortOrder: "asc" }],
        select: {
          id: true,
          scheduledDate: true,
          topic: true,
          contentType: true,
          role: true,
          status: true,
          notes: true,
          keywordId: true,
          contentId: true,
          keyword: { select: { term: true } },
          content: { select: { id: true, title: true, status: true, deletedAt: true } },
        },
      },
    },
  });
}

/**
 * Verifies a set of keyword ids all belong to the given project and are live.
 * Returns the ids that genuinely qualify, so the caller can reject the request
 * when anything is missing rather than silently dropping an association.
 */
export async function filterOwnedKeywordIds(keywordIds: readonly string[], seoProjectId: string): Promise<Set<string>> {
  // Non-UUID ids are dropped here rather than sent to a uuid column; the
  // caller then sees them as unowned and refuses the request.
  const candidates = [...new Set(keywordIds.filter(isUuid))];
  if (candidates.length === 0) return new Set();
  const rows = await prisma.keyword.findMany({
    where: { id: { in: candidates }, seoProjectId, deletedAt: null },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Same, for Content ids — a calendar entry may only ever link to a live page of its own project. */
export async function filterOwnedContentIds(contentIds: readonly string[], seoProjectId: string): Promise<Set<string>> {
  const candidates = [...new Set(contentIds.filter(isUuid))];
  if (candidates.length === 0) return new Set();
  const rows = await prisma.content.findMany({
    where: { id: { in: candidates }, seoProjectId, deletedAt: null },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Verifies a KeywordCluster belongs to the project and is live. */
export async function getOwnedKeywordCluster(clusterId: string, seoProjectId: string) {
  if (!isUuid(clusterId)) return null;

  return prisma.keywordCluster.findFirst({
    where: { id: clusterId, seoProjectId, deletedAt: null },
    select: {
      id: true,
      name: true,
      keywords: { where: { deletedAt: null }, select: { term: true }, orderBy: { term: "asc" } },
    },
  });
}
