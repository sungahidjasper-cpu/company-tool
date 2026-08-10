import { Permissions } from "@/lib/authorization";
import type { UserRole } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { FileEntityType } from "@/features/files/schemas/file.schema";

/**
 * The single place that knows what each FileEntityType maps to: which File
 * column it targets, which company owns it, which permission tier can
 * manage it, and which page(s) to revalidate. Every other file-upload
 * consumer (actions, route handler, service) goes through this instead of
 * re-deriving the same switch statement.
 */

export function buildEntityWhere(entityType: FileEntityType, entityId: string) {
  switch (entityType) {
    case "company":
      return { companyId: entityId };
    case "client":
      return { clientId: entityId };
    case "project":
      return { projectId: entityId };
    case "task":
      return { taskId: entityId };
    case "lead":
      return { leadId: entityId };
    case "user":
      return { userId: entityId };
  }
}

export function canManageEntityFiles(entityType: FileEntityType, role: UserRole) {
  switch (entityType) {
    case "company":
      return Permissions.manageCompanies(role);
    case "client":
      return Permissions.manageClients(role);
    case "project":
      return Permissions.manageProjects(role);
    case "task":
      return Permissions.manageProjects(role);
    case "lead":
      return Permissions.manageLeads(role);
    case "user":
      return Permissions.manageUsers(role);
  }
}

export type EntityContext = {
  companyId: string;
  paths: string[];
  isAssignee: boolean;
};

/** Resolves ownership + revalidation paths + (for tasks) assignee status, in one query per target. */
export async function resolveEntityContext(
  entityType: FileEntityType,
  entityId: string,
  actorId: string
): Promise<EntityContext | null> {
  switch (entityType) {
    case "company": {
      const company = await prisma.company.findUnique({ where: { id: entityId } });
      if (!company) return null;
      return {
        companyId: company.id,
        paths: [`/companies/${company.id}`],
        isAssignee: false,
      };
    }
    case "client": {
      const client = await prisma.client.findUnique({ where: { id: entityId } });
      if (!client) return null;
      return {
        companyId: client.companyId,
        paths: [`/clients/${client.id}`],
        isAssignee: false,
      };
    }
    case "project": {
      const project = await prisma.project.findUnique({ where: { id: entityId } });
      if (!project) return null;
      return {
        companyId: project.companyId,
        paths: [`/projects/${project.id}`],
        isAssignee: false,
      };
    }
    case "task": {
      const task = await prisma.task.findUnique({
        where: { id: entityId },
        include: { project: { select: { id: true, companyId: true } } },
      });
      if (!task) return null;
      return {
        companyId: task.project.companyId,
        paths: [`/projects/${task.project.id}/tasks/${task.id}`],
        isAssignee: task.assigneeId === actorId,
      };
    }
    case "lead": {
      const lead = await prisma.lead.findUnique({ where: { id: entityId } });
      if (!lead) return null;
      return {
        companyId: lead.companyId,
        paths: [`/leads/${lead.id}`],
        isAssignee: lead.assignedUserId === actorId,
      };
    }
    case "user": {
      const targetUser = await prisma.user.findUnique({ where: { id: entityId } });
      if (!targetUser) return null;
      return {
        companyId: targetUser.companyId,
        paths: [`/users/${targetUser.id}`],
        isAssignee: false,
      };
    }
  }
}

/** Which Activity FK (if any) this entity type can log against — Company/User have none. */
export function buildActivityRefs(entityType: FileEntityType, entityId: string) {
  switch (entityType) {
    case "client":
      return { clientId: entityId };
    case "project":
      return { projectId: entityId };
    case "task":
      return { taskId: entityId };
    case "lead":
      return { leadId: entityId };
    case "company":
    case "user":
      return {};
  }
}

type FileTargets = {
  companyId: string | null;
  clientId: string | null;
  projectId: string | null;
  taskId: string | null;
  leadId: string | null;
  userId: string | null;
};

/** Inverse of buildEntityWhere: given a File row, which target does it belong to? */
export function resolveEntityTypeFromFile(file: FileTargets): FileEntityType | null {
  if (file.companyId) return "company";
  if (file.clientId) return "client";
  if (file.projectId) return "project";
  if (file.taskId) return "task";
  if (file.leadId) return "lead";
  if (file.userId) return "user";
  return null;
}

export function getEntityIdFromFile(file: FileTargets, entityType: FileEntityType): string {
  switch (entityType) {
    case "company":
      return file.companyId as string;
    case "client":
      return file.clientId as string;
    case "project":
      return file.projectId as string;
    case "task":
      return file.taskId as string;
    case "lead":
      return file.leadId as string;
    case "user":
      return file.userId as string;
  }
}

/**
 * Who should be notified about a file uploaded to this target. Company
 * has no single natural recipient (tenant-wide), so it's intentionally
 * excluded — see the Phase 6 report.
 */
export async function getFileNotificationRecipients(
  entityType: FileEntityType,
  entityId: string,
  excludeUserId: string
): Promise<string[]> {
  switch (entityType) {
    case "client": {
      const client = await prisma.client.findUnique({ where: { id: entityId } });
      return client?.ownerId && client.ownerId !== excludeUserId
        ? [client.ownerId]
        : [];
    }
    case "project": {
      const project = await prisma.project.findUnique({
        where: { id: entityId },
        include: { assignedUsers: { select: { id: true } } },
      });
      if (!project) return [];
      const ids = [project.ownerId, ...project.assignedUsers.map((u) => u.id)];
      return Array.from(
        new Set(
          ids.filter((userId): userId is string => Boolean(userId) && userId !== excludeUserId)
        )
      );
    }
    case "task": {
      const task = await prisma.task.findUnique({ where: { id: entityId } });
      return task?.assigneeId && task.assigneeId !== excludeUserId
        ? [task.assigneeId]
        : [];
    }
    case "lead": {
      const lead = await prisma.lead.findUnique({ where: { id: entityId } });
      return lead?.assignedUserId && lead.assignedUserId !== excludeUserId
        ? [lead.assignedUserId]
        : [];
    }
    case "user":
      return entityId !== excludeUserId ? [entityId] : [];
    case "company":
      return [];
  }
}
