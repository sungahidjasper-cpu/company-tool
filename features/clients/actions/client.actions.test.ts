import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/notifications/services/notification.service", () => ({ createNotification: vi.fn() }));

type MockPrisma = {
  note: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  client: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    note: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    client: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/features/notifications/services/notification.service";
import {
  deleteClientNote,
  restoreClientNote,
  updateClientNote,
  createClient,
  updateClient,
  archiveClient,
  restoreClient,
  addClientNote,
} from "@/features/clients/actions/client.actions";
import type { ClientInput } from "@/features/clients/schemas/client.schema";

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

function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "client-1", companyId: COMPANY_A, name: "Acme Corp", ...overrides };
}

const VALID_CLIENT_INPUT: ClientInput = {
  name: "Acme Corp",
  email: "",
  phone: "",
  website: "",
  industry: "",
  address: "",
  source: "",
  status: "LEAD",
  ownerId: "",
};

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

describe("createClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.client.create.mockResolvedValue({ id: "client-new", name: "Acme Corp" });
  });

  it("1. denies an EMPLOYEE without creating any Client", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await createClient(VALID_CLIENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to create clients.");
    expect(mockedPrisma.client.create).not.toHaveBeenCalled();
  });

  it("2. succeeds for a MANAGER", async () => {
    const result = await createClient(VALID_CLIENT_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. rejects invalid input via the real schema, without creating any Client", async () => {
    const result = await createClient({ ...VALID_CLIENT_INPUT, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Name must be at least 2 characters");
    expect(mockedPrisma.client.create).not.toHaveBeenCalled();
  });

  it("4. rejects an invalid email via the real schema, without creating any Client", async () => {
    const result = await createClient({ ...VALID_CLIENT_INPUT, email: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Enter a valid email address");
    expect(mockedPrisma.client.create).not.toHaveBeenCalled();
  });

  it("5. [characterization — documents current production behavior] a cross-company ownerId is accepted without any tenant validation, because none exists in production", async () => {
    const result = await createClient({ ...VALID_CLIENT_INPUT, ownerId: "user-from-another-company" });
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.client.create.mock.calls[0];
    expect(data.ownerId).toBe("user-from-another-company");
  });

  it("6. creates the Client with the exact field mapping when every optional field is blank", async () => {
    await createClient(VALID_CLIENT_INPUT);
    expect(mockedPrisma.client.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_A,
        name: "Acme Corp",
        email: undefined,
        phone: undefined,
        website: undefined,
        industry: undefined,
        address: undefined,
        source: undefined,
        status: "LEAD",
        ownerId: null,
      },
    });
  });

  it("7. stores provided optional fields as-is", async () => {
    await createClient({
      ...VALID_CLIENT_INPUT,
      email: "contact@acme.test",
      phone: "555-0100",
      website: "https://acme.test",
      industry: "Retail",
      address: "123 Main St",
      source: "Referral",
      ownerId: "user-9",
    });
    const [{ data }] = mockedPrisma.client.create.mock.calls[0];
    expect(data).toMatchObject({
      email: "contact@acme.test",
      phone: "555-0100",
      website: "https://acme.test",
      industry: "Retail",
      address: "123 Main St",
      source: "Referral",
      ownerId: "user-9",
    });
  });

  it("8. logs client.created with the exact actor/company/client ids and metadata", async () => {
    await createClient(VALID_CLIENT_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "client.created",
      companyId: COMPANY_A,
      clientId: "client-new",
      metadata: { name: "Acme Corp" },
    });
  });

  it("9. revalidates the client list", async () => {
    await createClient(VALID_CLIENT_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients");
  });

  it("10. returns the id of the newly created Client", async () => {
    const result = await createClient(VALID_CLIENT_INPUT);
    expect(result).toEqual({ success: true, data: { id: "client-new" } });
  });

  it("11. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await createClient(VALID_CLIENT_INPUT);
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.client.findUnique.mockResolvedValue(makeClient());
    mockedPrisma.client.update.mockResolvedValue({ id: "client-1", name: "Acme Corp" });
  });

  it("1. denies an EMPLOYEE without querying or mutating the Client", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await updateClient("client-1", VALID_CLIENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to edit clients.");
    expect(mockedPrisma.client.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Client does not exist", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(null);
    const result = await updateClient("client-1", VALID_CLIENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Client not found.");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Client belongs to a different company", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(makeClient({ companyId: COMPANY_B }));
    const result = await updateClient("client-1", VALID_CLIENT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Client not found.");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input via the real schema, without mutating", async () => {
    const result = await updateClient("client-1", { ...VALID_CLIENT_INPUT, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Name must be at least 2 characters");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("5. [characterization — documents current production behavior] a cross-company ownerId is accepted without any tenant validation on update, because none exists in production", async () => {
    const result = await updateClient("client-1", { ...VALID_CLIENT_INPUT, ownerId: "user-from-another-company" });
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.client.update.mock.calls[0];
    expect(data.ownerId).toBe("user-from-another-company");
  });

  it("6. updates with the exact where clause and full field mapping", async () => {
    await updateClient("client-1", { ...VALID_CLIENT_INPUT, ownerId: "user-9" });
    expect(mockedPrisma.client.update).toHaveBeenCalledWith({
      where: { id: "client-1" },
      data: {
        name: "Acme Corp",
        email: undefined,
        phone: undefined,
        website: undefined,
        industry: undefined,
        address: undefined,
        source: undefined,
        status: "LEAD",
        ownerId: "user-9",
      },
    });
  });

  it("7. logs client.updated with the exact actor/company/client ids and metadata", async () => {
    await updateClient("client-1", VALID_CLIENT_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "client.updated",
      companyId: COMPANY_A,
      clientId: "client-1",
      metadata: { name: "Acme Corp" },
    });
  });

  it("8. revalidates the client list and the client detail path", async () => {
    await updateClient("client-1", VALID_CLIENT_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients/client-1");
  });

  it("9. returns the id of the updated Client", async () => {
    const result = await updateClient("client-1", VALID_CLIENT_INPUT);
    expect(result).toEqual({ success: true, data: { id: "client-1" } });
  });

  it("10. rejected requests never mutate, log activity, or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await updateClient("client-1", VALID_CLIENT_INPUT);
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("archiveClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.client.findUnique.mockResolvedValue(makeClient());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await archiveClient("client-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to archive clients.");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Client does not exist", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(null);
    const result = await archiveClient("client-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Client not found.");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Client belongs to a different company", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(makeClient({ companyId: COMPANY_B }));
    const result = await archiveClient("client-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Client not found.");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to a Date instance with the exact where clause", async () => {
    await archiveClient("client-1");
    const [{ where, data }] = mockedPrisma.client.update.mock.calls[0];
    expect(where).toEqual({ id: "client-1" });
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("5. logs client.archived with no metadata", async () => {
    await archiveClient("client-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "client.archived",
      companyId: COMPANY_A,
      clientId: "client-1",
    });
  });

  it("6. revalidates the client list", async () => {
    await archiveClient("client-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients");
  });

  it("7. returns a plain success result", async () => {
    const result = await archiveClient("client-1");
    expect(result).toEqual({ success: true, data: undefined });
  });

  it("8. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await archiveClient("client-1");
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("restoreClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.client.findUnique.mockResolvedValue(makeClient());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await restoreClient("client-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to restore clients.");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Client does not exist", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(null);
    const result = await restoreClient("client-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Client not found.");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Client belongs to a different company", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(makeClient({ companyId: COMPANY_B }));
    const result = await restoreClient("client-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Client not found.");
    expect(mockedPrisma.client.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to exactly null with the exact where clause", async () => {
    await restoreClient("client-1");
    expect(mockedPrisma.client.update).toHaveBeenCalledWith({ where: { id: "client-1" }, data: { deletedAt: null } });
  });

  it("5. logs client.restored with no metadata", async () => {
    await restoreClient("client-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "client.restored",
      companyId: COMPANY_A,
      clientId: "client-1",
    });
  });

  it("6. revalidates the client list", async () => {
    await restoreClient("client-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients");
  });

  it("7. returns a plain success result", async () => {
    const result = await restoreClient("client-1");
    expect(result).toEqual({ success: true, data: undefined });
  });

  it("8. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await restoreClient("client-1");
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("addClientNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.client.findUnique.mockResolvedValue(makeClient({ name: "Acme Corp" }));
    mockedPrisma.note.create.mockResolvedValue({ id: "note-new" });
    mockedPrisma.user.findMany.mockResolvedValue([]);
  });

  it("1. rejects when the Client does not exist", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(null);
    const result = await addClientNote("client-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Client not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the Client belongs to a different company", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(makeClient({ companyId: COMPANY_B }));
    const result = await addClientNote("client-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Client not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("3. rejects a whitespace-only body without creating a note", async () => {
    const result = await addClientNote("client-1", "    ");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note cannot be empty.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("4. succeeds for a plain EMPLOYEE (no role gate — self-service)", async () => {
    const result = await addClientNote("client-1", "A note");
    expect(result.success).toBe(true);
  });

  it("5. creates the note with the trimmed body and the actor/client association", async () => {
    await addClientNote("client-1", "  padded note  ");
    expect(mockedPrisma.note.create).toHaveBeenCalledWith({
      data: { authorId: AUTHOR.id, clientId: "client-1", body: "padded note" },
    });
  });

  it("6. logs client.note_added with no metadata", async () => {
    await addClientNote("client-1", "A note");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "client.note_added",
      companyId: COMPANY_A,
      clientId: "client-1",
    });
  });

  it("7. revalidates only the client detail path", async () => {
    await addClientNote("client-1", "A note");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/clients/client-1");
  });

  it("8. zero mentions in the body sends zero notifications", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addClientNote("client-1", "No mentions here");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("9. one real @mention sends exactly one notification, matching the exact production message (unquoted client name)", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addClientNote("client-1", "Great work @Sam");
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_A, deletedAt: null },
      select: { id: true, firstName: true },
    });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "COMMENT_MENTION",
      message: `${AUTHOR.firstName} mentioned you in a note on Acme Corp`,
      link: "/clients/client-1",
    });
  });

  it("10. multiple @mentions send exactly one notification per mentioned user, to the correct recipients", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "user-9", firstName: "Sam" },
      { id: "user-10", firstName: "Jordan" },
    ]);
    await addClientNote("client-1", "cc @Sam and @Jordan");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    const recipients = mockedCreateNotification.mock.calls.map((call: unknown[]) => (call[0] as { userId: string }).userId);
    expect(recipients.sort()).toEqual(["user-10", "user-9"]);
  });

  it("11. never notifies the author for a self-mention", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: AUTHOR.id, firstName: "Alex" }]);
    await addClientNote("client-1", "Reminding myself @Alex");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("12. sends no notifications when the request is rejected", async () => {
    mockedPrisma.client.findUnique.mockResolvedValue(null);
    await addClientNote("client-1", "Great work @Sam");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});
