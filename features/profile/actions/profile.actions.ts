"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import {
  actionError,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from "@/features/profile/schemas/profile.schema";

/**
 * Self-service only — takes no target id. Every authenticated user may
 * edit their own profile/password, so there is no Permissions tier to
 * gate; the authorization is simply "you're the one signed in as actor.id".
 */
export async function updateProfile(
  input: UpdateProfileInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const emailTaken = await prisma.user.findFirst({
    where: { email: parsed.data.email, id: { not: actor.id } },
  });
  if (emailTaken) {
    return actionError("A user with that email already exists.");
  }

  const user = await prisma.user.update({
    where: { id: actor.id },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      avatar: parsed.data.avatar || null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "user.profile_updated",
    companyId: actor.companyId,
    userId: user.id,
  });

  revalidatePath("/profile");
  return actionSuccess({ id: user.id });
}

export async function changePassword(
  input: ChangePasswordInput
): Promise<ActionResult> {
  const actor = await requireUser();

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user || !user.passwordHash) {
    return actionError("Unable to change password for this account.");
  }

  const isCurrentValid = await verifyPassword(
    parsed.data.currentPassword,
    user.passwordHash
  );
  if (!isCurrentValid) {
    return actionError("Current password is incorrect.");
  }

  if (parsed.data.newPassword === parsed.data.currentPassword) {
    return actionError("New password must be different from the current password.");
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: actor.id },
    data: { passwordHash },
  });

  await logActivity({
    actorId: actor.id,
    action: "user.password_changed",
    companyId: actor.companyId,
    userId: actor.id,
  });

  return actionSuccess();
}
