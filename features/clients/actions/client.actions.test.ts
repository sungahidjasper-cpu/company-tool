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
import { deleteClientNote, restoreClientNote, updateClientNote } from "@/features/clients/actions/client.actions";

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
    clientId: "client-1",
    leadId: null,
    projectId: null,
    taskId: null,
    seoProjectId: null,
    contentId: null,
    body: "Original note body",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    client: { id: "client-1", companyId: COMPANY_A },
    ...overrides,
  };
}

describe("updateClientNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote());
    mockedPrisma.note.update.mockResolvedValue(makeNote({ body: "Updated body" }));
  });

  describe("1. successful note edit", () => {
    it("succeeds for the author", async () => {
      const result = await updateClientNote({ noteId: "note-1", body: "Updated body" });
      expect(result.success).toBe(true);
    });
  });

  describe("3. edit updates exactly { body }", () => {
    it("updates only body — no other field", async () => {
      await updateClientNote({ noteId: "note-1", body: "Updated body" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(Object.keys(data)).toEqual(["body"]);
    });

    it("trims the body before saving", async () => {
      await updateClientNote({ noteId: "note-1", body: "  padded  " });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data.body).toBe("padded");
    });
  });

  describe("5. deleted note cannot be edited", () => {
    it("rejects editing a note whose deletedAt is already set", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: new Date() }));
      const result = await updateClientNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/already been deleted/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("6. author can edit own note", () => {
    it("allows the note's own author", async () => {
      const result = await updateClientNote({ noteId: "note-1", body: "By author" });
      expect(result.success).toBe(true);
    });
  });

  describe("8. manager can edit another user's note", () => {
    it("allows a manager even when not the author", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await updateClientNote({ noteId: "note-1", body: "By manager" });
      expect(result.success).toBe(true);
    });
  });

  describe("10. non-author/non-manager rejected", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages clients", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await updateClientNote({ noteId: "note-1", body: "Hijacked" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("11. missing note rejected", () => {
    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await updateClientNote({ noteId: "missing", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
    });
  });

  describe("12. cross-tenant note rejected", () => {
    it("rejects when the note's client belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ client: { id: "client-1", companyId: COMPANY_B } }));
      const result = await updateClientNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("13. note with no Client relation rejected", () => {
    it("rejects when the note isn't attached to a Client at all", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ clientId: null, client: null }));
      const result = await updateClientNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
    });
  });

  describe("14. empty body rejected", () => {
    it("rejects an empty body", async () => {
      const result = await updateClientNote({ noteId: "note-1", body: "" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/cannot be empty/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("15. whitespace-only body rejected", () => {
    it("rejects a whitespace-only body", async () => {
      const result = await updateClientNote({ noteId: "note-1", body: "   " });
      expect(result.success).toBe(false);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("16. correct Activity action on edit", () => {
    it("logs client.note_updated with clientId", async () => {
      await updateClientNote({ noteId: "note-1", body: "Updated body" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "client.note_updated",
        companyId: COMPANY_A,
        clientId: "client-1",
        metadata: { noteId: "note-1" },
      });
    });
  });

  describe("18. Activity metadata is exactly { noteId }", () => {
    it("logs no fields beyond noteId in metadata", async () => {
      await updateClientNote({ noteId: "note-1", body: "Updated body" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(Object.keys(call.metadata)).toEqual(["noteId"]);
    });
  });

  describe("19. no note body appears in Activity metadata", () => {
    it("never logs the note body", async () => {
      await updateClientNote({ noteId: "note-1", body: "Sensitive text that must not leak" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("20. correct revalidatePath for edit", () => {
    it("revalidates the client detail path", async () => {
      await updateClientNote({ noteId: "note-1", body: "Updated body" });
      expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients/client-1");
    });
  });

  describe("Client-specific regression: unrelated Client ownership fields are never substituted for note.authorId", () => {
    it("rejects a manager-ineligible employee even though they are unrelated to any Client-specific ownership field", async () => {
      // Client has no assignee/owner-style field analogous to Lead.assignedUserId or Task.assigneeId,
      // so this guards against a future regression where one might be added and mistakenly reused here.
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await updateClientNote({ noteId: "note-1", body: "x" });
      expect(result.success).toBe(false);
    });
  });
});

describe("deleteClientNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote());
    mockedPrisma.note.update.mockResolvedValue(makeNote({ deletedAt: new Date() }));
  });

  describe("2. successful note delete", () => {
    it("succeeds for the author", async () => {
      const result = await deleteClientNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("4. delete updates exactly { deletedAt }", () => {
    it("updates only deletedAt — no other field", async () => {
      await deleteClientNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(Object.keys(data)).toEqual(["deletedAt"]);
    });

    it("sets deletedAt to a Date instance", async () => {
      await deleteClientNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("7. author can delete own note", () => {
    it("allows the note's own author", async () => {
      const result = await deleteClientNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("9. manager can delete another user's note", () => {
    it("allows a manager even when not the author", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await deleteClientNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("10b. non-author/non-manager delete rejected", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages clients", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await deleteClientNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("11b. missing note rejected", () => {
    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await deleteClientNote({ noteId: "missing" });
      expect(result.success).toBe(false);
    });
  });

  describe("12b. cross-tenant delete rejected", () => {
    it("rejects when the note's client belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ client: { id: "client-1", companyId: COMPANY_B } }));
      const result = await deleteClientNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("13b. note with no Client relation rejected", () => {
    it("rejects when the note isn't attached to a Client at all", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ clientId: null, client: null }));
      const result = await deleteClientNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
    });
  });

  describe("17. correct Activity action on delete", () => {
    it("logs client.note_deleted with clientId", async () => {
      await deleteClientNote({ noteId: "note-1" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "client.note_deleted",
        companyId: COMPANY_A,
        clientId: "client-1",
        metadata: { noteId: "note-1" },
      });
    });
  });

  describe("18b. Activity metadata is exactly { noteId }", () => {
    it("logs no fields beyond noteId in metadata", async () => {
      await deleteClientNote({ noteId: "note-1" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(Object.keys(call.metadata)).toEqual(["noteId"]);
    });
  });

  describe("19b. no note body appears in Activity metadata", () => {
    it("never logs the note body", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ body: "Sensitive text that must not leak" }));
      await deleteClientNote({ noteId: "note-1" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("21. correct revalidatePath for delete", () => {
    it("revalidates the client detail path", async () => {
      await deleteClientNote({ noteId: "note-1" });
      expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients/client-1");
    });
  });

  describe("Client-specific regression: authorId is never altered by a manager-performed delete", () => {
    it("preserves the original author's id in the update call — deletedAt only, never authorId", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      await deleteClientNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data).not.toHaveProperty("authorId");
    });
  });
});

describe("restoreClientNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: new Date("2026-02-01") }));
    mockedPrisma.note.update.mockResolvedValue(makeNote({ deletedAt: null }));
  });

  describe("1. successful restore by note author", () => {
    it("succeeds for the author", async () => {
      const result = await restoreClientNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("2. successful restore by manager", () => {
    it("succeeds for a manager on someone else's note", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await restoreClientNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("3. unauthorized restore", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages clients", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await restoreClientNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("4. cross-tenant restore rejection", () => {
    it("rejects when the note's client belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(
        makeNote({ deletedAt: new Date(), client: { id: "client-1", companyId: COMPANY_B } })
      );
      const result = await restoreClientNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });

    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await restoreClientNote({ noteId: "missing" });
      expect(result.success).toBe(false);
    });
  });

  describe("5. rejects restoring a note that isn't deleted", () => {
    it("returns an error when deletedAt is already null", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: null }));
      const result = await restoreClientNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/not deleted/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("6. restore sets deletedAt to null, nothing else", () => {
    it("update data is exactly { deletedAt: null }", async () => {
      await restoreClientNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data).toEqual({ deletedAt: null });
    });
  });

  describe("7. Activity action/reference/metadata for restore", () => {
    it("logs client.note_restored with clientId and metadata: { noteId } only", async () => {
      await restoreClientNote({ noteId: "note-1" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "client.note_restored",
        companyId: COMPANY_A,
        clientId: "client-1",
        metadata: { noteId: "note-1" },
      });
    });

    it("never logs the note body in Activity metadata", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(
        makeNote({ deletedAt: new Date(), body: "Sensitive text that must not leak" })
      );
      await restoreClientNote({ noteId: "note-1" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("8. correct revalidatePath is called", () => {
    it("revalidates the client detail path", async () => {
      await restoreClientNote({ noteId: "note-1" });
      expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients/client-1");
    });
  });
});
