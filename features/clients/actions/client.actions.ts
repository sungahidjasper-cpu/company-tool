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
  clientSchema,
  type ClientInput,
} from "@/features/clients/schemas/client.schema";

export async function createClient(
  input: ClientInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to create clients.");
  }

  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const client = await prisma.client.create({
    data: {
      companyId: actor.companyId,
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      website: parsed.data.website,
      industry: parsed.data.industry,
      address: parsed.data.address,
      source: parsed.data.source,
      status: parsed.data.status,
      ownerId: parsed.data.ownerId || null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "client.created",
    companyId: actor.companyId,
    clientId: client.id,
    metadata: { name: client.name },
  });

  revalidatePath("/clients");
  return actionSuccess({ id: client.id });
}

export async function updateClient(
  id: string,
  input: ClientInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to edit clients.");
  }

  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Client not found.");
  }

  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const client = await prisma.client.update({
    where: { id },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      website: parsed.data.website,
      industry: parsed.data.industry,
      address: parsed.data.address,
      source: parsed.data.source,
      status: parsed.data.status,
      ownerId: parsed.data.ownerId || null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "client.updated",
    companyId: actor.companyId,
    clientId: client.id,
    metadata: { name: client.name },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return actionSuccess({ id: client.id });
}

export async function archiveClient(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to archive clients.");
  }

  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Client not found.");
  }

  await prisma.client.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await logActivity({
    actorId: actor.id,
    action: "client.archived",
    companyId: actor.companyId,
    clientId: id,
  });

  revalidatePath("/clients");
  return actionSuccess();
}

export async function restoreClient(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to restore clients.");
  }

  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Client not found.");
  }

  await prisma.client.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "client.restored",
    companyId: actor.companyId,
    clientId: id,
  });

  revalidatePath("/clients");
  return actionSuccess();
}

export async function addClientNote(
  clientId: string,
  body: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await prisma.client.findUnique({ where: { id: clientId } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Client not found.");
  }

  if (body.trim().length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.create({
    data: { authorId: actor.id, clientId, body: body.trim() },
  });

  await logActivity({
    actorId: actor.id,
    action: "client.note_added",
    companyId: actor.companyId,
    clientId,
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
      link: `/clients/${clientId}`,
    });
  }

  revalidatePath(`/clients/${clientId}`);
  return actionSuccess();
}

/** Fetch-then-compare, matching addClientNote's own tenant-check idiom, extended to the Note's parent relation rather than the Client directly. */
async function getOwnedClientNote(noteId: string, companyId: string) {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { client: { select: { id: true, companyId: true } } },
  });
  if (!note || !note.client || note.client.companyId !== companyId) return null;
  return { ...note, client: note.client };
}

/**
 * Phase 26 Stage 3 — manager-or-author edit. Tenant ownership is re-derived
 * from the Note's own client relation, never from a client-supplied id.
 * Rejects editing an already-deleted note. Never substitutes the Client's
 * own ownership/assignment fields for note.authorId.
 */
export async function updateClientNote(input: { noteId: string; body: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedClientNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.deletedAt) {
    return actionError("This note has already been deleted.");
  }

  if (note.authorId !== actor.id && !Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to edit this note.");
  }

  const trimmed = input.body.trim();
  if (trimmed.length === 0) {
    return actionError("Note cannot be empty.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { body: trimmed } });

  await logActivity({
    actorId: actor.id,
    action: "client.note_updated",
    companyId: actor.companyId,
    clientId: note.client.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(`/clients/${note.client.id}`);
  return actionSuccess();
}

/**
 * Phase 26 Stage 3 — manager-or-author soft delete. Same ownership
 * re-derivation as updateClientNote. Never hard-deletes.
 */
export async function deleteClientNote(input: { noteId: string }): Promise<ActionResult> {
  const actor = await requireUser();

  const note = await getOwnedClientNote(input.noteId, actor.companyId);
  if (!note) {
    return actionError("Note not found.");
  }

  if (note.authorId !== actor.id && !Permissions.manageClients(actor.role)) {
    return actionError("You do not have permission to delete this note.");
  }

  await prisma.note.update({ where: { id: input.noteId }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "client.note_deleted",
    companyId: actor.companyId,
    clientId: note.client.id,
    metadata: { noteId: input.noteId },
  });

  revalidatePath(`/clients/${note.client.id}`);
  return actionSuccess();
}
