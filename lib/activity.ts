import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

type LogActivityInput = {
  actorId?: string | null;
  action: string;
  companyId?: string;
  userId?: string;
  clientId?: string;
  contactId?: string;
  projectId?: string;
  taskId?: string;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Resolves which company owns this activity from whichever ref was passed,
 * so every caller (including every existing Phase 4/5 call site, unchanged)
 * gets a properly company-scoped row without having to know or pass it
 * explicitly. Only used when companyId wasn't already given directly.
 */
async function resolveCompanyId(input: LogActivityInput): Promise<string | null> {
  if (input.companyId) return input.companyId;

  if (input.userId) {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    return user?.companyId ?? null;
  }
  if (input.clientId) {
    const client = await prisma.client.findUnique({ where: { id: input.clientId } });
    return client?.companyId ?? null;
  }
  if (input.projectId) {
    const project = await prisma.project.findUnique({ where: { id: input.projectId } });
    return project?.companyId ?? null;
  }
  if (input.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      include: { project: { select: { companyId: true } } },
    });
    return task?.project.companyId ?? null;
  }
  if (input.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: input.contactId },
      include: { client: { select: { companyId: true } } },
    });
    return contact?.client.companyId ?? null;
  }

  return null;
}

/**
 * Single write path for every Activity row. Used both to build a record's
 * activity timeline (Client/Project/Task detail) and to feed the
 * dashboard's recent activity feed and trend chart — one helper, several
 * consumers, no duplicated insert logic.
 */
export async function logActivity(input: LogActivityInput) {
  const companyId = await resolveCompanyId(input);

  return prisma.activity.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      companyId,
      userId: input.userId,
      clientId: input.clientId,
      contactId: input.contactId,
      projectId: input.projectId,
      taskId: input.taskId,
      metadata: input.metadata,
    },
  });
}
