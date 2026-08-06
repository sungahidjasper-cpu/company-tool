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
    clientId,
  });

  revalidatePath(`/clients/${clientId}`);
  return actionSuccess();
}
