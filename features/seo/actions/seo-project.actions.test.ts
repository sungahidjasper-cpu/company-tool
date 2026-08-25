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
import { deleteSeoProjectNote, restoreSeoProjectNote, updateSeoProjectNote } from "@/features/seo/actions/seo-project.actions";

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
    seoProjectId: "seo-project-1",
    clientId: null,
    leadId: null,
    projectId: null,
    taskId: null,
    contentId: null,
    body: "Original note body",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    seoProject: { id: "seo-project-1", companyId: COMPANY_A },
    ...overrides,
  };
}

describe("updateSeoProjectNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote());
    mockedPrisma.note.update.mockResolvedValue(makeNote({ body: "Updated body" }));
  });

  it("successful author edit", async () => {
    const result = await updateSeoProjectNote({ noteId: "note-1", body: "Updated body" });
    expect(result.success).toBe(true);
  });

  it("manager editing another user's note succeeds", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await updateSeoProjectNote({ noteId: "note-1", body: "By manager" });
    expect(result.success).toBe(true);
  });

  it("unauthorized employee editing another user's note is rejected", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
    const result = await updateSeoProjectNote({ noteId: "note-1", body: "Hijacked" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("wrong-tenant note rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ seoProject: { id: "seo-project-1", companyId: COMPANY_B } }));
    const result = await updateSeoProjectNote({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("missing note rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await updateSeoProjectNote({ noteId: "missing", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
  });

  it("note with no SEOProject relation rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ seoProjectId: null, seoProject: null }));
    const result = await updateSeoProjectNote({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
  });

  it("already-deleted note cannot be edited", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: new Date() }));
    const result = await updateSeoProjectNote({ noteId: "note-1", body: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/already been deleted/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("empty body rejected", async () => {
    const result = await updateSeoProjectNote({ noteId: "note-1", body: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/cannot be empty/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("whitespace-only body rejected", async () => {
    const result = await updateSeoProjectNote({ noteId: "note-1", body: "   " });
    expect(result.success).toBe(false);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("update changes only body", async () => {
    await updateSeoProjectNote({ noteId: "note-1", body: "  padded  " });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["body"]);
    expect(data.body).toBe("padded");
  });

  it("Activity action is correct and metadata is exactly { noteId }", async () => {
    await updateSeoProjectNote({ noteId: "note-1", body: "Updated body" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "seo_project.note_updated",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-1",
      metadata: { noteId: "note-1" },
    });
  });

  it("note body is not included in Activity metadata", async () => {
    await updateSeoProjectNote({ noteId: "note-1", body: "Sensitive text that must not leak" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("revalidatePath is called correctly", async () => {
    await updateSeoProjectNote({ noteId: "note-1", body: "Updated body" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-project-1");
  });
});

describe("deleteSeoProjectNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote());
    mockedPrisma.note.update.mockResolvedValue(makeNote({ deletedAt: new Date() }));
  });

  it("successful author delete", async () => {
    const result = await deleteSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("manager deleting another user's note succeeds", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await deleteSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("unauthorized employee deleting another user's note is rejected", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
    const result = await deleteSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("wrong-tenant note rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ seoProject: { id: "seo-project-1", companyId: COMPANY_B } }));
    const result = await deleteSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("missing note rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await deleteSeoProjectNote({ noteId: "missing" });
    expect(result.success).toBe(false);
  });

  it("note with no SEOProject relation rejected", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ seoProjectId: null, seoProject: null }));
    const result = await deleteSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
  });

  it("delete changes only deletedAt", async () => {
    await deleteSeoProjectNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("authorId remains unchanged (never included in the update)", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    await deleteSeoProjectNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("authorId");
  });

  it("seoProjectId remains unchanged (never included in the update)", async () => {
    await deleteSeoProjectNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).not.toHaveProperty("seoProjectId");
  });

  it("Activity action is correct and metadata is exactly { noteId }", async () => {
    await deleteSeoProjectNote({ noteId: "note-1" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "seo_project.note_deleted",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-1",
      metadata: { noteId: "note-1" },
    });
  });

  it("note body is not included in Activity metadata", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ body: "Sensitive text that must not leak" }));
    await deleteSeoProjectNote({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("revalidatePath is called correctly", async () => {
    await deleteSeoProjectNote({ noteId: "note-1" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-project-1");
  });
});

describe("restoreSeoProjectNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: new Date("2026-02-01") }));
    mockedPrisma.note.update.mockResolvedValue(makeNote({ deletedAt: null }));
  });

  it("succeeds for the author", async () => {
    const result = await restoreSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("succeeds for a manager on someone else's note", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await restoreSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a different EMPLOYEE who neither wrote the note nor manages SEO projects", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_EMPLOYEE);
    const result = await restoreSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("rejects when the note's SEO project belongs to a different company", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeNote({ deletedAt: new Date(), seoProject: { id: "seo-project-1", companyId: COMPANY_B } })
    );
    const result = await restoreSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note not found.");
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("rejects when the note doesn't exist", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(null);
    const result = await restoreSeoProjectNote({ noteId: "missing" });
    expect(result.success).toBe(false);
  });

  it("rejects restoring a note that isn't deleted", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(makeNote({ deletedAt: null }));
    const result = await restoreSeoProjectNote({ noteId: "note-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not deleted/i);
    expect(mockedPrisma.note.update).not.toHaveBeenCalled();
  });

  it("update data is exactly { deletedAt: null }", async () => {
    await restoreSeoProjectNote({ noteId: "note-1" });
    const [{ data }] = mockedPrisma.note.update.mock.calls[0];
    expect(data).toEqual({ deletedAt: null });
  });

  it("logs seo_project.note_restored with seoProjectId and metadata: { noteId } only", async () => {
    await restoreSeoProjectNote({ noteId: "note-1" });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "seo_project.note_restored",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-1",
      metadata: { noteId: "note-1" },
    });
  });

  it("note body is not included in Activity metadata", async () => {
    mockedPrisma.note.findUnique.mockResolvedValue(
      makeNote({ deletedAt: new Date(), body: "Sensitive text that must not leak" })
    );
    await restoreSeoProjectNote({ noteId: "note-1" });
    const [call] = mockedLogActivity.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("Sensitive text");
  });

  it("revalidatePath is called correctly", async () => {
    await restoreSeoProjectNote({ noteId: "note-1" });
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-project-1");
  });
});

