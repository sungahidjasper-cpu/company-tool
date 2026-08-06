import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

type LogActivityInput = {
  actorId?: string | null;
  action: string;
  clientId?: string;
  contactId?: string;
  projectId?: string;
  taskId?: string;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Single write path for every Activity row. Used both to build a record's
 * activity timeline (Client detail) and to feed the dashboard's recent
 * activity feed — one helper, two consumers, no duplicated insert logic.
 */
export function logActivity(input: LogActivityInput) {
  return prisma.activity.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      clientId: input.clientId,
      contactId: input.contactId,
      projectId: input.projectId,
      taskId: input.taskId,
      metadata: input.metadata,
    },
  });
}
