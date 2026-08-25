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
import { prisma } from "@/lib/prisma";
import { deleteLeadNote, updateLeadNote } from "@/features/leads/actions/lead.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
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
    leadId: "lead-1",
    clientId: null,
    contactId: null,
    projectId: null,
    taskId: null,
    seoProjectId: null,
    contentId: null,
    body: "Original note body",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    lead: { id: "lead-1", companyId: COMPANY_A },
    ...overrides,
  };
}

describe("updateLeadNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote());
    mockedPrisma.note.update.mockResolvedValue(makeNote({ body: "Updated body" }));
  });

  describe("1. successful edit by note author", () => {
    it("succeeds and updates the body", async () => {
      const result = await updateLeadNote({ noteId: "note-1", body: "Updated body" });
      expect(result.success).toBe(true);
      expect(mockedPrisma.note.update).toHaveBeenCalledWith({ where: { id: "note-1" }, data: { body: "Updated body" } });
    });
  });

  describe("2. successful edit by manager on someone else's note", () => {
    it("succeeds when the actor is a manager, not the author", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await updateLeadNote({ noteId: "note-1", body: "Manager edit" });
      expect(result.success).toBe(true);
    });
  });

  describe("3. unauthorized edit by non-author/non-manager employee", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages leads", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await updateLeadNote({ noteId: "note-1", body: "Hijacked" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("4. cross-tenant edit rejection", () => {
    it("rejects when the note's lead belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ lead: { id: "lead-1", companyId: COMPANY_B } }));
      const result = await updateLeadNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("5. nonexistent note rejection", () => {
    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await updateLeadNote({ noteId: "missing", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
    });

    it("rejects when the note doesn't belong to a Lead at all", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ leadId: null, lead: null }));
      const result = await updateLeadNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
    });
  });

  describe("6. already-deleted note edit rejection", () => {
    it("rejects editing a note whose deletedAt is already set", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: new Date() }));
      const result = await updateLeadNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/already been deleted/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("12. edit update data contains ONLY { body }", () => {
    it("never includes deletedAt, authorId, or leadId in the update data", async () => {
      await updateLeadNote({ noteId: "note-1", body: "Updated body" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(Object.keys(data)).toEqual(["body"]);
    });

    it("trims the body before saving", async () => {
      await updateLeadNote({ noteId: "note-1", body: "  padded  " });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data.body).toBe("padded");
    });
  });

  describe("14. Activity action/reference/metadata for edit", () => {
    it("logs lead.note_updated with leadId and metadata: { noteId } only", async () => {
      await updateLeadNote({ noteId: "note-1", body: "Updated body" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "lead.note_updated",
        companyId: COMPANY_A,
        leadId: "lead-1",
        metadata: { noteId: "note-1" },
      });
    });

    it("never logs the note body in Activity metadata", async () => {
      await updateLeadNote({ noteId: "note-1", body: "Sensitive text that must not leak" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("16. existing note relationships remain untouched by the mutation", () => {
    it("never includes clientId/projectId/taskId/seoProjectId/contentId/authorId in the update data", async () => {
      await updateLeadNote({ noteId: "note-1", body: "Updated body" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data).not.toHaveProperty("authorId");
      expect(data).not.toHaveProperty("leadId");
      expect(data).not.toHaveProperty("clientId");
      expect(data).not.toHaveProperty("createdAt");
    });
  });
});

describe("deleteLeadNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote());
    mockedPrisma.note.update.mockResolvedValue(makeNote({ deletedAt: new Date() }));
  });

  describe("7. successful soft-delete by note author", () => {
    it("succeeds for the author", async () => {
      const result = await deleteLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("8. successful soft-delete by manager", () => {
    it("succeeds for a manager on someone else's note", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await deleteLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("9. unauthorized delete", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages leads", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await deleteLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("10. cross-tenant delete rejection", () => {
    it("rejects when the note's lead belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ lead: { id: "lead-1", companyId: COMPANY_B } }));
      const result = await deleteLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });

    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await deleteLeadNote({ noteId: "missing" });
      expect(result.success).toBe(false);
    });
  });

  describe("11. delete sets deletedAt", () => {
    it("sets deletedAt to a Date instance", async () => {
      await deleteLeadNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("13. delete update data contains ONLY { deletedAt }", () => {
    it("never includes body, authorId, or leadId in the update data", async () => {
      await deleteLeadNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(Object.keys(data)).toEqual(["deletedAt"]);
    });
  });

  describe("15. Activity action/reference/metadata for delete", () => {
    it("logs lead.note_deleted with leadId and metadata: { noteId } only", async () => {
      await deleteLeadNote({ noteId: "note-1" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "lead.note_deleted",
        companyId: COMPANY_A,
        leadId: "lead-1",
        metadata: { noteId: "note-1" },
      });
    });

    it("never logs the note body in Activity metadata", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ body: "Sensitive text that must not leak" }));
      await deleteLeadNote({ noteId: "note-1" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("16. existing note relationships remain untouched by the mutation", () => {
    it("never includes authorId/leadId/other relations in the update data", async () => {
      await deleteLeadNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data).not.toHaveProperty("authorId");
      expect(data).not.toHaveProperty("leadId");
      expect(data).not.toHaveProperty("body");
    });
  });
});
