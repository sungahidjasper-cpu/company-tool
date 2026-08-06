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
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/features/users/schemas/user.schema";

export async function createUser(
  input: CreateUserInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageUsers(actor.role)) {
    return actionError("You do not have permission to create users.");
  }

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (parsed.data.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    return actionError("Only a Super Admin can grant the Super Admin role.");
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) {
    return actionError("A user with that email already exists.");
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const user = await prisma.user.create({
    data: {
      companyId: actor.companyId,
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      role: parsed.data.role,
      passwordHash,
      status: "ACTIVE",
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "user.created",
    metadata: { userId: user.id, email: user.email },
  });

  revalidatePath("/users");
  return actionSuccess({ id: user.id });
}

export async function updateUser(
  id: string,
  input: UpdateUserInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageUsers(actor.role)) {
    return actionError("You do not have permission to edit users.");
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.companyId !== actor.companyId) {
    return actionError("User not found.");
  }

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (parsed.data.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    return actionError("Only a Super Admin can grant the Super Admin role.");
  }

  const user = await prisma.user.update({
    where: { id },
    data: parsed.data,
  });

  await logActivity({
    actorId: actor.id,
    action: "user.updated",
    metadata: { userId: user.id },
  });

  revalidatePath("/users");
  revalidatePath(`/users/${id}`);
  return actionSuccess({ id: user.id });
}

async function transitionUserStatus(
  id: string,
  status: "ACTIVE" | "SUSPENDED",
  action: string
): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageUsers(actor.role)) {
    return actionError(
      "You do not have permission to change this user's status."
    );
  }

  if (id === actor.id) {
    return actionError("You cannot change your own status.");
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.companyId !== actor.companyId) {
    return actionError("User not found.");
  }

  await prisma.user.update({ where: { id }, data: { status } });

  await logActivity({ actorId: actor.id, action, metadata: { userId: id } });

  revalidatePath("/users");
  return actionSuccess();
}

export async function activateUser(id: string): Promise<ActionResult> {
  return transitionUserStatus(id, "ACTIVE", "user.activated");
}

export async function suspendUser(id: string): Promise<ActionResult> {
  return transitionUserStatus(id, "SUSPENDED", "user.suspended");
}

export async function archiveUser(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageUsers(actor.role)) {
    return actionError("You do not have permission to archive users.");
  }

  if (id === actor.id) {
    return actionError("You cannot archive your own account.");
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.companyId !== actor.companyId) {
    return actionError("User not found.");
  }

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await logActivity({
    actorId: actor.id,
    action: "user.archived",
    metadata: { userId: id },
  });

  revalidatePath("/users");
  return actionSuccess();
}

export async function restoreUser(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageUsers(actor.role)) {
    return actionError("You do not have permission to restore users.");
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.companyId !== actor.companyId) {
    return actionError("User not found.");
  }

  await prisma.user.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "user.restored",
    metadata: { userId: id },
  });

  revalidatePath("/users");
  return actionSuccess();
}
