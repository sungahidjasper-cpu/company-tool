import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/notifications/services/notification.service", () => ({ createNotification: vi.fn() }));

type MockPrisma = {
  note: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  project: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  client: { findUnique: ReturnType<typeof vi.fn> };
  user: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    note: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    project: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    client: { findUnique: vi.fn() },
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
  deleteProjectNote,
  restoreProjectNote,
  updateProjectNote,
  createProject,
  updateProject,
  archiveProject,
  restoreProject,
  addProjectNote,
} from "@/features/projects/actions/project.actions";
import type { ProjectInput } from "@/features/projects/schemas/project.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidatePath = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedCreateNotification = createNotification as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const AUTHOR = { id: "user-1", role: "EMPLOYEE", companyId: COMPANY_A, firstName: "Alex" };
const OTHER_EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A, firstName: "Sam" };
const MANAGER = { id: "user-3", role: "MANAGER", companyId: COMPANY_A, firstName: "Morgan" };

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "project-1", companyId: COMPANY_A, name: "Website Revamp", ownerId: null as string | null, ...overrides };
}

const VALID_PROJECT_INPUT: ProjectInput = {
  name: "Website Revamp",
  description: "",
  status: "PLANNING",
  priority: "MEDIUM",
  startDate: "",
  dueDate: "",
  clientId: "",
  ownerId: "",
  assignedUserIds: [],
};

function makeNote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "note-1",
    authorId: AUTHOR.id,
    projectId: "project-1",
    clientId: null,
    leadId: null,
    taskId: null,
    seoProjectId: null,
    contentId: null,
    body: "Original note body",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    project: { id: "project-1", companyId: COMPANY_A },
    ...overrides,
  };
}

describe("updateProjectNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote());
    mockedPrisma.note.update.mockResolvedValue(makeNote({ body: "Updated body" }));
  });

  describe("1. successful note edit", () => {
    it("succeeds for the author", async () => {
      const result = await updateProjectNote({ noteId: "note-1", body: "Updated body" });
      expect(result.success).toBe(true);
    });
  });

  describe("3. exact update shape { body }", () => {
    it("updates only body — no other field", async () => {
      await updateProjectNote({ noteId: "note-1", body: "Updated body" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(Object.keys(data)).toEqual(["body"]);
    });

    it("trims the body before saving", async () => {
      await updateProjectNote({ noteId: "note-1", body: "  padded  " });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data.body).toBe("padded");
    });
  });

  describe("5. deleted note cannot be edited", () => {
    it("rejects editing a note whose deletedAt is already set", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: new Date() }));
      const result = await updateProjectNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/already been deleted/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("6. author can edit", () => {
    it("allows the note's own author", async () => {
      const result = await updateProjectNote({ noteId: "note-1", body: "By author" });
      expect(result.success).toBe(true);
    });
  });

  describe("8. manager can edit another user's note", () => {
    it("allows a manager even when not the author", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await updateProjectNote({ noteId: "note-1", body: "By manager" });
      expect(result.success).toBe(true);
    });
  });

  describe("10. non-author/non-manager is rejected", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages projects", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await updateProjectNote({ noteId: "note-1", body: "Hijacked" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("11. missing note rejected", () => {
    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await updateProjectNote({ noteId: "missing", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
    });
  });

  describe("12. cross-tenant note rejected", () => {
    it("rejects when the note's project belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ project: { id: "project-1", companyId: COMPANY_B } }));
      const result = await updateProjectNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("13. note with no Project relation rejected", () => {
    it("rejects when the note isn't attached to a Project at all", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ projectId: null, project: null }));
      const result = await updateProjectNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
    });
  });

  describe("14. empty body / whitespace-only body rejected", () => {
    it("rejects an empty body", async () => {
      const result = await updateProjectNote({ noteId: "note-1", body: "" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/cannot be empty/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });

    it("rejects a whitespace-only body", async () => {
      const result = await updateProjectNote({ noteId: "note-1", body: "   " });
      expect(result.success).toBe(false);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("15. Activity action and metadata are correct", () => {
    it("logs project.note_updated with projectId and metadata: { noteId } only", async () => {
      await updateProjectNote({ noteId: "note-1", body: "Updated body" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "project.note_updated",
        companyId: COMPANY_A,
        projectId: "project-1",
        metadata: { noteId: "note-1" },
      });
    });
  });

  describe("16. no note body is placed in Activity metadata", () => {
    it("never logs the note body", async () => {
      await updateProjectNote({ noteId: "note-1", body: "Sensitive text that must not leak" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("17. correct revalidatePath is called for edit", () => {
    it("revalidates the project detail path", async () => {
      await updateProjectNote({ noteId: "note-1", body: "Updated body" });
      expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1");
    });
  });
});

describe("deleteProjectNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote());
    mockedPrisma.note.update.mockResolvedValue(makeNote({ deletedAt: new Date() }));
  });

  describe("2. successful note delete", () => {
    it("succeeds for the author", async () => {
      const result = await deleteProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("4. exact delete shape { deletedAt }", () => {
    it("updates only deletedAt — no other field", async () => {
      await deleteProjectNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(Object.keys(data)).toEqual(["deletedAt"]);
    });

    it("sets deletedAt to a Date instance", async () => {
      await deleteProjectNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("7. author can delete", () => {
    it("allows the note's own author", async () => {
      const result = await deleteProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("9. manager can delete another user's note", () => {
    it("allows a manager even when not the author", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await deleteProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("10b. non-author/non-manager delete is rejected", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages projects", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await deleteProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("11b. missing note rejected", () => {
    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await deleteProjectNote({ noteId: "missing" });
      expect(result.success).toBe(false);
    });
  });

  describe("12b. cross-tenant delete rejected", () => {
    it("rejects when the note's project belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ project: { id: "project-1", companyId: COMPANY_B } }));
      const result = await deleteProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("15b. Activity action and metadata are correct", () => {
    it("logs project.note_deleted with projectId and metadata: { noteId } only", async () => {
      await deleteProjectNote({ noteId: "note-1" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "project.note_deleted",
        companyId: COMPANY_A,
        projectId: "project-1",
        metadata: { noteId: "note-1" },
      });
    });
  });

  describe("16b. no note body is placed in Activity metadata", () => {
    it("never logs the note body", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ body: "Sensitive text that must not leak" }));
      await deleteProjectNote({ noteId: "note-1" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("18. correct revalidatePath is called for delete", () => {
    it("revalidates the project detail path", async () => {
      await deleteProjectNote({ noteId: "note-1" });
      expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1");
    });
  });
});

describe("restoreProjectNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: new Date("2026-02-01") }));
    mockedPrisma.note.update.mockResolvedValue(makeNote({ deletedAt: null }));
  });

  describe("1. successful restore by note author", () => {
    it("succeeds for the author", async () => {
      const result = await restoreProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("2. successful restore by manager", () => {
    it("succeeds for a manager on someone else's note", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await restoreProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("3. unauthorized restore", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages projects", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await restoreProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("4. cross-tenant restore rejection", () => {
    it("rejects when the note's project belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(
        makeNote({ deletedAt: new Date(), project: { id: "project-1", companyId: COMPANY_B } })
      );
      const result = await restoreProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });

    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await restoreProjectNote({ noteId: "missing" });
      expect(result.success).toBe(false);
    });
  });

  describe("5. rejects restoring a note that isn't deleted", () => {
    it("returns an error when deletedAt is already null", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: null }));
      const result = await restoreProjectNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/not deleted/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("6. restore sets deletedAt to null, nothing else", () => {
    it("update data is exactly { deletedAt: null }", async () => {
      await restoreProjectNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data).toEqual({ deletedAt: null });
    });
  });

  describe("7. Activity action/reference/metadata for restore", () => {
    it("logs project.note_restored with projectId and metadata: { noteId } only", async () => {
      await restoreProjectNote({ noteId: "note-1" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "project.note_restored",
        companyId: COMPANY_A,
        projectId: "project-1",
        metadata: { noteId: "note-1" },
      });
    });

    it("never logs the note body in Activity metadata", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(
        makeNote({ deletedAt: new Date(), body: "Sensitive text that must not leak" })
      );
      await restoreProjectNote({ noteId: "note-1" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("8. correct revalidatePath is called", () => {
    it("revalidates the project detail path", async () => {
      await restoreProjectNote({ noteId: "note-1" });
      expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1");
    });
  });
});

describe("createProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.project.create.mockResolvedValue({ id: "project-new", name: "Website Revamp" });
  });

  it("1. denies an EMPLOYEE without creating any Project", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await createProject(VALID_PROJECT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to create projects.");
    expect(mockedPrisma.project.create).not.toHaveBeenCalled();
  });

  it("2. succeeds for a MANAGER", async () => {
    const result = await createProject(VALID_PROJECT_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. rejects invalid input via the real schema, without creating any Project", async () => {
    const result = await createProject({ ...VALID_PROJECT_INPUT, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Name must be at least 2 characters");
    expect(mockedPrisma.project.create).not.toHaveBeenCalled();
  });

  it("4. no clientId skips the client ownership query entirely", async () => {
    await createProject(VALID_PROJECT_INPUT);
    expect(mockedPrisma.client.findUnique).not.toHaveBeenCalled();
  });

  it("5. accepts a valid same-company clientId", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({ id: "client-1", companyId: COMPANY_A });
    const result = await createProject({ ...VALID_PROJECT_INPUT, clientId: "client-1" });
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.project.create.mock.calls[0];
    expect(data.clientId).toBe("client-1");
  });

  it("6. rejects a cross-company clientId, without creating any Project", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({ id: "client-1", companyId: COMPANY_B });
    const result = await createProject({ ...VALID_PROJECT_INPUT, clientId: "client-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Selected client is invalid.");
    expect(mockedPrisma.project.create).not.toHaveBeenCalled();
  });

  it("7. rejects a missing clientId (found: null), without creating any Project", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(null);
    const result = await createProject({ ...VALID_PROJECT_INPUT, clientId: "client-missing" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Selected client is invalid.");
    expect(mockedPrisma.project.create).not.toHaveBeenCalled();
  });

  it("8. accepts a valid ownerId, querying the real user-reference count", async () => {
    mockedPrisma.user.count.mockResolvedValue(1);
    const result = await createProject({ ...VALID_PROJECT_INPUT, ownerId: "user-9" });
    expect(result.success).toBe(true);
    expect(mockedPrisma.user.count).toHaveBeenCalledWith({ where: { id: { in: ["user-9"] }, companyId: COMPANY_A } });
  });

  it("9. accepts multiple valid assignedUserIds", async () => {
    mockedPrisma.user.count.mockResolvedValue(2);
    const result = await createProject({ ...VALID_PROJECT_INPUT, assignedUserIds: ["user-9", "user-10"] });
    expect(result.success).toBe(true);
    expect(mockedPrisma.user.count).toHaveBeenCalledWith({ where: { id: { in: ["user-9", "user-10"] }, companyId: COMPANY_A } });
  });

  it("10. [CRITICAL] rejects when one id among several assignedUserIds is invalid, without creating any Project", async () => {
    mockedPrisma.user.count.mockResolvedValue(1);
    const result = await createProject({ ...VALID_PROJECT_INPUT, assignedUserIds: ["user-9", "user-invalid"] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("One or more selected users are invalid.");
    expect(mockedPrisma.project.create).not.toHaveBeenCalled();
  });

  it("11. [CRITICAL] duplicate user ids across ownerId/assignedUserIds are deduplicated via Set before the count query — a duplicated valid id does not falsely reject", async () => {
    mockedPrisma.user.count.mockResolvedValue(2);
    const result = await createProject({ ...VALID_PROJECT_INPUT, ownerId: "user-9", assignedUserIds: ["user-9", "user-10"] });
    expect(result.success).toBe(true);
    expect(mockedPrisma.user.count).toHaveBeenCalledWith({ where: { id: { in: ["user-9", "user-10"] }, companyId: COMPANY_A } });
  });

  it("12. an empty ownerId and empty assignedUserIds skip the user-reference query entirely", async () => {
    const result = await createProject(VALID_PROJECT_INPUT);
    expect(result.success).toBe(true);
    expect(mockedPrisma.user.count).not.toHaveBeenCalled();
  });

  it("13. creates the Project with the exact field mapping and assignedUsers: { connect: [...] }", async () => {
    mockedPrisma.user.count.mockResolvedValue(3);
    await createProject({ ...VALID_PROJECT_INPUT, ownerId: "user-9", assignedUserIds: ["user-10", "user-11"] });
    expect(mockedPrisma.project.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_A,
        name: "Website Revamp",
        description: undefined,
        status: "PLANNING",
        priority: "MEDIUM",
        startDate: null,
        dueDate: null,
        clientId: null,
        ownerId: "user-9",
        assignedUsers: { connect: [{ id: "user-10" }, { id: "user-11" }] },
      },
    });
  });

  it("14. converts provided startDate/dueDate strings to real Dates", async () => {
    await createProject({ ...VALID_PROJECT_INPUT, startDate: "2026-03-01", dueDate: "2026-04-01" });
    const [{ data }] = mockedPrisma.project.create.mock.calls[0];
    expect(data.startDate).toEqual(new Date("2026-03-01"));
    expect(data.dueDate).toEqual(new Date("2026-04-01"));
  });

  it("15. logs project.created with the exact actor/company/project ids and metadata", async () => {
    await createProject(VALID_PROJECT_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "project.created",
      companyId: COMPANY_A,
      projectId: "project-new",
      metadata: { name: "Website Revamp" },
    });
  });

  it("16. revalidates the project list", async () => {
    await createProject(VALID_PROJECT_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects");
  });

  it("17. returns the id of the newly created Project", async () => {
    const result = await createProject(VALID_PROJECT_INPUT);
    expect(result).toEqual({ success: true, data: { id: "project-new" } });
  });

  it("18. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await createProject(VALID_PROJECT_INPUT);
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject());
    mockedPrisma.project.update.mockResolvedValue({ id: "project-1", name: "Website Revamp", ownerId: null });
  });

  it("1. denies an EMPLOYEE without querying or mutating the Project", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to edit projects.");
    expect(mockedPrisma.project.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);
    const result = await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Project belongs to a different company", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject({ companyId: COMPANY_B }));
    const result = await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input via the real schema, without mutating", async () => {
    const result = await updateProject("project-1", { ...VALID_PROJECT_INPUT, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Name must be at least 2 characters");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("5. accepts a valid same-company clientId", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({ id: "client-1", companyId: COMPANY_A });
    const result = await updateProject("project-1", { ...VALID_PROJECT_INPUT, clientId: "client-1" });
    expect(result.success).toBe(true);
  });

  it("6. rejects a cross-company clientId, without mutating", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue({ id: "client-1", companyId: COMPANY_B });
    const result = await updateProject("project-1", { ...VALID_PROJECT_INPUT, clientId: "client-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Selected client is invalid.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("7. [CRITICAL] rejects when one id among several assignedUserIds is invalid, without mutating", async () => {
    mockedPrisma.user.count.mockResolvedValue(1);
    const result = await updateProject("project-1", { ...VALID_PROJECT_INPUT, assignedUserIds: ["user-9", "user-invalid"] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("One or more selected users are invalid.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("8. [CRITICAL] duplicate ids across ownerId/assignedUserIds are deduplicated and do not falsely reject", async () => {
    mockedPrisma.user.count.mockResolvedValue(2);
    const result = await updateProject("project-1", { ...VALID_PROJECT_INPUT, ownerId: "user-9", assignedUserIds: ["user-9", "user-10"] });
    expect(result.success).toBe(true);
    expect(mockedPrisma.user.count).toHaveBeenCalledWith({ where: { id: { in: ["user-9", "user-10"] }, companyId: COMPANY_A } });
  });

  it("9. [CRITICAL] updates assignedUsers with { set: [...] }, never { connect: [...] }", async () => {
    mockedPrisma.user.count.mockResolvedValue(2);
    await updateProject("project-1", { ...VALID_PROJECT_INPUT, assignedUserIds: ["user-9", "user-10"] });
    const [{ data }] = mockedPrisma.project.update.mock.calls[0];
    expect(data.assignedUsers).toEqual({ set: [{ id: "user-9" }, { id: "user-10" }] });
    expect(data.assignedUsers).not.toHaveProperty("connect");
  });

  it("10. updates with the exact where clause and full field mapping", async () => {
    mockedPrisma.user.count.mockResolvedValue(1);
    await updateProject("project-1", { ...VALID_PROJECT_INPUT, ownerId: "user-9", assignedUserIds: [] });
    expect(mockedPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        name: "Website Revamp",
        description: undefined,
        status: "PLANNING",
        priority: "MEDIUM",
        startDate: null,
        dueDate: null,
        clientId: null,
        ownerId: "user-9",
        assignedUsers: { set: [] },
      },
    });
  });

  it("11. logs project.updated with the exact actor/company/project ids and metadata", async () => {
    await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "project.updated",
      companyId: COMPANY_A,
      projectId: "project-1",
      metadata: { name: "Website Revamp" },
    });
  });

  it("12. notifies the resolved owner when different from the acting user", async () => {
    mockedPrisma.project.update.mockResolvedValue({ id: "project-1", name: "Website Revamp", ownerId: "user-9" });
    await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "PROJECT_UPDATE",
      message: `${MANAGER.firstName} updated the project "Website Revamp"`,
      link: "/projects/project-1",
    });
  });

  it("13. notifies every assigned user from the input, not from the resolved return value", async () => {
    mockedPrisma.user.count.mockResolvedValue(2);
    await updateProject("project-1", { ...VALID_PROJECT_INPUT, assignedUserIds: ["user-10", "user-11"] });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    const recipients = mockedCreateNotification.mock.calls.map((call: unknown[]) => (call[0] as { userId: string }).userId);
    expect(recipients.sort()).toEqual(["user-10", "user-11"]);
  });

  it("14. [CRITICAL] never notifies the acting user, even when they are the resolved owner", async () => {
    mockedPrisma.project.update.mockResolvedValue({ id: "project-1", name: "Website Revamp", ownerId: MANAGER.id });
    await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("15. [CRITICAL] never notifies the acting user, even when they are one of the assigned users", async () => {
    mockedPrisma.user.count.mockResolvedValue(1);
    await updateProject("project-1", { ...VALID_PROJECT_INPUT, assignedUserIds: [MANAGER.id] });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("16. [CRITICAL] the same stakeholder as both owner and assignee is notified exactly once, not twice", async () => {
    mockedPrisma.user.count.mockResolvedValue(1);
    mockedPrisma.project.update.mockResolvedValue({ id: "project-1", name: "Website Revamp", ownerId: "user-9" });
    await updateProject("project-1", { ...VALID_PROJECT_INPUT, assignedUserIds: ["user-9"] });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-9" }));
  });

  it("17. sends zero notifications when there is no owner and no assigned users", async () => {
    await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("18. revalidates the project list and the project detail path", async () => {
    await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1");
  });

  it("19. returns the id of the updated Project", async () => {
    const result = await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(result).toEqual({ success: true, data: { id: "project-1" } });
  });

  it("20. rejected requests never mutate, notify, log activity, or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await updateProject("project-1", VALID_PROJECT_INPUT);
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("archiveProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await archiveProject("project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to archive projects.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);
    const result = await archiveProject("project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Project belongs to a different company", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject({ companyId: COMPANY_B }));
    const result = await archiveProject("project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to a Date instance with the exact where clause", async () => {
    await archiveProject("project-1");
    const [{ where, data }] = mockedPrisma.project.update.mock.calls[0];
    expect(where).toEqual({ id: "project-1" });
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("5. logs project.archived with no metadata", async () => {
    await archiveProject("project-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "project.archived",
      companyId: COMPANY_A,
      projectId: "project-1",
    });
  });

  it("6. revalidates the project list", async () => {
    await archiveProject("project-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects");
  });

  it("7. returns a plain success result", async () => {
    const result = await archiveProject("project-1");
    expect(result).toEqual({ success: true, data: undefined });
  });

  it("8. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await archiveProject("project-1");
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("restoreProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await restoreProject("project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to restore projects.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);
    const result = await restoreProject("project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Project belongs to a different company", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject({ companyId: COMPANY_B }));
    const result = await restoreProject("project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.project.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to exactly null with the exact where clause", async () => {
    await restoreProject("project-1");
    expect(mockedPrisma.project.update).toHaveBeenCalledWith({ where: { id: "project-1" }, data: { deletedAt: null } });
  });

  it("5. logs project.restored with no metadata", async () => {
    await restoreProject("project-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "project.restored",
      companyId: COMPANY_A,
      projectId: "project-1",
    });
  });

  it("6. revalidates the project list", async () => {
    await restoreProject("project-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects");
  });

  it("7. returns a plain success result", async () => {
    const result = await restoreProject("project-1");
    expect(result).toEqual({ success: true, data: undefined });
  });

  it("8. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await restoreProject("project-1");
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("addProjectNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject({ name: "Website Revamp" }));
    mockedPrisma.note.create.mockResolvedValue({ id: "note-new" });
    mockedPrisma.user.findMany.mockResolvedValue([]);
  });

  it("1. rejects when the Project does not exist", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);
    const result = await addProjectNote("project-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the Project belongs to a different company", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(makeProject({ companyId: COMPANY_B }));
    const result = await addProjectNote("project-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Project not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("3. rejects a whitespace-only body without creating a note", async () => {
    const result = await addProjectNote("project-1", "    ");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note cannot be empty.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("4. succeeds for a plain EMPLOYEE (no role gate — self-service)", async () => {
    const result = await addProjectNote("project-1", "A note");
    expect(result.success).toBe(true);
  });

  it("5. creates the note with the trimmed body and the actor/project association", async () => {
    await addProjectNote("project-1", "  padded note  ");
    expect(mockedPrisma.note.create).toHaveBeenCalledWith({
      data: { authorId: AUTHOR.id, projectId: "project-1", body: "padded note" },
    });
  });

  it("6. logs project.note_added with no metadata", async () => {
    await addProjectNote("project-1", "A note");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "project.note_added",
      companyId: COMPANY_A,
      projectId: "project-1",
    });
  });

  it("7. revalidates only the project detail path", async () => {
    await addProjectNote("project-1", "A note");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/projects/project-1");
  });

  it("8. zero mentions in the body sends zero notifications", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addProjectNote("project-1", "No mentions here");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("9. one real @mention sends exactly one notification, matching the exact production message (unquoted project name)", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addProjectNote("project-1", "Great work @Sam");
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_A, deletedAt: null },
      select: { id: true, firstName: true },
    });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "COMMENT_MENTION",
      message: `${AUTHOR.firstName} mentioned you in a note on Website Revamp`,
      link: "/projects/project-1",
    });
  });

  it("10. multiple @mentions send exactly one notification per mentioned user, to the correct recipients", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "user-9", firstName: "Sam" },
      { id: "user-10", firstName: "Jordan" },
    ]);
    await addProjectNote("project-1", "cc @Sam and @Jordan");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    const recipients = mockedCreateNotification.mock.calls.map((call: unknown[]) => (call[0] as { userId: string }).userId);
    expect(recipients.sort()).toEqual(["user-10", "user-9"]);
  });

  it("11. never notifies the author for a self-mention", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: AUTHOR.id, firstName: "Alex" }]);
    await addProjectNote("project-1", "Reminding myself @Alex");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("12. sends no notifications when the request is rejected", async () => {
    mockedPrisma.project.findUnique.mockResolvedValue(null);
    await addProjectNote("project-1", "Great work @Sam");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});
