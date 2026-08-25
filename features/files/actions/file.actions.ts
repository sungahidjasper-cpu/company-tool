"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import {
  actionError,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { createNotification } from "@/features/notifications/services/notification.service";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  fileEntityTypeSchema,
} from "@/features/files/schemas/file.schema";
import {
  buildActivityRefs,
  buildEntityWhere,
  canManageEntityFiles,
  getEntityIdFromFile,
  getFileNotificationRecipients,
  resolveEntityContext,
  resolveEntityTypeFromFile,
} from "@/features/files/services/entity-target";

export async function uploadFile(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  const parsedType = fileEntityTypeSchema.safeParse(formData.get("entityType"));
  const entityId = formData.get("entityId");
  const file = formData.get("file");

  if (!parsedType.success || typeof entityId !== "string" || !entityId) {
    return actionError("Invalid upload target.");
  }
  const entityType = parsedType.data;

  if (!(file instanceof File)) {
    return actionError("No file provided.");
  }
  if (file.size === 0) {
    return actionError("The selected file is empty.");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return actionError("File exceeds the 10MB size limit.");
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return actionError("This file type is not supported.");
  }

  const context = await resolveEntityContext(entityType, entityId, actor.id);
  if (!context) {
    return actionError("Target record not found.");
  }
  if (context.companyId !== actor.companyId) {
    return actionError("You do not have access to this record.");
  }

  const canManage =
    canManageEntityFiles(entityType, actor.role) ||
    (["task", "lead", "seoProject", "content"].includes(entityType) && context.isAssignee);
  if (!canManage) {
    return actionError("You do not have permission to upload files here.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await storage.save({
    buffer,
    fileName: file.name,
    mimeType: file.type,
  });

  const record = await prisma.file.create({
    data: {
      uploadedById: actor.id,
      fileName: file.name,
      url: saved.key,
      mimeType: file.type,
      sizeBytes: saved.sizeBytes,
      ...buildEntityWhere(entityType, entityId),
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "file.uploaded",
    companyId: context.companyId,
    metadata: { fileId: record.id, fileName: record.fileName, entityType },
    ...buildActivityRefs(entityType, entityId),
  });

  const recipientIds = await getFileNotificationRecipients(
    entityType,
    entityId,
    actor.id
  );
  for (const userId of recipientIds) {
    await createNotification({
      userId,
      type: "FILE_UPLOADED",
      message: `${actor.firstName} uploaded "${record.fileName}"`,
      link: context.paths[0],
    });
  }

  context.paths.forEach((path) => revalidatePath(path));
  return actionSuccess({ id: record.id });
}

/**
 * Phase 26 Stage 2 — soft-delete only: sets deletedAt and never touches
 * storage. listFilesFor already filters deletedAt: null, so the file
 * disappears from every existing view immediately, exactly as a hard
 * delete would have looked to a user — but the DB row and the physical
 * object both survive, so a future restore/purge stage can act on real
 * data instead of a destroyed one. Permanent purge (deleting the DB row
 * AND calling storage.delete()) is deliberately out of scope here; that's
 * a separate future capability, not this action's job.
 */
export async function deleteFile(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) {
    return actionError("File not found.");
  }

  const entityType = resolveEntityTypeFromFile(file);
  if (!entityType) {
    return actionError("This file's target is not supported here.");
  }
  const entityId = getEntityIdFromFile(file, entityType);

  const context = await resolveEntityContext(entityType, entityId, actor.id);
  if (!context || context.companyId !== actor.companyId) {
    return actionError("You do not have access to this file.");
  }

  const canManage =
    canManageEntityFiles(entityType, actor.role) ||
    (["task", "lead", "seoProject", "content"].includes(entityType) && context.isAssignee) ||
    file.uploadedById === actor.id;
  if (!canManage) {
    return actionError("You do not have permission to delete this file.");
  }

  await prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "file.deleted",
    companyId: context.companyId,
    metadata: { fileId: file.id, fileName: file.fileName, entityType },
    ...buildActivityRefs(entityType, entityId),
  });

  context.paths.forEach((path) => revalidatePath(path));
  return actionSuccess();
}

/**
 * Phase 27 Stage 3 — restore only: clears deletedAt and never touches
 * storage, mirroring deleteFile's own restraint in reverse. The physical
 * object was never removed on delete, so restore never needs to recreate
 * or verify it — it's simply still there.
 */
export async function restoreFile(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) {
    return actionError("File not found.");
  }

  const entityType = resolveEntityTypeFromFile(file);
  if (!entityType) {
    return actionError("This file's target is not supported here.");
  }
  const entityId = getEntityIdFromFile(file, entityType);

  const context = await resolveEntityContext(entityType, entityId, actor.id);
  if (!context || context.companyId !== actor.companyId) {
    return actionError("You do not have access to this file.");
  }

  const canManage =
    canManageEntityFiles(entityType, actor.role) ||
    (["task", "lead", "seoProject", "content"].includes(entityType) && context.isAssignee) ||
    file.uploadedById === actor.id;
  if (!canManage) {
    return actionError("You do not have permission to restore this file.");
  }

  await prisma.file.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "file.restored",
    companyId: context.companyId,
    metadata: { fileId: file.id, fileName: file.fileName, entityType },
    ...buildActivityRefs(entityType, entityId),
  });

  context.paths.forEach((path) => revalidatePath(path));
  return actionSuccess();
}
