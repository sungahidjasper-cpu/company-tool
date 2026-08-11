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
import { prisma } from "@/lib/prisma";
import {
  keywordClusterSchema,
  type KeywordClusterInput,
} from "@/features/seo/schemas/keyword-cluster.schema";

function getClusterWithProject(id: string) {
  return prisma.keywordCluster.findUnique({
    where: { id },
    include: { seoProject: { select: { id: true, companyId: true } } },
  });
}

export async function createCluster(
  seoProjectId: string,
  input: KeywordClusterInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to create keyword clusters.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const parsed = keywordClusterSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const cluster = await prisma.keywordCluster.create({
    data: {
      seoProjectId,
      name: parsed.data.name,
      description: parsed.data.description,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "keyword_cluster.created",
    companyId: actor.companyId,
    seoProjectId,
    metadata: { clusterId: cluster.id, name: cluster.name },
  });

  revalidatePath(`/seo/${seoProjectId}/clusters`);
  revalidatePath(`/seo/${seoProjectId}`);
  return actionSuccess({ id: cluster.id });
}

export async function updateCluster(
  id: string,
  input: KeywordClusterInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit keyword clusters.");
  }

  const existing = await getClusterWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Keyword cluster not found.");
  }

  const parsed = keywordClusterSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const cluster = await prisma.keywordCluster.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "keyword_cluster.updated",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    metadata: { clusterId: cluster.id, name: cluster.name },
  });

  revalidatePath(`/seo/${existing.seoProject.id}/clusters`);
  revalidatePath(`/seo/${existing.seoProject.id}/clusters/${id}`);
  return actionSuccess({ id: cluster.id });
}

export async function archiveCluster(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to archive keyword clusters.");
  }

  const existing = await getClusterWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Keyword cluster not found.");
  }

  await prisma.keywordCluster.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "keyword_cluster.archived",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    metadata: { clusterId: id },
  });

  revalidatePath(`/seo/${existing.seoProject.id}/clusters`);
  return actionSuccess();
}

export async function restoreCluster(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore keyword clusters.");
  }

  const existing = await getClusterWithProject(id);
  if (!existing || existing.seoProject.companyId !== actor.companyId) {
    return actionError("Keyword cluster not found.");
  }

  await prisma.keywordCluster.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "keyword_cluster.restored",
    companyId: actor.companyId,
    seoProjectId: existing.seoProject.id,
    metadata: { clusterId: id },
  });

  revalidatePath(`/seo/${existing.seoProject.id}/clusters`);
  return actionSuccess();
}
