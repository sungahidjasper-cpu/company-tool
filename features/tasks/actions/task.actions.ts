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
  quickSubtaskSchema,
  taskSchema,
  taskStatusSchema,
  type TaskInput,
} from "@/features/tasks/schemas/task.schema";

function taskListPath(projectId: string) {
  return `/projects/${projectId}/tasks`;
}

function taskDetailPath(projectId: string, taskId: string) {
  return `/projects/${projectId}/tasks/${taskId}`;
}

function getTaskWithProject(id: string) {
  return prisma.task.findUnique({
    where: { id },
    include: { project: { select: { companyId: true } } },
  });
}

async function validateAssignee(companyId: string, assigneeId?: string) {
  if (!assigneeId) return true;
  const count = await prisma.user.count({
    where: { id: assigneeId, companyId },
  });
  return count > 0;
}

export async function createTask(
  projectId: string,
  input: TaskInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to create tasks.");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project || project.companyId !== actor.companyId) {
    return actionError("Project not found.");
  }

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (!(await validateAssignee(actor.companyId, parsed.data.assigneeId))) {
    return actionError("Selected assignee is invalid.");
  }

  const task = await prisma.task.create({
    data: {
      projectId,
      createdById: actor.id,
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status,
      priority: parsed.data.priority,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      assigneeId: parsed.data.assigneeId || null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "task.created",
    companyId: actor.companyId,
    projectId,
    taskId: task.id,
    metadata: { title: task.title },
  });

  if (task.assigneeId && task.assigneeId !== actor.id) {
    await createNotification({
      userId: task.assigneeId,
      type: "TASK_ASSIGNED",
      message: `${actor.firstName} assigned you the task "${task.title}"`,
      link: taskDetailPath(projectId, task.id),
    });
  }

  revalidatePath(taskListPath(projectId));
  revalidatePath(`/projects/${projectId}`);
  return actionSuccess({ id: task.id });
}

export async function updateTask(
  id: string,
  input: TaskInput
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to edit tasks.");
  }

  const existing = await getTaskWithProject(id);
  if (!existing || existing.project.companyId !== actor.companyId) {
    return actionError("Task not found.");
  }

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  if (!(await validateAssignee(actor.companyId, parsed.data.assigneeId))) {
    return actionError("Selected assignee is invalid.");
  }

  const task = await prisma.task.update({
    where: { id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status,
      priority: parsed.data.priority,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      assigneeId: parsed.data.assigneeId || null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "task.updated",
    companyId: actor.companyId,
    projectId: existing.projectId,
    taskId: task.id,
    metadata: { title: task.title },
  });

  const assigneeChanged = task.assigneeId !== existing.assigneeId;
  if (assigneeChanged && task.assigneeId && task.assigneeId !== actor.id) {
    await createNotification({
      userId: task.assigneeId,
      type: "TASK_ASSIGNED",
      message: `${actor.firstName} assigned you the task "${task.title}"`,
      link: taskDetailPath(existing.projectId, task.id),
    });
  }

  revalidatePath(taskListPath(existing.projectId));
  revalidatePath(taskDetailPath(existing.projectId, id));
  return actionSuccess({ id: task.id });
}

/**
 * Lighter than updateTask: allowed for a Manager+, or the task's own
 * assignee moving their own work through the status workflow.
 */
export async function updateTaskStatus(
  id: string,
  status: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await getTaskWithProject(id);
  if (!existing || existing.project.companyId !== actor.companyId) {
    return actionError("Task not found.");
  }

  const canAct =
    Permissions.manageProjects(actor.role) || existing.assigneeId === actor.id;
  if (!canAct) {
    return actionError("You do not have permission to update this task.");
  }

  const parsed = taskStatusSchema.safeParse({ status });
  if (!parsed.success) {
    return actionError("Invalid status.");
  }

  await prisma.task.update({
    where: { id },
    data: { status: parsed.data.status },
  });

  await logActivity({
    actorId: actor.id,
    action: "task.status_changed",
    companyId: actor.companyId,
    projectId: existing.projectId,
    taskId: id,
    metadata: { status: parsed.data.status },
  });

  revalidatePath(taskListPath(existing.projectId));
  revalidatePath(taskDetailPath(existing.projectId, id));
  return actionSuccess();
}

export async function archiveTask(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to archive tasks.");
  }

  const existing = await getTaskWithProject(id);
  if (!existing || existing.project.companyId !== actor.companyId) {
    return actionError("Task not found.");
  }

  await prisma.task.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await logActivity({
    actorId: actor.id,
    action: "task.archived",
    companyId: actor.companyId,
    projectId: existing.projectId,
    taskId: id,
  });

  revalidatePath(taskListPath(existing.projectId));
  return actionSuccess();
}

export async function restoreTask(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to restore tasks.");
  }

  const existing = await getTaskWithProject(id);
  if (!existing || existing.project.companyId !== actor.companyId) {
    return actionError("Task not found.");
  }

  await prisma.task.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "task.restored",
    companyId: actor.companyId,
    projectId: existing.projectId,
    taskId: id,
  });

  revalidatePath(taskListPath(existing.projectId));
  return actionSuccess();
}

export async function addTaskComment(
  taskId: string,
  body: string
): Promise<ActionResult> {
  const actor = await requireUser();

  const existing = await getTaskWithProject(taskId);
  if (!existing || existing.project.companyId !== actor.companyId) {
    return actionError("Task not found.");
  }

  if (body.trim().length === 0) {
    return actionError("Comment cannot be empty.");
  }

  await prisma.note.create({
    data: { authorId: actor.id, taskId, body: body.trim() },
  });

  await logActivity({
    actorId: actor.id,
    action: "task.comment_added",
    companyId: actor.companyId,
    projectId: existing.projectId,
    taskId,
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
      message: `${actor.firstName} mentioned you in a task comment`,
      link: taskDetailPath(existing.projectId, taskId),
    });
  }

  revalidatePath(taskDetailPath(existing.projectId, taskId));
  return actionSuccess();
}

export async function createSubtask(
  parentTaskId: string,
  title: string
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageProjects(actor.role)) {
    return actionError("You do not have permission to create subtasks.");
  }

  const parent = await getTaskWithProject(parentTaskId);
  if (!parent || parent.project.companyId !== actor.companyId) {
    return actionError("Task not found.");
  }

  const parsed = quickSubtaskSchema.safeParse({ title });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const subtask = await prisma.task.create({
    data: {
      projectId: parent.projectId,
      parentTaskId,
      createdById: actor.id,
      title: parsed.data.title,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "task.subtask_created",
    companyId: actor.companyId,
    projectId: parent.projectId,
    taskId: parentTaskId,
    metadata: { subtaskId: subtask.id, title: subtask.title },
  });

  revalidatePath(taskDetailPath(parent.projectId, parentTaskId));
  return actionSuccess({ id: subtask.id });
}
