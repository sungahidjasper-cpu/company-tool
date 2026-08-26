import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/notifications/services/notification.service", () => ({ createNotification: vi.fn() }));

type MockPrisma = {
  note: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  task: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  project: { findUnique: ReturnType<typeof vi.fn> };
  user: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    note: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    task: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    project: { findUnique: vi.fn() },
    user: { count: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/features/notifications/services/notification.service";
import {
  deleteTaskComment,
  restoreTaskComment,
  updateTaskComment,
  createTask,
  updateTask,
  updateTaskStatus,
  archiveTask,
  restoreTask,
  addTaskComment,
  createSubtask,
} from "@/features/tasks/actions/task.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidatePath = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedCreateNotification = createNotification as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const AUTHOR = { id: "note-author-1", role: "EMPLOYEE", companyId: COMPANY_A, firstName: "Alex" };
const OTHER_EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A, firstName: "Sam" };
// This EMPLOYEE is the Task's own assignee — distinct from the note's author.
// Used to prove note authorization uses note.authorId, never task.assigneeId.
const TASK_ASSIGNEE_NOT_AUTHOR = { id: "user-assignee", role: "EMPLOYEE", companyId: COMPANY_A, firstName: "Jamie" };
const MANAGER = { id: "user-3", role: "MANAGER", companyId: COMPANY_A, firstName: "Morgan" };

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "project-1", companyId: COMPANY_A, ...overrides };
}

function makeTaskWithProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "task-1",
    projectId: "project-1",
    assigneeId: null as string | null,
    project: { companyId: COMPANY_A },
    ...overrides,
  };
}

const VALID_TASK_INPUT = {
  title: "Follow up call",
  description: "",
  status: "TODO" as const,
  priority: "MEDIUM" as const,
  dueDate: "",
  assigneeId: "",
};

function makeTaskNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "note-1",
    authorId: AUTHOR.id,
    taskId: "task-1",
    clientId: null,
    leadId: null,
    projectId: null,
    seoProjectId: null,
    contentId: null,
    body: "Original note body",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    task: { id: "task-1", projectId: "project-1", project: { companyId: COMPANY_A } },
    ...overrides,
  };
}

describe("updateTaskComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeTaskNote());
    mockedPrisma.note.update.mockResolvedValue(makeTaskNote({ body: "Updated body" }));
  });

  it("1. author successfully edits own note", async () => {
    const result = await updateTaskComment({ noteId: "note-1", body: "Updated body" });
    expect(result.success).toBe(true);
  });

  it("3. manager successfully edits another user's note", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await updateTaskComment({ noteId: "note-1", body: "By manager" });
    expect(result.success).toBe(true);
  });

  it("5. unauthorized employee cannot edit another user's note", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
    const result = await updateTaskComment({ noteId: "note-1", body: "Hijacked" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("21. the Task's own assignee (task.assigneeId) is NOT sufficient to edit someone else's note — only note.authorId or a manager", async () => {
    // Directly guards against the dual-ownership trap identified in the audit:
    // note authorization must use note.authorId, never task.assigneeId.
    mockedRequireUser.mockResolvedValue(TASK_ASSIGNEE_NOT_AUTHOR);
    const result = await updateTaskComment({ noteId: "note-1", body: "As assignee, not author" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("7. wrong-tenant note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeTaskNote({ task: { id: "task-1", projectId: "project-1", project: { companyId: COMPANY_B } } })
    );
    const result = await updateTaskComment({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("8. missing note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await updateTaskComment({ noteId: "missing", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
  });

  it("note with no Task relation is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeTaskNote({ taskId: null, task: null }));
    const result = await updateTaskComment({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
  });

  it("9. already-deleted note cannot be edited", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeTaskNote({ deletedAt: new Date() }));
    const result = await updateTaskComment({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/already been deleted/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("10. empty body is rejected", async () => {
    const result = await updateTaskComment({ noteId: "note-1", body: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/cannot be empty/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("11. whitespace-only body is rejected", async () => {
    const result = await updateTaskComment({ noteId: "note-1", body: "   " });
    expect(result.success).toBe(false);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("12. edit changes only body", async () => {
    await updateTaskComment({ noteId: "note-1", body: "  padded  " });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["body"]);
    expect(data.body).toBe("padded");
  });

  it("14. authorId remains unchanged (never included in the update)", async () => {
    await updateTaskComment({ noteId: "note-1", body: "Updated body" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("authorId");
  });

  it("15. taskId remains unchanged (never included in the update)", async () => {
    await updateTaskComment({ noteId: "note-1", body: "Updated body" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("taskId");
  });

  it("16. Activity action is correct, with projectId and taskId set", async () => {
    await updateTaskComment({ noteId: "note-1", body: "Updated body" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "task.comment_updated",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
      metadata: { noteId: "note-1" },
    });
  });

  it("17. Activity metadata is exactly { noteId }", async () => {
    await updateTaskComment({ noteId: "note-1", body: "Updated body" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(Object.keys(call.metadata)).toEqual(["noteId"]);
  });

  it("18. note body is not included in Activity metadata", async () => {
    await updateTaskComment({ noteId: "note-1", body: "Sensitive text that must not leak" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("19. correct revalidatePath is called", async () => {
    await updateTaskComment({ noteId: "note-1", body: "Updated body" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks/task-1");
  });
});

describe("deleteTaskComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeTaskNote());
    mockedPrisma.note.update.mockResolvedValue(makeTaskNote({ deletedAt: new Date() }));
  });

  it("2. author successfully deletes own note", async () => {
    const result = await deleteTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("4. manager successfully deletes another user's note", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await deleteTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("6. unauthorized employee cannot delete another user's note", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
    const result = await deleteTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("21b. the Task's own assignee is NOT sufficient to delete someone else's note", async () => {
    mockedRequireUser.mockResolvedValue(TASK_ASSIGNEE_NOT_AUTHOR);
    const result = await deleteTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("7b. wrong-tenant note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeTaskNote({ task: { id: "task-1", projectId: "project-1", project: { companyId: COMPANY_B } } })
    );
    const result = await deleteTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("8b. missing note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await deleteTaskComment({ noteId: "missing" });
    expect(result.success).toBe(false);
  });

  it("13. delete changes only deletedAt", async () => {
    await deleteTaskComment({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("14b. authorId remains unchanged (never included in the update)", async () => {
    await deleteTaskComment({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("authorId");
  });

  it("15b. taskId remains unchanged (never included in the update)", async () => {
    await deleteTaskComment({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("taskId");
  });

  it("16b. Activity action is correct, with projectId and taskId set", async () => {
    await deleteTaskComment({ noteId: "note-1" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "task.comment_deleted",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
      metadata: { noteId: "note-1" },
    });
  });

  it("17b. Activity metadata is exactly { noteId }", async () => {
    await deleteTaskComment({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(Object.keys(call.metadata)).toEqual(["noteId"]);
  });

  it("18b. note body is not included in Activity metadata", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeTaskNote({ body: "Sensitive text that must not leak" }));
    await deleteTaskComment({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("19b. correct revalidatePath is called", async () => {
    await deleteTaskComment({ noteId: "note-1" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks/task-1");
  });
});

describe("restoreTaskComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeTaskNote({ deletedAt: new Date("2026-02-01") }));
    mockedPrisma.note.update.mockResolvedValue(makeTaskNote({ deletedAt: null }));
  });

  it("author successfully restores own note", async () => {
    const result = await restoreTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("manager successfully restores another user's note", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await restoreTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("unauthorized employee cannot restore another user's note", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
    const result = await restoreTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("the Task's own assignee (task.assigneeId) is NOT sufficient to restore someone else's note — only note.authorId or a manager", async () => {
    mockedRequireUser.mockResolvedValue(TASK_ASSIGNEE_NOT_AUTHOR);
    const result = await restoreTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("wrong-tenant note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeTaskNote({ deletedAt: new Date(), task: { id: "task-1", projectId: "project-1", project: { companyId: COMPANY_B } } })
    );
    const result = await restoreTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("missing note is rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await restoreTaskComment({ noteId: "missing" });
    expect(result.success).toBe(false);
  });

  it("rejects restoring a note that isn't deleted", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeTaskNote({ deletedAt: null }));
    const result = await restoreTaskComment({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not deleted/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("restore changes only deletedAt, to null", async () => {
    await restoreTaskComment({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).toEqual({ deletedAt: null });
  });

  it("Activity action is correct, with projectId and taskId set", async () => {
    await restoreTaskComment({ noteId: "note-1" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "task.comment_restored",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
      metadata: { noteId: "note-1" },
    });
  });

  it("Activity metadata is exactly { noteId }", async () => {
    await restoreTaskComment({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(Object.keys(call.metadata)).toEqual(["noteId"]);
  });

  it("note body is not included in Activity metadata", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeTaskNote({ deletedAt: new Date(), body: "Sensitive text that must not leak" })
    );
    await restoreTaskComment({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("correct revalidatePath is called", async () => {
    await restoreTaskComment({ noteId: "note-1" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks/task-1");
  });
});

describe("createTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject());
    mockedPrisma.user.count.mockResolvedValue(1);
    mockedPrisma.task.create.mockResolvedValue({ id: "task-new", title: "Follow up call", assigneeId: null });
  });

  it("1. denies an EMPLOYEE without creating any Task", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await createTask("project-1", VALID_TASK_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to create tasks.");
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the Project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);
    const result = await createTask("project-1", VALID_TASK_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("3. rejects when the Project belongs to a different company", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject({ companyId: COMPANY_B }));
    const result = await createTask("project-1", VALID_TASK_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input via the real schema, without creating any Task", async () => {
    const result = await createTask("project-1", { ...VALID_TASK_INPUT, title: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Title must be at least 2 characters");
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("5. rejects an assignee from a different company, via the real validateAssignee query, without creating any Task", async () => {
    mockedPrisma.user.count.mockResolvedValue(0);
    const result = await createTask("project-1", { ...VALID_TASK_INPUT, assigneeId: "user-9" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Selected assignee is invalid.");
    expect(mockedPrisma.user.count).toHaveBeenCalledWith({ where: { id: "user-9", companyId: COMPANY_A } });
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("6. converts a provided dueDate string to a real Date", async () => {
    await createTask("project-1", { ...VALID_TASK_INPUT, dueDate: "2026-03-01" });
    const [{ data }] = mockedPrisma.task.create.mock.calls[0];
    expect(data.dueDate).toEqual(new Date("2026-03-01"));
  });

  it("7. stores a blank dueDate as null", async () => {
    await createTask("project-1", VALID_TASK_INPUT);
    const [{ data }] = mockedPrisma.task.create.mock.calls[0];
    expect(data.dueDate).toBeNull();
  });

  it("8. creates the Task with the exact field mapping and server-derived createdById", async () => {
    await createTask("project-1", VALID_TASK_INPUT);
    expect(mockedPrisma.task.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        createdById: MANAGER.id,
        title: "Follow up call",
        description: undefined,
        status: "TODO",
        priority: "MEDIUM",
        dueDate: null,
        assigneeId: null,
      },
    });
  });

  it("9. logs task.created with the exact actor/company/project/task ids and metadata", async () => {
    await createTask("project-1", VALID_TASK_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "task.created",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-new",
      metadata: { title: "Follow up call" },
    });
  });

  it("10. revalidates the task list and the project detail path", async () => {
    await createTask("project-1", VALID_TASK_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1");
  });

  it("11. returns the id of the newly created Task", async () => {
    const result = await createTask("project-1", VALID_TASK_INPUT);
    expect(result).toEqual({ success: true, data: { id: "task-new" } });
  });

  it("12. notifies the assignee when a different-user assignee is set", async () => {
    mockedPrisma.task.create.mockResolvedValue({ id: "task-new", title: "Follow up call", assigneeId: "user-9" });
    await createTask("project-1", { ...VALID_TASK_INPUT, assigneeId: "user-9" });
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "TASK_ASSIGNED",
      message: `${MANAGER.firstName} assigned you the task "Follow up call"`,
      link: "/projects/project-1/tasks/task-new",
    });
  });

  it("13. does not notify when the creator assigns the task to themselves", async () => {
    mockedPrisma.task.create.mockResolvedValue({ id: "task-new", title: "Follow up call", assigneeId: MANAGER.id });
    await createTask("project-1", { ...VALID_TASK_INPUT, assigneeId: MANAGER.id });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("14. does not notify when no assignee is set", async () => {
    await createTask("project-1", VALID_TASK_INPUT);
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});

describe("updateTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ assigneeId: "user-9" }));
    mockedPrisma.user.count.mockResolvedValue(1);
    mockedPrisma.task.update.mockResolvedValue({ id: "task-1", title: "Follow up call", assigneeId: "user-9" });
  });

  it("1. denies an EMPLOYEE without querying or mutating the Task", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "user-9" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to edit tasks.");
    expect(mockedPrisma.task.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Task does not exist", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(null);
    const result = await updateTask("task-1", VALID_TASK_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Task belongs to a different company", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ project: { companyId: COMPANY_B } }));
    const result = await updateTask("task-1", VALID_TASK_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input via the real schema, without mutating", async () => {
    const result = await updateTask("task-1", { ...VALID_TASK_INPUT, title: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Title must be at least 2 characters");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("4b. rejects an assignee from a different company via the real validateAssignee query, without mutating", async () => {
    mockedPrisma.user.count.mockResolvedValue(0);
    const result = await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "user-9" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Selected assignee is invalid.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("5. updates with the exact where clause and field mapping, converting dueDate to a real Date", async () => {
    await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "user-9", dueDate: "2026-03-01" });
    expect(mockedPrisma.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        title: "Follow up call",
        description: undefined,
        status: "TODO",
        priority: "MEDIUM",
        dueDate: new Date("2026-03-01"),
        assigneeId: "user-9",
      },
    });
  });

  it("6. does NOT notify when the assignee is unchanged", async () => {
    await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "user-9" });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("7. notifies exactly the new assignee when the assignee changes to a different user", async () => {
    mockedPrisma.task.update.mockResolvedValue({ id: "task-1", title: "Follow up call", assigneeId: "user-10" });
    await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "user-10" });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-10",
      type: "TASK_ASSIGNED",
      message: `${MANAGER.firstName} assigned you the task "Follow up call"`,
      link: "/projects/project-1/tasks/task-1",
    });
  });

  it("8. does NOT notify when the assignee changes to the acting user themselves", async () => {
    mockedPrisma.task.update.mockResolvedValue({ id: "task-1", title: "Follow up call", assigneeId: MANAGER.id });
    await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: MANAGER.id });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("9. does NOT notify when the assignee is cleared (changed to none)", async () => {
    mockedPrisma.task.update.mockResolvedValue({ id: "task-1", title: "Follow up call", assigneeId: null });
    await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "" });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("10. logs task.updated with the exact actor/company/project/task ids and metadata", async () => {
    await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "user-9" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "task.updated",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
      metadata: { title: "Follow up call" },
    });
  });

  it("11. revalidates the task list and the task detail path", async () => {
    await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "user-9" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks/task-1");
  });

  it("12. returns the id of the updated Task", async () => {
    const result = await updateTask("task-1", { ...VALID_TASK_INPUT, assigneeId: "user-9" });
    expect(result).toEqual({ success: true, data: { id: "task-1" } });
  });
});

describe("updateTaskStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ assigneeId: "user-9" }));
  });

  it("1. denies an EMPLOYEE who is neither a manager nor the task's own assignee", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await updateTaskStatus("task-1", "DONE");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to update this task.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("2. allows an EMPLOYEE who IS the task's own assignee (self-service carve-out)", async () => {
    mockedRequireUser.mockResolvedValue({ ...AUTHOR, id: "user-9" });
    const result = await updateTaskStatus("task-1", "DONE");
    expect(result.success).toBe(true);
  });

  it("3. allows a MANAGER regardless of assignment", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ assigneeId: "someone-else" }));
    const result = await updateTaskStatus("task-1", "DONE");
    expect(result.success).toBe(true);
  });

  it("4. rejects when the Task does not exist", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(null);
    const result = await updateTaskStatus("task-1", "DONE");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
  });

  it("5. rejects when the Task belongs to a different company", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ project: { companyId: COMPANY_B } }));
    const result = await updateTaskStatus("task-1", "DONE");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
  });

  it("6. rejects an invalid status via the real schema, without mutating", async () => {
    const result = await updateTaskStatus("task-1", "BOGUS");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Invalid status.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("7. [documents current behavior] mutates even when the target status equals the current status — there is no same-status no-op here", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ assigneeId: "user-9" }));
    await updateTaskStatus("task-1", "TODO");
    expect(mockedPrisma.task.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { status: "TODO" } });
    expect(mockedLogActivity).toHaveBeenCalled();
  });

  it("8. updates with the exact where clause and new status", async () => {
    await updateTaskStatus("task-1", "DONE");
    expect(mockedPrisma.task.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { status: "DONE" } });
  });

  it("9. logs task.status_changed with metadata containing only the new status", async () => {
    await updateTaskStatus("task-1", "DONE");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "task.status_changed",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
      metadata: { status: "DONE" },
    });
  });

  it("10. revalidates the task list and the task detail path", async () => {
    await updateTaskStatus("task-1", "DONE");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks/task-1");
  });

  it("11. returns a plain success result", async () => {
    const result = await updateTaskStatus("task-1", "DONE");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("archiveTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await archiveTask("task-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to archive tasks.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Task does not exist", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(null);
    const result = await archiveTask("task-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Task belongs to a different company", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ project: { companyId: COMPANY_B } }));
    const result = await archiveTask("task-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to a Date instance with the exact where clause", async () => {
    await archiveTask("task-1");
    const [{ where, data }] = mockedPrisma.task.update.mock.calls[0];
    expect(where).toEqual({ id: "task-1" });
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("5. logs task.archived with no metadata", async () => {
    await archiveTask("task-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "task.archived",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
    });
  });

  it("6. revalidates the task list", async () => {
    await archiveTask("task-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks");
  });

  it("7. returns a plain success result", async () => {
    const result = await archiveTask("task-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("restoreTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await restoreTask("task-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to restore tasks.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Task does not exist", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(null);
    const result = await restoreTask("task-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Task belongs to a different company", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ project: { companyId: COMPANY_B } }));
    const result = await restoreTask("task-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.task.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to exactly null with the exact where clause", async () => {
    await restoreTask("task-1");
    expect(mockedPrisma.task.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { deletedAt: null } });
  });

  it("5. logs task.restored with no metadata", async () => {
    await restoreTask("task-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "task.restored",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
    });
  });

  it("6. revalidates the task list", async () => {
    await restoreTask("task-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks");
  });

  it("7. returns a plain success result", async () => {
    const result = await restoreTask("task-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("addTaskComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject());
    mockedPrisma.note.create.mockResolvedValue({ id: "note-new" });
    mockedPrisma.user.findMany.mockResolvedValue([]);
  });

  it("1. rejects when the Task does not exist", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(null);
    const result = await addTaskComment("task-1", "A comment");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the Task belongs to a different company", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ project: { companyId: COMPANY_B } }));
    const result = await addTaskComment("task-1", "A comment");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("3. rejects a whitespace-only body without creating a note", async () => {
    const result = await addTaskComment("task-1", "    ");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Comment cannot be empty.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("4. succeeds for a plain EMPLOYEE (no role gate — self-service)", async () => {
    const result = await addTaskComment("task-1", "A comment");
    expect(result.success).toBe(true);
  });

  it("5. creates the note with the trimmed body and the actor/task association", async () => {
    await addTaskComment("task-1", "  padded comment  ");
    expect(mockedPrisma.note.create).toHaveBeenCalledWith({
      data: { authorId: AUTHOR.id, taskId: "task-1", body: "padded comment" },
    });
  });

  it("6. logs task.comment_added with no metadata", async () => {
    await addTaskComment("task-1", "A comment");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "task.comment_added",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
    });
  });

  it("7. revalidates the task detail path", async () => {
    await addTaskComment("task-1", "A comment");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks/task-1");
  });

  it("8. zero mentions in the body sends zero notifications", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addTaskComment("task-1", "No mentions here");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("9. one real @mention sends exactly one notification to the matched company member", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addTaskComment("task-1", "Great work @Sam");
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_A, deletedAt: null },
      select: { id: true, firstName: true },
    });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "COMMENT_MENTION",
      message: `${AUTHOR.firstName} mentioned you in a task comment`,
      link: "/projects/project-1/tasks/task-1",
    });
  });

  it("10. multiple @mentions send exactly one notification per mentioned user, to the correct recipients", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "user-9", firstName: "Sam" },
      { id: "user-10", firstName: "Jordan" },
    ]);
    await addTaskComment("task-1", "cc @Sam and @Jordan");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    const recipients = mockedCreateNotification.mock.calls.map((call: unknown[]) => (call[0] as { userId: string }).userId);
    expect(recipients.sort()).toEqual(["user-10", "user-9"]);
  });

  it("11. never notifies the author for a self-mention", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: AUTHOR.id, firstName: "Alex" }]);
    await addTaskComment("task-1", "Reminding myself @Alex");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("12. sends no notifications when the request is rejected", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(null);
    await addTaskComment("task-1", "Great work @Sam");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});

describe("createSubtask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject());
    mockedPrisma.task.create.mockResolvedValue({ id: "subtask-99", title: "Sub-step" });
  });

  it("1. denies an EMPLOYEE without creating any subtask", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await createSubtask("task-1", "Sub-step");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to create subtasks.");
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the parent Task does not exist", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(null);
    const result = await createSubtask("task-1", "Sub-step");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("3. rejects when the parent Task belongs to a different company", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ project: { companyId: COMPANY_B } }));
    const result = await createSubtask("task-1", "Sub-step");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("4. rejects an invalid title via the real schema, without creating any subtask", async () => {
    const result = await createSubtask("task-1", "A");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Title must be at least 2 characters");
    expect(mockedPrisma.task.create).not.toHaveBeenCalled();
  });

  it("5. creates the subtask under the PARENT task's own projectId, with parentTaskId set", async () => {
    mockedPrisma.task.findUnique.mockResolvedValue(makeTaskWithProject({ projectId: "project-77" }));
    await createSubtask("task-1", "Sub-step");
    expect(mockedPrisma.task.create).toHaveBeenCalledWith({
      data: { projectId: "project-77", parentTaskId: "task-1", createdById: MANAGER.id, title: "Sub-step" },
    });
  });

  it("6. attributes the activity's own taskId to the PARENT, and the new subtask's id only to metadata.subtaskId — never swapped", async () => {
    await createSubtask("task-1", "Sub-step");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "task.subtask_created",
      companyId: COMPANY_A,
      projectId: "project-1",
      taskId: "task-1",
      metadata: { subtaskId: "subtask-99", title: "Sub-step" },
    });
  });

  it("7. revalidates the PARENT task's own detail path, not the subtask's", async () => {
    await createSubtask("task-1", "Sub-step");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1/tasks/task-1");
  });

  it("8. returns the id of the newly created subtask", async () => {
    const result = await createSubtask("task-1", "Sub-step");
    expect(result).toEqual({ success: true, data: { id: "subtask-99" } });
  });
});
