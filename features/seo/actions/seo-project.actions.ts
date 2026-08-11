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
import { extractMentionedUserIds } from "@/features/notifications/services/mention.service";
import { createNotification } from "@/features/notifications/services/notification.service";
import {
  seoProjectSchema,
  type SeoProjectInput,
} from "@/features/seo/schemas/seo-project.schema";

export async function createSeoProject(
  input: SeoProjectInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to create SEO projects.");
  }

  const parsed = seoProjectSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await prisma.sEOProject.create({
    data: {
      companyId: actor.companyId,
      name: parsed.data.name,
      domain: parsed.data.domain,
      clientId: parsed.data.clientId || null,
      ownerId: parsed.data.ownerId || null,
      status: parsed.data.status,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.created",
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    metadata: { name: seoProject.name },
  });

  revalidatePath("/seo");
  return actionSuccess({ id: seoProject.id });
}

export async function updateSeoProject(
  id: string,
  input: SeoProjectInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to edit SEO projects.");
  }

  const existing = await prisma.sEOProject.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  const parsed = seoProjectSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const seoProject = await prisma.sEOProject.update({
    where: { id },
    data: {
      name: parsed.data.name,
      domain: parsed.data.domain,
      clientId: parsed.data.clientId || null,
      ownerId: parsed.data.ownerId || null,
      status: parsed.data.status,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.updated",
    companyId: actor.companyId,
    seoProjectId: seoProject.id,
    metadata: { name: seoProject.name },
  });

  revalidatePath("/seo");
  revalidatePath(`/seo/${id}`);
  return actionSuccess({ id: seoProject.id });
}

export async function archiveSeoProject(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to archive SEO projects.");
  }

  const existing = await prisma.sEOProject.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  await prisma.sEOProject.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.archived",
    companyId: actor.companyId,
    seoProjectId: id,
  });

  revalidatePath("/seo");
  return actionSuccess();
}

export async function restoreSeoProject(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to restore SEO projects.");
  }

  const existing = await prisma.sEOProject.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  await prisma.sEOProject.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.restored",
    companyId: actor.companyId,
    seoProjectId: id,
  });

  revalidatePath("/seo");
  return actionSuccess();
}

export async function addSeoProjectNote(
  seoProjectId: string,
  body: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await prisma.sEOProject.findUnique({ where: { id: seoProjectId } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("SEO project not found.");
  }

  if (body.trim().length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.create({
    data: { authorId: actor.id, seoProjectId, body: body.trim() },
  });

  await logActivity({
    actorId: actor.id,
    action: "seo_project.note_added",
    companyId: actor.companyId,
    seoProjectId,
  });

  const mentionedUserIds = await extractMentionedUserIds(
    body,
    actor.companyId,
    actor.id
  );
  for (const userId of mentionedUserIds) {
    await createNotification({
      userId,
      type: "COMMENT_MENTION",
      message: `${actor.firstName} mentioned you in a note on ${existing.name}`,
      link: `/seo/${seoProjectId}`,
    });
  }

  revalidatePath(`/seo/${seoProjectId}`);
  return actionSuccess();
}
