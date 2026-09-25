import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

export async function listContentForProject(
  seoProjectId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    seoProjectId,
    deletedAt: showArchived ? { not: null } : null,
    ...(status && !showArchived
      ? {
          status: status.toUpperCase() as
            | "DRAFT"
            | "IN_REVIEW"
            | "APPROVED"
            | "PUBLISHED"
            | "ARCHIVED",
        }
      : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [content, totalCount] = await Promise.all([
    prisma.content.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        author: { select: { firstName: true, lastName: true } },
        _count: { select: { keywords: true } },
      },
    }),
    prisma.content.count({ where }),
  ]);

  return { content, totalCount, page, pageSize };
}

/**
 * A lean, non-paginated inventory of a project's real, linkable pages — for
 * the Internal Link Analyzer, which needs the WHOLE project's page list as
 * prompt context, not one UI page of it. listContentForProject above is
 * pagination-bound (DEFAULT_PAGE_SIZE=10) by design for its list-view use
 * case; reusing it here would silently truncate the inventory a project
 * with more than 10 pages actually has. Deliberately excludes rows with no
 * url (nothing to link to) and caps at MAX_INVENTORY_SIZE so a very large
 * project can't blow out the prompt's context budget.
 */
const MAX_INVENTORY_SIZE = 50;

export function listContentInventoryForProject(seoProjectId: string) {
  return prisma.content.findMany({
    where: { seoProjectId, deletedAt: null, url: { not: null } },
    select: { id: true, title: true, url: true },
    orderBy: { createdAt: "desc" },
    take: MAX_INVENTORY_SIZE,
  });
}

export function getContentById(id: string) {
  return prisma.content.findUnique({
    where: { id },
    include: {
      // Phase C4.1 — deletedAt added so callers can tell whether the owning
      // project is in the trash. Additive only: existing consumers are
      // unaffected by the extra field.
      // Phase 4 — clientId/client added so the Content detail page can state
      // which client the record belongs to. SEOProject.clientId is optional,
      // so `client` may legitimately be null and callers must say
      // "no client assigned" rather than guess. Additive only.
      seoProject: { select: { id: true, name: true, companyId: true, deletedAt: true, clientId: true, client: { select: { id: true, name: true } } } },
      // The record's OWN client. Content is client-owned now, so this is the
      // primary answer to "who is this for"; the project's client above is
      // only a fallback for rows that predate the column.
      client: { select: { id: true, name: true } },
      author: { select: { id: true, firstName: true, lastName: true } },
      keywords: { select: { id: true, term: true } },
      // Phase 7 — the Blog Studio edits the article's tags, which are a real
      // existing company-owned relation on Content.
      tags: { select: { id: true, name: true } },
      // Phase 6 — present only when this record IS a social post. Its
      // presence is what makes the record a social post; there is no
      // contentType column.
      socialPost: {
        select: {
          id: true,
          caption: true,
          link: true,
          // Phase 7 — caption/link are this target's OWN version; null means
          // it posts the shared caption above.
          targets: {
            select: {
              caption: true,
              link: true,
              socialAccount: { select: { id: true, platform: true, handle: true, displayName: true } },
            },
          },
        },
      },
      notes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { actor: { select: { firstName: true, lastName: true } } },
      },
    },
  });
}
