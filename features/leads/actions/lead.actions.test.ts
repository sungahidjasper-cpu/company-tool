import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/notifications/services/notification.service", () => ({ createNotification: vi.fn() }));

type MockPrisma = {
  note: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  lead: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  leadTask: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  user: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    note: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    lead: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    leadTask: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { count: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/features/notifications/services/notification.service";
import {
  deleteLeadNote,
  restoreLeadNote,
  updateLeadNote,
  createLead,
  updateLead,
  moveLeadStatus,
  archiveLead,
  restoreLead,
  addLeadNote,
  createLeadTask,
  updateLeadTaskStatus,
} from "@/features/leads/actions/lead.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedCreateNotification = createNotification as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const AUTHOR = { id: "user-1", role: "EMPLOYEE", companyId: COMPANY_A, firstName: "Alex" };
const OTHER_EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A, firstName: "Sam" };
const MANAGER = { id: "user-3", role: "MANAGER", companyId: COMPANY_A, firstName: "Morgan" };

function makeLead(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "lead-1",
    companyId: COMPANY_A,
    name: "Acme Corp Lead",
    status: "NEW",
    assignedUserId: null as string | null,
    ...overrides,
  };
}

function makeLeadTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "task-1",
    assigneeId: null as string | null,
    lead: { id: "lead-1", companyId: COMPANY_A, assignedUserId: null as string | null },
    ...overrides,
  };
}

const VALID_LEAD_INPUT = {
  name: "Acme Corp Lead",
  companyName: "",
  email: "",
  phone: "",
  source: "",
  status: "NEW" as const,
  value: "",
  assignedUserId: "",
  clientId: "",
  projectId: "",
};

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

describe("restoreLeadNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: new Date("2026-02-01") }));
    mockedPrisma.note.update.mockResolvedValue(makeNote({ deletedAt: null }));
  });

  describe("1. successful restore by note author", () => {
    it("succeeds for the author", async () => {
      const result = await restoreLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("2. successful restore by manager", () => {
    it("succeeds for a manager on someone else's note", async () => {
      mockedRequireUser.mockResolvedValue(MANAGER);
      const result = await restoreLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(true);
    });
  });

  describe("3. unauthorized restore", () => {
    it("rejects a different EMPLOYEE who neither wrote the note nor manages leads", async () => {
      mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
      const result = await restoreLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/permission/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("4. cross-tenant restore rejection", () => {
    it("rejects when the note's lead belongs to a different company", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(
        makeNote({ deletedAt: new Date(), lead: { id: "lead-1", companyId: COMPANY_B } })
      );
      const result = await restoreLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Note not found.");
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });

    it("rejects when the note doesn't exist", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(null);
      const result = await restoreLeadNote({ noteId: "missing" });
      expect(result.success).toBe(false);
    });
  });

  describe("5. rejects restoring a note that isn't deleted", () => {
    it("returns an error when deletedAt is already null", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: null }));
      const result = await restoreLeadNote({ noteId: "note-1" });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toMatch(/not deleted/i);
      expect(mockedPrisma.note.update).not.toHaveBeenCalled();
    });
  });

  describe("6. restore sets deletedAt to null, nothing else", () => {
    it("update data is exactly { deletedAt: null }", async () => {
      await restoreLeadNote({ noteId: "note-1" });
      const [{ data }] = mockedPrisma.note.update.mock.calls[0];
      expect(data).toEqual({ deletedAt: null });
    });
  });

  describe("7. Activity action/reference/metadata for restore", () => {
    it("logs lead.note_restored with leadId and metadata: { noteId } only", async () => {
      await restoreLeadNote({ noteId: "note-1" });
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: AUTHOR.id,
        action: "lead.note_restored",
        companyId: COMPANY_A,
        leadId: "lead-1",
        metadata: { noteId: "note-1" },
      });
    });

    it("never logs the note body in Activity metadata", async () => {
      mockedPrisma.note.findUnique.mockResolvedValue(
        makeNote({ deletedAt: new Date(), body: "Sensitive text that must not leak" })
      );
      await restoreLeadNote({ noteId: "note-1" });
      const [call] = mockedLogActivity.mock.calls[0];
      expect(JSON.stringify(call)).not.toContain("Sensitive text");
    });
  });

  describe("8. correct revalidatePath is called", () => {
    it("revalidates the lead detail path", async () => {
      const { revalidatePath } = await import("next/cache");
      await restoreLeadNote({ noteId: "note-1" });
      expect(revalidatePath).toHaveBeenCalledWith("/leads/lead-1");
    });
  });
});

describe("createLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.user.count.mockResolvedValue(1);
    mockedPrisma.lead.create.mockResolvedValue({ id: "lead-new", name: "Acme Corp Lead", assignedUserId: null });
  });

  it("1. denies an EMPLOYEE without creating any Lead", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await createLead(VALID_LEAD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to create leads.");
    expect(mockedPrisma.lead.create).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("2. succeeds for a MANAGER", async () => {
    const result = await createLead(VALID_LEAD_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. rejects invalid input (name too short) via the real schema, without creating any Lead", async () => {
    const result = await createLead({ ...VALID_LEAD_INPUT, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Name must be at least 2 characters");
    expect(mockedPrisma.lead.create).not.toHaveBeenCalled();
  });

  it("4. rejects an assignee from a different company, via the real validateCompanyUser query, without creating any Lead", async () => {
    mockedPrisma.user.count.mockResolvedValue(0);
    const result = await createLead({ ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Selected assignee is invalid.");
    expect(mockedPrisma.user.count).toHaveBeenCalledWith({ where: { id: "user-9", companyId: COMPANY_A } });
    expect(mockedPrisma.lead.create).not.toHaveBeenCalled();
  });

  it("5. treats a blank assignedUserId as no assignee — validateCompanyUser is never queried, and the Lead is created with assignedUserId: null", async () => {
    const result = await createLead(VALID_LEAD_INPUT);
    expect(result.success).toBe(true);
    expect(mockedPrisma.user.count).not.toHaveBeenCalled();
    const [{ data }] = mockedPrisma.lead.create.mock.calls[0];
    expect(data.assignedUserId).toBeNull();
  });

  it("6. creates the Lead with the exact field mapping, server-derived companyId/createdById, and blank optional fields normalized to null", async () => {
    await createLead(VALID_LEAD_INPUT);
    expect(mockedPrisma.lead.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_A,
        createdById: MANAGER.id,
        name: "Acme Corp Lead",
        companyName: undefined,
        email: undefined,
        phone: undefined,
        source: undefined,
        status: "NEW",
        value: null,
        assignedUserId: null,
        clientId: null,
        projectId: null,
      },
    });
  });

  it("7. logs lead.created with the exact actor/company/lead ids and metadata", async () => {
    await createLead(VALID_LEAD_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "lead.created",
      companyId: COMPANY_A,
      leadId: "lead-new",
      metadata: { name: "Acme Corp Lead" },
    });
  });

  it("8. revalidates /leads and /pipeline", async () => {
    const { revalidatePath } = await import("next/cache");
    await createLead(VALID_LEAD_INPUT);
    expect(revalidatePath).toHaveBeenCalledWith("/leads");
    expect(revalidatePath).toHaveBeenCalledWith("/pipeline");
  });

  it("9. returns the id of the newly created Lead", async () => {
    const result = await createLead(VALID_LEAD_INPUT);
    expect(result).toEqual({ success: true, data: { id: "lead-new" } });
  });

  it("10. notifies the assignee when a different-user assignee is set", async () => {
    mockedPrisma.lead.create.mockResolvedValue({ id: "lead-new", name: "Acme Corp Lead", assignedUserId: "user-9" });
    await createLead({ ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "LEAD_ASSIGNED",
      message: `${MANAGER.firstName} assigned you the lead "Acme Corp Lead"`,
      link: "/leads/lead-new",
    });
  });

  it("11. does not notify when the creator assigns the lead to themselves", async () => {
    mockedPrisma.lead.create.mockResolvedValue({ id: "lead-new", name: "Acme Corp Lead", assignedUserId: MANAGER.id });
    await createLead({ ...VALID_LEAD_INPUT, assignedUserId: MANAGER.id });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("12. does not notify when no assignee is set", async () => {
    await createLead(VALID_LEAD_INPUT);
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});

describe("updateLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ assignedUserId: "user-9" }));
    mockedPrisma.user.count.mockResolvedValue(1);
    mockedPrisma.lead.update.mockResolvedValue({ id: "lead-1", name: "Acme Corp Lead", assignedUserId: "user-9" });
  });

  it("1. denies an EMPLOYEE without querying or mutating the Lead", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to edit leads.");
    expect(mockedPrisma.lead.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Lead does not exist", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(null);
    const result = await updateLead("lead-1", VALID_LEAD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Lead belongs to a different company", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ companyId: COMPANY_B }));
    const result = await updateLead("lead-1", VALID_LEAD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input via the real schema, without mutating", async () => {
    const result = await updateLead("lead-1", { ...VALID_LEAD_INPUT, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Name must be at least 2 characters");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("4b. rejects an assignee from a different company via the real validateCompanyUser query, without mutating", async () => {
    mockedPrisma.user.count.mockResolvedValue(0);
    const result = await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Selected assignee is invalid.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("5. updates with the exact where clause and field mapping", async () => {
    await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(mockedPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-1" },
      data: {
        name: "Acme Corp Lead",
        companyName: undefined,
        email: undefined,
        phone: undefined,
        source: undefined,
        status: "NEW",
        value: null,
        assignedUserId: "user-9",
        clientId: null,
        projectId: null,
      },
    });
  });

  it("6. does NOT notify when the assignee is unchanged", async () => {
    await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("7. notifies exactly the new assignee when the assignee changes to a different user", async () => {
    await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "user-10" });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-10",
      type: "LEAD_ASSIGNED",
      message: `${MANAGER.firstName} assigned you the lead "Acme Corp Lead"`,
      link: "/leads/lead-1",
    });
  });

  it("8. does NOT notify when the assignee changes to the acting user themselves", async () => {
    await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: MANAGER.id });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("9. does NOT notify when the assignee is cleared (changed to none)", async () => {
    await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "" });
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("10. logs lead.updated with the exact actor/company/lead ids and metadata", async () => {
    await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "lead.updated",
      companyId: COMPANY_A,
      leadId: "lead-1",
      metadata: { name: "Acme Corp Lead" },
    });
  });

  it("11. revalidates /leads, the lead detail path, and /pipeline", async () => {
    const { revalidatePath } = await import("next/cache");
    await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(revalidatePath).toHaveBeenCalledWith("/leads");
    expect(revalidatePath).toHaveBeenCalledWith("/leads/lead-1");
    expect(revalidatePath).toHaveBeenCalledWith("/pipeline");
  });

  it("12. returns the id of the updated Lead", async () => {
    const result = await updateLead("lead-1", { ...VALID_LEAD_INPUT, assignedUserId: "user-9" });
    expect(result).toEqual({ success: true, data: { id: "lead-1" } });
  });
});

describe("moveLeadStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ status: "NEW", assignedUserId: "user-9" }));
  });

  it("1. denies an EMPLOYEE who is neither a manager nor the lead's assignee", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await moveLeadStatus("lead-1", "CONTACTED");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to move this lead.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("2. allows an EMPLOYEE who IS the lead's assignee (self-service carve-out)", async () => {
    mockedRequireUser.mockResolvedValue({ ...AUTHOR, id: "user-9" });
    const result = await moveLeadStatus("lead-1", "CONTACTED");
    expect(result.success).toBe(true);
  });

  it("3. allows a MANAGER regardless of assignment", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ status: "NEW", assignedUserId: "someone-else" }));
    const result = await moveLeadStatus("lead-1", "CONTACTED");
    expect(result.success).toBe(true);
  });

  it("4. rejects when the Lead does not exist", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(null);
    const result = await moveLeadStatus("lead-1", "CONTACTED");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
  });

  it("5. rejects when the Lead belongs to a different company", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ companyId: COMPANY_B }));
    const result = await moveLeadStatus("lead-1", "CONTACTED");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
  });

  it("6. rejects an invalid status via the real schema, without mutating", async () => {
    const result = await moveLeadStatus("lead-1", "BOGUS");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Invalid status.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("7. no-ops when the target status equals the current status — no mutation, no activity, no notification, no revalidation", async () => {
    const { revalidatePath } = await import("next/cache");
    const result = await moveLeadStatus("lead-1", "NEW");
    expect(result).toEqual({ success: true, data: undefined });
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("8. updates with the exact where clause and new status when the status changes", async () => {
    await moveLeadStatus("lead-1", "CONTACTED");
    expect(mockedPrisma.lead.update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: { status: "CONTACTED" } });
  });

  it("9. logs lead.status_changed with the exact from/to metadata", async () => {
    await moveLeadStatus("lead-1", "CONTACTED");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "lead.status_changed",
      companyId: COMPANY_A,
      leadId: "lead-1",
      metadata: { from: "NEW", to: "CONTACTED" },
    });
  });

  it("10. notifies with LEAD_WON when the new status is WON", async () => {
    await moveLeadStatus("lead-1", "WON");
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "LEAD_WON",
      message: `${MANAGER.firstName} marked "Acme Corp Lead" as won`,
      link: "/leads/lead-1",
    });
  });

  it("11. notifies with LEAD_LOST when the new status is LOST", async () => {
    await moveLeadStatus("lead-1", "LOST");
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "LEAD_LOST",
      message: `${MANAGER.firstName} marked "Acme Corp Lead" as lost`,
      link: "/leads/lead-1",
    });
  });

  it("12. notifies with LEAD_MOVED and a humanized status for any other transition", async () => {
    await moveLeadStatus("lead-1", "PROPOSAL_SENT");
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "LEAD_MOVED",
      message: `${MANAGER.firstName} moved "Acme Corp Lead" to proposal sent`,
      link: "/leads/lead-1",
    });
  });

  it("13. does not notify when the lead has no assignee", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ status: "NEW", assignedUserId: null }));
    await moveLeadStatus("lead-1", "CONTACTED");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("14. does not notify when the actor is moving their own assigned lead", async () => {
    mockedRequireUser.mockResolvedValue({ ...AUTHOR, id: "user-9" });
    await moveLeadStatus("lead-1", "CONTACTED");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("15. revalidates /leads, the lead detail path, /pipeline, and /dashboard", async () => {
    const { revalidatePath } = await import("next/cache");
    await moveLeadStatus("lead-1", "CONTACTED");
    expect(revalidatePath).toHaveBeenCalledWith("/leads");
    expect(revalidatePath).toHaveBeenCalledWith("/leads/lead-1");
    expect(revalidatePath).toHaveBeenCalledWith("/pipeline");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("16. returns a plain success result on a successful transition", async () => {
    const result = await moveLeadStatus("lead-1", "CONTACTED");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("archiveLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await archiveLead("lead-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to archive leads.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Lead does not exist", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(null);
    const result = await archiveLead("lead-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Lead belongs to a different company", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ companyId: COMPANY_B }));
    const result = await archiveLead("lead-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to a Date instance with the exact where clause", async () => {
    await archiveLead("lead-1");
    const [{ where, data }] = mockedPrisma.lead.update.mock.calls[0];
    expect(where).toEqual({ id: "lead-1" });
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("5. logs lead.archived with no metadata", async () => {
    await archiveLead("lead-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "lead.archived",
      companyId: COMPANY_A,
      leadId: "lead-1",
    });
  });

  it("6. revalidates /leads and /pipeline", async () => {
    const { revalidatePath } = await import("next/cache");
    await archiveLead("lead-1");
    expect(revalidatePath).toHaveBeenCalledWith("/leads");
    expect(revalidatePath).toHaveBeenCalledWith("/pipeline");
  });

  it("7. returns a plain success result", async () => {
    const result = await archiveLead("lead-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("restoreLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await restoreLead("lead-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to restore leads.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the Lead does not exist", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(null);
    const result = await restoreLead("lead-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the Lead belongs to a different company", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ companyId: COMPANY_B }));
    const result = await restoreLead("lead-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.lead.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to exactly null with the exact where clause", async () => {
    await restoreLead("lead-1");
    expect(mockedPrisma.lead.update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: { deletedAt: null } });
  });

  it("5. logs lead.restored with no metadata", async () => {
    await restoreLead("lead-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "lead.restored",
      companyId: COMPANY_A,
      leadId: "lead-1",
    });
  });

  it("6. revalidates /leads and /pipeline", async () => {
    const { revalidatePath } = await import("next/cache");
    await restoreLead("lead-1");
    expect(revalidatePath).toHaveBeenCalledWith("/leads");
    expect(revalidatePath).toHaveBeenCalledWith("/pipeline");
  });

  it("7. returns a plain success result", async () => {
    const result = await restoreLead("lead-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("addLeadNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead());
    mockedPrisma.note.create.mockResolvedValue({ id: "note-new" });
    mockedPrisma.user.findMany.mockResolvedValue([]);
  });

  it("1. rejects when the Lead does not exist", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(null);
    const result = await addLeadNote("lead-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the Lead belongs to a different company", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ companyId: COMPANY_B }));
    const result = await addLeadNote("lead-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("3. rejects a whitespace-only body without creating a note", async () => {
    const result = await addLeadNote("lead-1", "    ");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note cannot be empty.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("4. succeeds for a plain EMPLOYEE (no role gate — self-service)", async () => {
    const result = await addLeadNote("lead-1", "A note");
    expect(result.success).toBe(true);
  });

  it("5. creates the note with the trimmed body and the actor/lead association", async () => {
    await addLeadNote("lead-1", "  padded note  ");
    expect(mockedPrisma.note.create).toHaveBeenCalledWith({
      data: { authorId: AUTHOR.id, leadId: "lead-1", body: "padded note" },
    });
  });

  it("6. logs lead.note_added with no metadata", async () => {
    await addLeadNote("lead-1", "A note");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "lead.note_added",
      companyId: COMPANY_A,
      leadId: "lead-1",
    });
  });

  it("7. revalidates the lead detail path", async () => {
    const { revalidatePath } = await import("next/cache");
    await addLeadNote("lead-1", "A note");
    expect(revalidatePath).toHaveBeenCalledWith("/leads/lead-1");
  });

  it("8. zero mentions in the body sends zero notifications", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addLeadNote("lead-1", "No mentions here");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("9. one real @mention sends exactly one notification to the matched company member", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addLeadNote("lead-1", "Great work @Sam");
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_A, deletedAt: null },
      select: { id: true, firstName: true },
    });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "COMMENT_MENTION",
      message: `${AUTHOR.firstName} mentioned you in a note on Acme Corp Lead`,
      link: "/leads/lead-1",
    });
  });

  it("10. multiple @mentions send exactly one notification per mentioned user, to the correct recipients", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "user-9", firstName: "Sam" },
      { id: "user-10", firstName: "Jordan" },
    ]);
    await addLeadNote("lead-1", "cc @Sam and @Jordan");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    const recipients = mockedCreateNotification.mock.calls.map((call: unknown[]) => (call[0] as { userId: string }).userId);
    expect(recipients.sort()).toEqual(["user-10", "user-9"]);
  });

  it("11. never notifies the author for a self-mention", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: AUTHOR.id, firstName: "Alex" }]);
    await addLeadNote("lead-1", "Reminding myself @Alex");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("12. sends no notifications when the request is rejected", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(null);
    await addLeadNote("lead-1", "Great work @Sam");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});

describe("createLeadTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ assignedUserId: "user-9" }));
    mockedPrisma.leadTask.create.mockResolvedValue({ id: "task-new", title: "Follow up" });
  });

  it("1. rejects when the Lead does not exist", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(null);
    const result = await createLeadTask("lead-1", "Follow up");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.leadTask.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the Lead belongs to a different company", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ companyId: COMPANY_B }));
    const result = await createLeadTask("lead-1", "Follow up");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Lead not found.");
    expect(mockedPrisma.leadTask.create).not.toHaveBeenCalled();
  });

  it("3. denies an EMPLOYEE who is neither a manager nor the lead's assignee", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await createLeadTask("lead-1", "Follow up");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to add tasks to this lead.");
    expect(mockedPrisma.leadTask.create).not.toHaveBeenCalled();
  });

  it("4. allows an EMPLOYEE who IS the lead's assignee (self-service carve-out)", async () => {
    mockedRequireUser.mockResolvedValue({ ...AUTHOR, id: "user-9" });
    const result = await createLeadTask("lead-1", "Follow up");
    expect(result.success).toBe(true);
  });

  it("5. allows a MANAGER regardless of assignment", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ assignedUserId: null }));
    const result = await createLeadTask("lead-1", "Follow up");
    expect(result.success).toBe(true);
  });

  it("6. rejects an invalid title via the real schema, without creating a task", async () => {
    const result = await createLeadTask("lead-1", "A");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Title must be at least 2 characters");
    expect(mockedPrisma.leadTask.create).not.toHaveBeenCalled();
  });

  it("7. assigns the new task to the LEAD's own assignee — never the actor, and never an arbitrary value", async () => {
    await createLeadTask("lead-1", "Follow up");
    expect(mockedPrisma.leadTask.create).toHaveBeenCalledWith({
      data: { leadId: "lead-1", createdById: MANAGER.id, assigneeId: "user-9", title: "Follow up" },
    });
    const [{ data }] = mockedPrisma.leadTask.create.mock.calls[0];
    expect(data.assigneeId).not.toBe(MANAGER.id);
  });

  it("8. assigns null when the lead itself has no assignee", async () => {
    mockedPrisma.lead.findUnique.mockResolvedValue(makeLead({ assignedUserId: null }));
    await createLeadTask("lead-1", "Follow up");
    const [{ data }] = mockedPrisma.leadTask.create.mock.calls[0];
    expect(data.assigneeId).toBeNull();
  });

  it("9. logs lead.task_created with the exact taskId/title metadata", async () => {
    await createLeadTask("lead-1", "Follow up");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "lead.task_created",
      companyId: COMPANY_A,
      leadId: "lead-1",
      metadata: { taskId: "task-new", title: "Follow up" },
    });
  });

  it("10. revalidates the lead detail path", async () => {
    const { revalidatePath } = await import("next/cache");
    await createLeadTask("lead-1", "Follow up");
    expect(revalidatePath).toHaveBeenCalledWith("/leads/lead-1");
  });

  it("11. returns the id of the newly created task", async () => {
    const result = await createLeadTask("lead-1", "Follow up");
    expect(result).toEqual({ success: true, data: { id: "task-new" } });
  });
});

describe("updateLeadTaskStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.leadTask.findUnique.mockResolvedValue(
      makeLeadTask({ assigneeId: "user-task-assignee", lead: { id: "lead-1", companyId: COMPANY_A, assignedUserId: "user-lead-assignee" } })
    );
  });

  it("1. denies an EMPLOYEE who is not the task assignee, not the lead assignee, and not a manager", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await updateLeadTaskStatus("task-1", "DONE");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to update this task.");
    expect(mockedPrisma.leadTask.update).not.toHaveBeenCalled();
  });

  it("2. allows an EMPLOYEE who IS the task's own assignee (independent of the lead's assignee)", async () => {
    mockedRequireUser.mockResolvedValue({ ...AUTHOR, id: "user-task-assignee" });
    const result = await updateLeadTaskStatus("task-1", "DONE");
    expect(result.success).toBe(true);
  });

  it("3. allows an EMPLOYEE who IS the lead's assignee, even though they are not the task's own assignee", async () => {
    mockedRequireUser.mockResolvedValue({ ...AUTHOR, id: "user-lead-assignee" });
    const result = await updateLeadTaskStatus("task-1", "DONE");
    expect(result.success).toBe(true);
  });

  it("4. allows a MANAGER regardless of either assignment", async () => {
    const result = await updateLeadTaskStatus("task-1", "DONE");
    expect(result.success).toBe(true);
  });

  it("5. rejects when the task does not exist", async () => {
    mockedPrisma.leadTask.findUnique.mockResolvedValue(null);
    const result = await updateLeadTaskStatus("task-1", "DONE");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.leadTask.update).not.toHaveBeenCalled();
  });

  it("6. rejects when the task's lead belongs to a different company", async () => {
    mockedPrisma.leadTask.findUnique.mockResolvedValue(makeLeadTask({ lead: { id: "lead-1", companyId: COMPANY_B, assignedUserId: null } }));
    const result = await updateLeadTaskStatus("task-1", "DONE");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Task not found.");
    expect(mockedPrisma.leadTask.update).not.toHaveBeenCalled();
  });

  it("7. rejects a status outside the fixed literal list, without mutating", async () => {
    const result = await updateLeadTaskStatus("task-1", "BOGUS");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Invalid status.");
    expect(mockedPrisma.leadTask.update).not.toHaveBeenCalled();
  });

  it("8. updates with the exact where clause and new status", async () => {
    await updateLeadTaskStatus("task-1", "DONE");
    expect(mockedPrisma.leadTask.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { status: "DONE" } });
  });

  it("9. logs lead.task_status_changed with the exact taskId/status metadata and the lead's own id", async () => {
    await updateLeadTaskStatus("task-1", "DONE");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "lead.task_status_changed",
      companyId: COMPANY_A,
      leadId: "lead-1",
      metadata: { taskId: "task-1", status: "DONE" },
    });
  });

  it("10. revalidates the lead detail path derived from the task's own lead relation", async () => {
    const { revalidatePath } = await import("next/cache");
    await updateLeadTaskStatus("task-1", "DONE");
    expect(revalidatePath).toHaveBeenCalledWith("/leads/lead-1");
  });

  it("11. returns a plain success result", async () => {
    const result = await updateLeadTaskStatus("task-1", "DONE");
    expect(result).toEqual({ success: true, data: undefined });
  });
});
