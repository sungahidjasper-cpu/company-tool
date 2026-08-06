import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/lib/generated/prisma/enums";

type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  message: string;
  link?: string;
};

export function createNotification(input: CreateNotificationInput) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      message: input.message,
      link: input.link,
    },
  });
}

export function getNotifications(userId: string, take = 20) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export function getUnreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

/**
 * Computed on read, not stored — there's no cron/job infrastructure in
 * this project, and a stored reminder can go stale or duplicate. Querying
 * "my open tasks due within 48h or overdue" at render time is simpler and
 * always correct. Merged into the same bell UI, clearly marked virtual.
 */
export async function getDueDateReminders(userId: string) {
  const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: userId,
      deletedAt: null,
      status: { notIn: ["DONE", "CANCELLED"] },
      dueDate: { not: null, lte: in48h },
    },
    orderBy: { dueDate: "asc" },
    include: { project: { select: { id: true } } },
    take: 10,
  });

  const now = new Date();

  return tasks.map((task) => ({
    id: `due-${task.id}`,
    type: "DUE_DATE_REMINDER" as const,
    message:
      task.dueDate && task.dueDate < now
        ? `"${task.title}" is overdue`
        : `"${task.title}" is due soon`,
    link: `/projects/${task.project.id}/tasks/${task.id}`,
    createdAt: task.dueDate ?? now,
    isRead: false,
    isVirtual: true as const,
  }));
}
