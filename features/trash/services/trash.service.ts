import { prisma } from "@/lib/prisma";
import { resolveEntityTypeFromFile, getEntityIdFromFile } from "@/features/files/services/entity-target";
import type { FileEntityType } from "@/features/files/schemas/file.schema";

/**
 * Phase 27 Stage 3 — the six Note parent types Phase 26 Stage 3 actually
 * wired up (Contact notes were never built — see Phase 27 Stage 1 audit).
 */
export type NoteParentType = "lead" | "project" | "client" | "seoProject" | "content" | "task";

export type TrashIdentifiers =
  | { entityType: "content"; contentId: string; seoProjectId: string }
  | { entityType: "keyword"; keywordId: string; seoProjectId: string }
  | { entityType: "file"; fileId: string }
  | { entityType: "note"; noteId: string; noteParentType: NoteParentType };

export type TrashItem = {
  id: string;
  entityType: "content" | "keyword" | "file" | "note";
  displayName: string;
  deletedAt: Date;
  parentLabel: string | null;
  parentHref: string | null;
  restoreAvailable: boolean;
  purgeAvailable: boolean;
  identifiers: TrashIdentifiers;
};

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Builds a { label, href } lookup for a batch of same-typed parent ids, one query per type present — never one query per row. */
async function buildParentLookup(
  entityType: FileEntityType,
  ids: string[]
): Promise<Map<string, { label: string; href: string }>> {
  const map = new Map<string, { label: string; href: string }>();
  if (ids.length === 0) return map;

  switch (entityType) {
    case "client": {
      const rows = await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      rows.forEach((r) => map.set(r.id, { label: r.name, href: `/clients/${r.id}` }));
      break;
    }
    case "project": {
      const rows = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      rows.forEach((r) => map.set(r.id, { label: r.name, href: `/projects/${r.id}` }));
      break;
    }
    case "lead": {
      const rows = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      rows.forEach((r) => map.set(r.id, { label: r.name, href: `/leads/${r.id}` }));
      break;
    }
    case "seoProject": {
      const rows = await prisma.sEOProject.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      rows.forEach((r) => map.set(r.id, { label: r.name, href: `/seo/${r.id}` }));
      break;
    }
    case "task": {
      const rows = await prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, projectId: true } });
      rows.forEach((r) => map.set(r.id, { label: r.title, href: `/projects/${r.projectId}/tasks/${r.id}` }));
      break;
    }
    case "content": {
      const rows = await prisma.content.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, seoProjectId: true } });
      rows.forEach((r) => map.set(r.id, { label: r.title, href: `/seo/${r.seoProjectId}/content/${r.id}` }));
      break;
    }
    case "company": {
      const rows = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      rows.forEach((r) => map.set(r.id, { label: r.name, href: `/companies/${r.id}` }));
      break;
    }
    case "user": {
      const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
      rows.forEach((r) => map.set(r.id, { label: `${r.firstName} ${r.lastName}`, href: `/users/${r.id}` }));
      break;
    }
  }
  return map;
}

/**
 * File.companyId is only ever populated when a file's own target entityType
 * is literally "company" (see buildEntityWhere in entity-target.ts) — every
 * other target type (client/project/task/lead/seoProject/content/user)
 * leaves it null, so a flat companyId filter would silently miss almost
 * every real file. This OR-join re-derives tenancy through whichever parent
 * relation is actually populated, mirroring getTrashedNotes below.
 */
async function getTrashedFiles(companyId: string): Promise<TrashItem[]> {
  const files = await prisma.file.findMany({
    where: {
      deletedAt: { not: null },
      OR: [
        { companyId },
        { client: { companyId } },
        { project: { companyId } },
        { task: { project: { companyId } } },
        { lead: { companyId } },
        { seoProject: { companyId } },
        { content: { seoProject: { companyId } } },
        { user: { companyId } },
      ],
    },
    orderBy: { deletedAt: "desc" },
  });

  const byType = new Map<FileEntityType, string[]>();
  const resolved = files.map((file) => {
    const entityType = resolveEntityTypeFromFile(file);
    const entityId = entityType ? getEntityIdFromFile(file, entityType) : null;
    if (entityType && entityId) {
      byType.set(entityType, [...(byType.get(entityType) ?? []), entityId]);
    }
    return { file, entityType, entityId };
  });

  const lookups = new Map<FileEntityType, Map<string, { label: string; href: string }>>();
  for (const [entityType, ids] of byType) {
    lookups.set(entityType, await buildParentLookup(entityType, [...new Set(ids)]));
  }

  return resolved.map(({ file, entityType, entityId }) => {
    const parent = entityType && entityId ? lookups.get(entityType)?.get(entityId) : undefined;
    return {
      id: file.id,
      entityType: "file" as const,
      displayName: file.fileName,
      deletedAt: file.deletedAt as Date,
      parentLabel: parent?.label ?? null,
      parentHref: parent?.href ?? null,
      restoreAvailable: true,
      purgeAvailable: false,
      identifiers: { entityType: "file", fileId: file.id },
    };
  });
}

async function getTrashedNotes(companyId: string): Promise<TrashItem[]> {
  const notes = await prisma.note.findMany({
    where: {
      deletedAt: { not: null },
      OR: [
        { lead: { companyId } },
        { project: { companyId } },
        { client: { companyId } },
        { seoProject: { companyId } },
        { content: { seoProject: { companyId } } },
        { task: { project: { companyId } } },
      ],
    },
    orderBy: { deletedAt: "desc" },
  });

  function parentTypeOf(note: (typeof notes)[number]): NoteParentType | null {
    if (note.leadId) return "lead";
    if (note.projectId) return "project";
    if (note.clientId) return "client";
    if (note.seoProjectId) return "seoProject";
    if (note.contentId) return "content";
    if (note.taskId) return "task";
    return null;
  }

  const byType = new Map<FileEntityType, string[]>();
  const resolved = notes.map((note) => {
    const parentType = parentTypeOf(note);
    const parentId = parentType
      ? ((note[`${parentType}Id` as keyof typeof note] as string | null) ?? null)
      : null;
    if (parentType && parentId) {
      byType.set(parentType, [...(byType.get(parentType) ?? []), parentId]);
    }
    return { note, parentType, parentId };
  });

  const lookups = new Map<FileEntityType, Map<string, { label: string; href: string }>>();
  for (const [entityType, ids] of byType) {
    lookups.set(entityType, await buildParentLookup(entityType, [...new Set(ids)]));
  }

  return resolved
    .filter((r) => r.parentType !== null)
    .map(({ note, parentType, parentId }) => {
      const parent = parentType && parentId ? lookups.get(parentType)?.get(parentId) : undefined;
      return {
        id: note.id,
        entityType: "note" as const,
        displayName: truncate(note.body, 80),
        deletedAt: note.deletedAt as Date,
        parentLabel: parent?.label ?? null,
        parentHref: parent?.href ?? null,
        restoreAvailable: true,
        purgeAvailable: false,
        identifiers: { entityType: "note", noteId: note.id, noteParentType: parentType as NoteParentType },
      };
    });
}

async function getTrashedContent(companyId: string): Promise<TrashItem[]> {
  const content = await prisma.content.findMany({
    where: { seoProject: { companyId }, deletedAt: { not: null } },
    select: { id: true, title: true, deletedAt: true, seoProjectId: true, seoProject: { select: { name: true } } },
    orderBy: { deletedAt: "desc" },
  });
  if (content.length === 0) return [];

  const blocked = await prisma.contentRevision.findMany({
    where: { contentId: { in: content.map((c) => c.id) } },
    select: { contentId: true },
    distinct: ["contentId"],
  });
  const blockedIds = new Set(blocked.map((r) => r.contentId));

  return content.map((c) => ({
    id: c.id,
    entityType: "content" as const,
    displayName: c.title,
    deletedAt: c.deletedAt as Date,
    parentLabel: c.seoProject.name,
    parentHref: `/seo/${c.seoProjectId}`,
    restoreAvailable: true,
    purgeAvailable: !blockedIds.has(c.id),
    identifiers: { entityType: "content", contentId: c.id, seoProjectId: c.seoProjectId },
  }));
}

async function getTrashedKeywords(companyId: string): Promise<TrashItem[]> {
  const keywords = await prisma.keyword.findMany({
    where: { seoProject: { companyId }, deletedAt: { not: null } },
    select: { id: true, term: true, deletedAt: true, seoProjectId: true, seoProject: { select: { name: true } } },
    orderBy: { deletedAt: "desc" },
  });

  return keywords.map((k) => ({
    id: k.id,
    entityType: "keyword" as const,
    displayName: k.term,
    deletedAt: k.deletedAt as Date,
    parentLabel: k.seoProject.name,
    parentHref: `/seo/${k.seoProjectId}`,
    restoreAvailable: true,
    purgeAvailable: true,
    identifiers: { entityType: "keyword", keywordId: k.id, seoProjectId: k.seoProjectId },
  }));
}

/** Tenant-scoped, aggregated across Content/Keyword/File/Note — the sole read path backing /trash. */
export async function getTrashItems(companyId: string): Promise<TrashItem[]> {
  const [content, keywords, files, notes] = await Promise.all([
    getTrashedContent(companyId),
    getTrashedKeywords(companyId),
    getTrashedFiles(companyId),
    getTrashedNotes(companyId),
  ]);

  return [...content, ...keywords, ...files, ...notes].sort(
    (a, b) => b.deletedAt.getTime() - a.deletedAt.getTime()
  );
}
