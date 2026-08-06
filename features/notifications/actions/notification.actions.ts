"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** updateMany + userId filter enforces ownership implicitly: a mismatched
 * id just updates zero rows instead of needing a separate check + throw. */
export async function markNotificationRead(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  await prisma.notification.updateMany({
    where: { id, userId: actor.id },
    data: { isRead: true },
  });

  revalidatePath("/dashboard");
  return actionSuccess();
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const actor = await requireUser();

  await prisma.notification.updateMany({
    where: { userId: actor.id, isRead: false },
    data: { isRead: true },
  });

  revalidatePath("/dashboard");
  return actionSuccess();
}
