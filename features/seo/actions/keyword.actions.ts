"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import {
  actionError,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { parseCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import {
  keywordImportRowSchema,
  keywordSchema,
  type KeywordFormInput,
} from "@/features/seo/schemas/keyword.schema";

function getKeywordWithProject(id: string) {
  return prisma.keyword.findUnique({
    where: { id },
    include: { seoProject: { select: { id: true, companyId: true } } },
  });
}

function toNullableNumber(value: string | undefined) {
  return value === undefined ? null : Number(value);
}

export async function createKeyword(
  seoProjectId: string,
  input: KeywordFormInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to create keywords.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const parsed = keywordSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const existing = await prisma.keyword.findUnique({
    where: { seoProjectId_term: { seoProjectId, term: parsed.data.term } },
  });
  if (existing) {
    return actionError("This term is already tracked in this project.");
  }

  const keyword = await prisma.keyword.create({
    data: {
      seoProjectId,
      clusterId: parsed.data.clusterId || null,
      ownerId: parsed.data.ownerId || null,
      term: parsed.data.term,
      searchVolume: toNullableNumber(parsed.data.searchVolume),
      difficulty: toNullableNumber(parsed.data.difficulty),
      currentRank: toNullableNumber(parsed.data.currentRank),
      targetUrl: parsed.data.targetUrl || null,
      intent: parsed.data.intent || null,
      priority: parsed.data.priority,
      status: parsed.data.status,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "keyword.created",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { keywordId: keyword.id, term: keyword.term },
  });

  revalidatePath(`/seo/${seoProjectId}/keywords`);
  revalidatePath(`/seo/${seoProjectId}`);
  return actionSuccess({ id: keyword.id });
}

export async function updateKeyword(
  id: string,
  input: KeywordFormInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit keywords.");
  }

  const existing = await getKeywordWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Keyword not found.");
  }

  const parsed = keywordSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const keyword = await prisma.keyword.update({
    where: { id },
    data: {
      clusterId: parsed.data.clusterId || null,
      ownerId: parsed.data.ownerId || null,
      term: parsed.data.term,
      searchVolume: toNullableNumber(parsed.data.searchVolume),
      difficulty: toNullableNumber(parsed.data.difficulty),
      currentRank: toNullableNumber(parsed.data.currentRank),
      targetUrl: parsed.data.targetUrl || null,
      intent: parsed.data.intent || null,
      priority: parsed.data.priority,
      status: parsed.data.status,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "keyword.updated",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    metadata: { keywordId: keyword.id, term: keyword.term },
  });

  revalidatePath(`/seo/${existing.seoProject.id}/keywords`);
  revalidatePath(`/seo/${existing.seoProject.id}/keywords/${id}`);
  return actionSuccess({ id: keyword.id });
}

export async function archiveKeyword(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to archive keywords.");
  }

  const existing = await getKeywordWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Keyword not found.");
  }

  await prisma.keyword.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "keyword.archived",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    metadata: { keywordId: id },
  });

  revalidatePath(`/seo/${existing.seoProject.id}/keywords`);
  return actionSuccess();
}

export async function restoreKeyword(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore keywords.");
  }

  const existing = await getKeywordWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Keyword not found.");
  }

  await prisma.keyword.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "keyword.restored",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    metadata: { keywordId: id },
  });

  revalidatePath(`/seo/${existing.seoProject.id}/keywords`);
  return actionSuccess();
}

/** Scopes every bulk action to keywords that actually belong to this SEO project + the actor's company, in one query. */
async function getOwnedKeywordIds(seoProjectId: string, companyId: string, ids: string[]) {
  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== companyId) return [];

  const rows = await prisma.keyword.findMany({
    where: { id: { in: ids }, seoProjectId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function bulkArchiveKeywords(
  seoProjectId: string,
  ids: string[]
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to archive keywords.");
  }

  const ownedIds = await getOwnedKeywordIds(seoProjectId, actor.companyId, ids);
  if (ownedIds.length === 0) return actionError("No matching keywords found.");

  const result = await prisma.keyword.updateMany({
    where: { id: { in: ownedIds } },
    data: { deletedAt: new Date() },
  });

  await logActivity({
    actorId: actor.id,
    action: "keyword.bulk_archived",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { count: result.count },
  });

  revalidatePath(`/seo/${seoProjectId}/keywords`);
  return actionSuccess({ count: result.count });
}

export async function bulkRestoreKeywords(
  seoProjectId: string,
  ids: string[]
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore keywords.");
  }

  const ownedIds = await getOwnedKeywordIds(seoProjectId, actor.companyId, ids);
  if (ownedIds.length === 0) return actionError("No matching keywords found.");

  const result = await prisma.keyword.updateMany({
    where: { id: { in: ownedIds } },
    data: { deletedAt: null },
  });

  await logActivity({
    actorId: actor.id,
    action: "keyword.bulk_restored",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { count: result.count },
  });

  revalidatePath(`/seo/${seoProjectId}/keywords`);
  return actionSuccess({ count: result.count });
}

/**
 * Permanent delete — deliberately restricted to keywords already archived
 * (deletedAt not null), a trash-then-purge pattern. No record type in this
 * codebase has ever supported hard deletion; scoping it to "already
 * archived" keeps that a deliberate, hard-to-reach action rather than a
 * one-click data-loss risk on active keywords.
 */
export async function bulkDeleteKeywords(
  seoProjectId: string,
  ids: string[]
): Promise<ActionResult<{ count: number }>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to delete keywords.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const result = await prisma.keyword.deleteMany({
    where: { id: { in: ids }, seoProjectId, deletedAt: { not: null } },
  });

  await logActivity({
    actorId: actor.id,
    action: "keyword.bulk_deleted",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { count: result.count },
  });

  revalidatePath(`/seo/${seoProjectId}/keywords`);
  return actionSuccess({ count: result.count });
}

type ImportSummary = {
  created: number;
  errors: { row: number; message: string }[];
};

export async function importKeywordsCsv(
  seoProjectId: string,
  formData: FormData
): Promise<ActionResult<ImportSummary>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to import keywords.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return actionError("Choose a CSV file first.");
  }

  const text = await file.text();
  const rawRows = parseCsv(text);
  if (rawRows.length === 0) {
    return actionError("The CSV file has no data rows.");
  }

  const clusterCache = new Map<string, string>();
  async function resolveClusterId(name: string | undefined): Promise<string | null> {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    if (clusterCache.has(key)) return clusterCache.get(key)!;

    const existingCluster = await prisma.keywordCluster.findFirst({
      where: { seoProjectId, name: { equals: name, mode: "insensitive" } },
    });
    const cluster =
      existingCluster ??
      (await prisma.keywordCluster.create({ data: { seoProjectId, name } }));
    clusterCache.set(key, cluster.id);
    return cluster.id;
  }

  const errors: ImportSummary["errors"] = [];
  let created = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 2; // 1-indexed + header row
    const parsedRow = keywordImportRowSchema.safeParse(rawRows[i]);
    if (!parsedRow.success) {
      errors.push({ row: rowNumber, message: parsedRow.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }

    const existing = await prisma.keyword.findUnique({
      where: { seoProjectId_term: { seoProjectId, term: parsedRow.data.term } },
    });
    if (existing) {
      errors.push({ row: rowNumber, message: `"${parsedRow.data.term}" already exists` });
      continue;
    }

    try {
      const clusterId = await resolveClusterId(parsedRow.data.cluster);
      await prisma.keyword.create({
        data: {
          seoProjectId,
          clusterId,
          term: parsedRow.data.term,
          searchVolume: toNullableNumber(parsedRow.data.searchVolume),
          difficulty: toNullableNumber(parsedRow.data.difficulty),
          currentRank: toNullableNumber(parsedRow.data.currentRank),
          targetUrl: parsedRow.data.targetUrl || null,
          intent: parsedRow.data.intent || null,
          priority: parsedRow.data.priority,
          status: parsedRow.data.status,
        },
      });
      created++;
    } catch {
      errors.push({ row: rowNumber, message: "Failed to import this row" });
    }
  }

  await logActivity({
    actorId: actor.id,
    action: "keyword.csv_imported",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { created, errorCount: errors.length },
  });

  revalidatePath(`/seo/${seoProjectId}/keywords`);
  return actionSuccess({ created, errors });
}
