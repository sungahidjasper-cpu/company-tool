import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  note: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    note: { findUnique: vi.fn(), update: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { deleteTaskComment, restoreTaskComment, updateTaskComment } from "@/features/tasks/actions/task.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidatePath = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const AUTHOR = { id: "note-author-1", role: "EMPLOYEE", companyId: COMPANY_A };
const OTHER_EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };
// This EMPLOYEE is the Task's own assignee — distinct from the note's author.
// Used to prove note authorization uses note.authorId, never task.assigneeId.
const TASK_ASSIGNEE_NOT_AUTHOR = { id: "user-assignee", role: "EMPLOYEE", companyId: COMPANY_A };
const MANAGER = { id: "user-3", role: "MANAGER", companyId: COMPANY_A };

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
