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
import { deleteProjectNote, updateProjectNote } from "@/features/projects/actions/project.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidatePath = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const AUTHOR = { id: "user-1", role: "EMPLOYEE", companyId: COMPANY_A };
const OTHER_EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };
const MANAGER = { id: "user-3", role: "MANAGER", companyId: COMPANY_A };

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
