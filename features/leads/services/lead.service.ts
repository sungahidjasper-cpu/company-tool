import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";
import { LEAD_STATUSES } from "@/features/leads/schemas/lead.schema";

export async function listLeads(
  companyId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    companyId,
    deletedAt: showArchived ? { not: null } : null,
    ...(status && !showArchived
      ? { status: status.toUpperCase() as (typeof LEAD_STATUSES)[number] }
      : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { companyName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [leads, totalCount] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        assignedUser: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return { leads, totalCount, page, pageSize };
}

export function getLeadById(id: string) {
  return prisma.lead.findUnique({
    where: { id },
    include: {
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      client: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      tasks: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { assignee: { select: { firstName: true, lastName: true } } },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { actor: { select: { firstName: true, lastName: true } } },
      },
    },
  });
}

/** Lightweight option list for pickers elsewhere (e.g. a future "convert to project" flow). */
export function listLeadOptions(companyId: string) {
  return prisma.lead.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** One column per pipeline stage, in display order — feeds the Kanban board. */
export async function getLeadsByStage(companyId: string) {
  const leads = await prisma.lead.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const byStatus = new Map(LEAD_STATUSES.map((status) => [status, [] as typeof leads]));
  for (const lead of leads) {
    byStatus.get(lead.status)?.push(lead);
  }

  return LEAD_STATUSES.map((status) => ({
    status,
    leads: byStatus.get(status) ?? [],
  }));
}

/** Feeds the dashboard's CRM stat cards. */
export async function getLeadFunnelStats(companyId: string) {
  const [statusCounts, wonValue] = await Promise.all([
    prisma.lead.groupBy({
      by: ["status"],
      where: { companyId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.lead.aggregate({
      where: { companyId, deletedAt: null, status: "WON" },
      _sum: { value: true },
    }),
  ]);

  const countFor = (status: (typeof LEAD_STATUSES)[number]) =>
    statusCounts.find((row) => row.status === status)?._count._all ?? 0;

  const newLeads = countFor("NEW");
  const qualifiedLeads = countFor("QUALIFIED");
  const wonDeals = countFor("WON");
  const lostDeals = countFor("LOST");
  const closedDeals = wonDeals + lostDeals;
  const totalLeads = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
  const openPipelineValue = await prisma.lead.aggregate({
    where: {
      companyId,
      deletedAt: null,
      status: { notIn: ["WON", "LOST"] },
    },
    _sum: { value: true },
  });

  return {
    newLeads,
    qualifiedLeads,
    wonDeals,
    lostDeals,
    conversionRate: closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 100) : 0,
    pipelineValue: Number(openPipelineValue._sum.value ?? 0),
    wonValue: Number(wonValue._sum.value ?? 0),
    totalLeads,
  };
}
