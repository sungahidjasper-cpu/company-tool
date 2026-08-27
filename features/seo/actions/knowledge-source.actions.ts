"use server";

import { revalidatePath } from "next/cache";

import {
  actionError,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import {
  knowledgeSourceLinkSchema,
  knowledgeSourceSchema,
  type KnowledgeSourceInput,
  type KnowledgeSourceLinkInput,
} from "@/features/seo/schemas/knowledge-source.schema";
import {
  findDuplicateKnowledgeSourceByUrl,
  getKnowledgeSourceById,
  listKnowledgeSourceLinksForSeoProject,
  listKnowledgeSources,
} from "@/features/seo/services/knowledge-source.service";

async function getOwnedKnowledgeSource(id: string, companyId: string) {
  const source = await getKnowledgeSourceById(id);
  if (!source || source.companyId !== companyId) return null;
  return source;
}

export async function createKnowledgeSource(
  input: KnowledgeSourceInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to add knowledge sources.");
  }

  const parsed = knowledgeSourceSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (parsed.data.url) {
    const duplicate = await findDuplicateKnowledgeSourceByUrl(actor.companyId, parsed.data.url);
    if (duplicate) {
      return actionError("A knowledge source with this URL already exists.");
    }
  }

  const source = await prisma.knowledgeSource.create({
    data: {
      companyId: actor.companyId,
      title: parsed.data.title,
      url: parsed.data.url ?? null,
      sourceType: parsed.data.sourceType,
      description: parsed.data.description ?? null,
      content: parsed.data.content ?? null,
      publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
      lastVerifiedAt: parsed.data.lastVerifiedAt ? new Date(parsed.data.lastVerifiedAt) : null,
      addedByUserId: actor.id,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "knowledge_source.created",
    companyId: actor.companyId,
    metadata: { knowledgeSourceId: source.id, title: source.title },
  });

  revalidatePath("/seo");
  return actionSuccess({ id: source.id });
}

export async function updateKnowledgeSource(
  id: string,
  input: KnowledgeSourceInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit knowledge sources.");
  }

  const existing = await getOwnedKnowledgeSource(id, actor.companyId);
  if (!existing) {
    return actionError("Knowledge source not found.");
  }

  const parsed = knowledgeSourceSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (parsed.data.url) {
    const duplicate = await findDuplicateKnowledgeSourceByUrl(actor.companyId, parsed.data.url);
    if (duplicate && duplicate.id !== id) {
      return actionError("A knowledge source with this URL already exists.");
    }
  }

  const source = await prisma.knowledgeSource.update({
    where: { id },
    data: {
      title: parsed.data.title,
      url: parsed.data.url ?? null,
      sourceType: parsed.data.sourceType,
      description: parsed.data.description ?? null,
      content: parsed.data.content ?? null,
      publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
      lastVerifiedAt: parsed.data.lastVerifiedAt ? new Date(parsed.data.lastVerifiedAt) : null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "knowledge_source.updated",
    companyId: actor.companyId,
    metadata: { knowledgeSourceId: source.id, title: source.title },
  });

  revalidatePath("/seo");
  return actionSuccess({ id: source.id });
}

export async function archiveKnowledgeSource(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to archive knowledge sources.");
  }

  const existing = await getOwnedKnowledgeSource(id, actor.companyId);
  if (!existing) {
    return actionError("Knowledge source not found.");
  }

  await prisma.knowledgeSource.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "knowledge_source.archived",
    companyId: actor.companyId,
    metadata: { knowledgeSourceId: id },
  });

  revalidatePath("/seo");
  return actionSuccess();
}

export async function restoreKnowledgeSource(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore knowledge sources.");
  }

  const existing = await getOwnedKnowledgeSource(id, actor.companyId);
  if (!existing) {
    return actionError("Knowledge source not found.");
  }

  await prisma.knowledgeSource.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "knowledge_source.restored",
    companyId: actor.companyId,
    metadata: { knowledgeSourceId: id },
  });

  revalidatePath("/seo");
  return actionSuccess();
}

export async function listKnowledgeSourcesAction(): Promise<ActionResult<Awaited<ReturnType<typeof listKnowledgeSources>>>> {
  const actor = await requireUser();
  const sources = await listKnowledgeSources(actor.companyId);
  return actionSuccess(sources);
}

/**
 * Links a KnowledgeSource to the SEOProject-level knowledge base it
 * supports. Both sides are re-verified against the actor's own company —
 * neither id is trusted from the client. See the KnowledgeSourceLink
 * schema comment for why the target is SEOProject only in this stage.
 */
export async function linkKnowledgeSourceToSeoProject(
  input: KnowledgeSourceLinkInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to link knowledge sources.");
  }

  const parsed = knowledgeSourceLinkSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const source = await getOwnedKnowledgeSource(parsed.data.knowledgeSourceId, actor.companyId);
  if (!source) {
    return actionError("Knowledge source not found.");
  }

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: parsed.data.seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const link = await prisma.knowledgeSourceLink.create({
    data: {
      knowledgeSourceId: parsed.data.knowledgeSourceId,
      seoProjectId: parsed.data.seoProjectId,
      note: parsed.data.note ?? null,
      createdByUserId: actor.id,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "knowledge_source.linked",
    companyId: actor.companyId,
    seoProjectId: parsed.data.seoProjectId,
    metadata: { knowledgeSourceId: parsed.data.knowledgeSourceId, linkId: link.id },
  });

  revalidatePath(`/seo/${parsed.data.seoProjectId}`);
  return actionSuccess({ id: link.id });
}

async function getOwnedKnowledgeSourceLink(linkId: string, companyId: string) {
  const link = await prisma.knowledgeSourceLink.findUnique({
    where: { id: linkId },
    include: { seoProject: { select: { id: true, companyId: true } } },
  });
  if (!link || link.seoProject.companyId !== companyId) return null;
  return link;
}

export async function unlinkKnowledgeSource(linkId: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to unlink knowledge sources.");
  }

  const link = await getOwnedKnowledgeSourceLink(linkId, actor.companyId);
  if (!link) {
    return actionError("Link not found.");
  }

  await prisma.knowledgeSourceLink.delete({ where: { id: linkId } });

  await logActivity({
    actorId: actor.id,
    action: "knowledge_source.unlinked",
    companyId: actor.companyId,
    seoProjectId: link.seoProject.id,
    metadata: { linkId },
  });

  revalidatePath(`/seo/${link.seoProject.id}`);
  return actionSuccess();
}

export async function listKnowledgeSourceLinksForSeoProjectAction(
  seoProjectId: string
): Promise<ActionResult<Awaited<ReturnType<typeof listKnowledgeSourceLinksForSeoProject>>>> {
  const actor = await requireUser();

  const seoProject = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!seoProject || seoProject.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const links = await listKnowledgeSourceLinksForSeoProject(seoProjectId);
  return actionSuccess(links);
}
