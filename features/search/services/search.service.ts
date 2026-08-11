import { prisma } from "@/lib/prisma";
import { Permissions, isSuperAdmin } from "@/lib/authorization";
import type { UserRole } from "@/lib/generated/prisma/enums";

type SearchActor = {
  id: string;
  role: UserRole;
  companyId: string;
};

const RESULT_LIMIT = 8;

function searchCompanies(q: string, actor: SearchActor) {
  if (!Permissions.manageCompanies(actor.role)) {
    return Promise.resolve([]);
  }

  return prisma.company.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, slug: true },
    take: RESULT_LIMIT,
  });
}

function searchUsers(q: string, actor: SearchActor) {
  if (!Permissions.manageUsers(actor.role)) {
    return Promise.resolve([]);
  }

  return prisma.user.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true },
    take: RESULT_LIMIT,
  });
}

function searchClients(q: string, actor: SearchActor) {
  return prisma.client.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
    take: RESULT_LIMIT,
  });
}

function searchProjects(q: string, actor: SearchActor) {
  return prisma.project.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      name: { contains: q, mode: "insensitive" },
    },
    select: { id: true, name: true },
    take: RESULT_LIMIT,
  });
}

function searchTasks(q: string, actor: SearchActor) {
  return prisma.task.findMany({
    where: {
      project: { companyId: actor.companyId },
      deletedAt: null,
      title: { contains: q, mode: "insensitive" },
    },
    select: { id: true, title: true, projectId: true },
    take: RESULT_LIMIT,
  });
}

function searchLeads(q: string, actor: SearchActor) {
  return prisma.lead.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { companyName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, companyName: true },
    take: RESULT_LIMIT,
  });
}

function searchReports(q: string, actor: SearchActor) {
  return prisma.report.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      title: { contains: q, mode: "insensitive" },
    },
    select: { id: true, title: true },
    take: RESULT_LIMIT,
  });
}

function searchSeoProjects(q: string, actor: SearchActor) {
  return prisma.sEOProject.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { domain: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, domain: true },
    take: RESULT_LIMIT,
  });
}

function searchKeywords(q: string, actor: SearchActor) {
  return prisma.keyword.findMany({
    where: {
      seoProject: { companyId: actor.companyId },
      deletedAt: null,
      term: { contains: q, mode: "insensitive" },
    },
    select: { id: true, term: true, seoProjectId: true },
    take: RESULT_LIMIT,
  });
}

function searchContent(q: string, actor: SearchActor) {
  return prisma.content.findMany({
    where: {
      seoProject: { companyId: actor.companyId },
      deletedAt: null,
      title: { contains: q, mode: "insensitive" },
    },
    select: { id: true, title: true, seoProjectId: true },
    take: RESULT_LIMIT,
  });
}

function searchFiles(q: string, actor: SearchActor) {
  return prisma.file.findMany({
    where: {
      deletedAt: null,
      fileName: { contains: q, mode: "insensitive" },
      OR: [
        { companyId: actor.companyId },
        { client: { companyId: actor.companyId } },
        { project: { companyId: actor.companyId } },
        { task: { project: { companyId: actor.companyId } } },
        { user: { companyId: actor.companyId } },
      ],
    },
    select: { id: true, fileName: true },
    take: RESULT_LIMIT,
  });
}

/**
 * One query per entity, each reusing that entity's own RBAC rule (the
 * exact same Permissions checks its own pages use — Companies only for a
 * Super Admin, Users only for Admin+, everything else open to any company
 * member) rather than a separate, easy-to-drift access model for search.
 */
export async function globalSearch(query: string, actor: SearchActor) {
  const q = query.trim();
  if (q.length < 2) {
    return {
      query: q,
      companies: [],
      users: [],
      clients: [],
      leads: [],
      projects: [],
      tasks: [],
      files: [],
      reports: [],
      seoProjects: [],
      keywords: [],
      content: [],
      canSeeCompanies: isSuperAdmin(actor.role),
      canSeeUsers: Permissions.manageUsers(actor.role),
    };
  }

  const [
    companies,
    users,
    clients,
    leads,
    projects,
    tasks,
    files,
    reports,
    seoProjects,
    keywords,
    content,
  ] = await Promise.all([
    searchCompanies(q, actor),
    searchUsers(q, actor),
    searchClients(q, actor),
    searchLeads(q, actor),
    searchProjects(q, actor),
    searchTasks(q, actor),
    searchFiles(q, actor),
    searchReports(q, actor),
    searchSeoProjects(q, actor),
    searchKeywords(q, actor),
    searchContent(q, actor),
  ]);

  return {
    query: q,
    companies,
    users,
    clients,
    leads,
    projects,
    tasks,
    files,
    reports,
    seoProjects,
    keywords,
    content,
    canSeeCompanies: isSuperAdmin(actor.role),
    canSeeUsers: Permissions.manageUsers(actor.role),
  };
}
