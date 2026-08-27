import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/notifications/services/notification.service", () => ({ createNotification: vi.fn() }));

type MockPrisma = {
  note: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  sEOProject: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    note: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    sEOProject: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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
  deleteSeoProjectNote,
  restoreSeoProjectNote,
  updateSeoProjectNote,
  createSeoProject,
  updateSeoProject,
  archiveSeoProject,
  restoreSeoProject,
  addSeoProjectNote,
} from "@/features/seo/actions/seo-project.actions";
import type { SeoProjectInput } from "@/features/seo/schemas/seo-project.schema";

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

function makeSeoProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "seo-project-1", companyId: COMPANY_A, name: "Acme SEO", ...overrides };
}

const VALID_SEO_PROJECT_INPUT: SeoProjectInput = {
  name: "Acme SEO",
  domain: "acme.test",
  clientId: "",
  ownerId: "",
  status: "ACTIVE",
  startDate: "",
};

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

describe("createSeoProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.create.mockResolvedValue({ id: "seo-project-new", name: "Acme SEO" });
  });

  it("1. denies an EMPLOYEE without creating any SEO project", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await createSeoProject(VALID_SEO_PROJECT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to create SEO projects.");
    expect(mockedPrisma.sEOProject.create).not.toHaveBeenCalled();
  });

  it("2. succeeds for a MANAGER", async () => {
    const result = await createSeoProject(VALID_SEO_PROJECT_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. rejects invalid input (name too short) via the real schema, without creating any SEO project", async () => {
    const result = await createSeoProject({ ...VALID_SEO_PROJECT_INPUT, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Name must be at least 2 characters");
    expect(mockedPrisma.sEOProject.create).not.toHaveBeenCalled();
  });

  it("4. rejects a domain shorter than the real schema's minimum, without creating any SEO project", async () => {
    const result = await createSeoProject({ ...VALID_SEO_PROJECT_INPUT, domain: "ab" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Enter a valid domain");
    expect(mockedPrisma.sEOProject.create).not.toHaveBeenCalled();
  });

  it("5. [characterization — documents current production behavior] a cross-company clientId is accepted without any tenant validation, because none exists in production", async () => {
    const result = await createSeoProject({ ...VALID_SEO_PROJECT_INPUT, clientId: "client-from-another-company" });
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.sEOProject.create.mock.calls[0];
    expect(data.clientId).toBe("client-from-another-company");
  });

  it("6. [characterization — documents current production behavior] a cross-company ownerId is accepted without any tenant validation, because none exists in production", async () => {
    const result = await createSeoProject({ ...VALID_SEO_PROJECT_INPUT, ownerId: "user-from-another-company" });
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.sEOProject.create.mock.calls[0];
    expect(data.ownerId).toBe("user-from-another-company");
  });

  it("7. creates the SEO project with the exact field mapping when every optional field is blank", async () => {
    await createSeoProject(VALID_SEO_PROJECT_INPUT);
    expect(mockedPrisma.sEOProject.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_A,
        name: "Acme SEO",
        domain: "acme.test",
        clientId: null,
        ownerId: null,
        status: "ACTIVE",
        startDate: null,
      },
    });
  });

  it("8. converts a provided startDate string to a real Date", async () => {
    await createSeoProject({ ...VALID_SEO_PROJECT_INPUT, startDate: "2026-03-01" });
    const [{ data }] = mockedPrisma.sEOProject.create.mock.calls[0];
    expect(data.startDate).toEqual(new Date("2026-03-01"));
  });

  it("9. stores a blank startDate as null", async () => {
    await createSeoProject(VALID_SEO_PROJECT_INPUT);
    const [{ data }] = mockedPrisma.sEOProject.create.mock.calls[0];
    expect(data.startDate).toBeNull();
  });

  it("10. logs seo_project.created with the exact actor/company/project ids and metadata", async () => {
    await createSeoProject(VALID_SEO_PROJECT_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "seo_project.created",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-new",
      metadata: { name: "Acme SEO" },
    });
  });

  it("11. revalidates /seo", async () => {
    await createSeoProject(VALID_SEO_PROJECT_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo");
  });

  it("12. returns the id of the newly created SEO project", async () => {
    const result = await createSeoProject(VALID_SEO_PROJECT_INPUT);
    expect(result).toEqual({ success: true, data: { id: "seo-project-new" } });
  });

  it("13. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await createSeoProject(VALID_SEO_PROJECT_INPUT);
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateSeoProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject());
    mockedPrisma.sEOProject.update.mockResolvedValue({ id: "seo-project-1", name: "Acme SEO" });
  });

  it("1. denies an EMPLOYEE without querying or mutating the SEO project", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await updateSeoProject("seo-project-1", VALID_SEO_PROJECT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to edit SEO projects.");
    expect(mockedPrisma.sEOProject.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await updateSeoProject("seo-project-1", VALID_SEO_PROJECT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the SEO project belongs to a different company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject({ companyId: COMPANY_B }));
    const result = await updateSeoProject("seo-project-1", VALID_SEO_PROJECT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("4. rejects invalid input (name too short) via the real schema, without mutating", async () => {
    const result = await updateSeoProject("seo-project-1", { ...VALID_SEO_PROJECT_INPUT, name: "A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Name must be at least 2 characters");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("5. rejects a domain shorter than the real schema's minimum, without mutating", async () => {
    const result = await updateSeoProject("seo-project-1", { ...VALID_SEO_PROJECT_INPUT, domain: "ab" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Enter a valid domain");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("6. [characterization — documents current production behavior] a cross-company clientId/ownerId are accepted without any tenant validation on update, because none exists in production", async () => {
    const result = await updateSeoProject("seo-project-1", {
      ...VALID_SEO_PROJECT_INPUT,
      clientId: "client-from-another-company",
      ownerId: "user-from-another-company",
    });
    expect(result.success).toBe(true);
    const [{ data }] = mockedPrisma.sEOProject.update.mock.calls[0];
    expect(data.clientId).toBe("client-from-another-company");
    expect(data.ownerId).toBe("user-from-another-company");
  });

  it("7. updates with the exact where clause and full field mapping", async () => {
    await updateSeoProject("seo-project-1", { ...VALID_SEO_PROJECT_INPUT, ownerId: "user-9" });
    expect(mockedPrisma.sEOProject.update).toHaveBeenCalledWith({
      where: { id: "seo-project-1" },
      data: {
        name: "Acme SEO",
        domain: "acme.test",
        clientId: null,
        ownerId: "user-9",
        status: "ACTIVE",
        startDate: null,
      },
    });
  });

  it("8. converts a provided startDate string to a real Date", async () => {
    await updateSeoProject("seo-project-1", { ...VALID_SEO_PROJECT_INPUT, startDate: "2026-03-01" });
    const [{ data }] = mockedPrisma.sEOProject.update.mock.calls[0];
    expect(data.startDate).toEqual(new Date("2026-03-01"));
  });

  it("9. logs seo_project.updated with the exact actor/company/project ids and metadata", async () => {
    await updateSeoProject("seo-project-1", VALID_SEO_PROJECT_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "seo_project.updated",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-1",
      metadata: { name: "Acme SEO" },
    });
  });

  it("10. revalidates /seo and the SEO project detail path", async () => {
    await updateSeoProject("seo-project-1", VALID_SEO_PROJECT_INPUT);
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-project-1");
  });

  it("11. returns the id of the updated SEO project", async () => {
    const result = await updateSeoProject("seo-project-1", VALID_SEO_PROJECT_INPUT);
    expect(result).toEqual({ success: true, data: { id: "seo-project-1" } });
  });

  it("12. rejected requests never mutate, log activity, or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await updateSeoProject("seo-project-1", VALID_SEO_PROJECT_INPUT);
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("archiveSeoProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await archiveSeoProject("seo-project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to archive SEO projects.");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await archiveSeoProject("seo-project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the SEO project belongs to a different company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject({ companyId: COMPANY_B }));
    const result = await archiveSeoProject("seo-project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to a Date instance with the exact where clause", async () => {
    await archiveSeoProject("seo-project-1");
    const [{ where, data }] = mockedPrisma.sEOProject.update.mock.calls[0];
    expect(where).toEqual({ id: "seo-project-1" });
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("5. logs seo_project.archived with no metadata", async () => {
    await archiveSeoProject("seo-project-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "seo_project.archived",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-1",
    });
  });

  it("6. revalidates /seo", async () => {
    await archiveSeoProject("seo-project-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo");
  });

  it("7. returns a plain success result", async () => {
    const result = await archiveSeoProject("seo-project-1");
    expect(result).toEqual({ success: true, data: undefined });
  });

  it("8. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await archiveSeoProject("seo-project-1");
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("restoreSeoProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject());
  });

  it("1. denies an EMPLOYEE without mutating", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    const result = await restoreSeoProject("seo-project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to restore SEO projects.");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("2. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await restoreSeoProject("seo-project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the SEO project belongs to a different company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject({ companyId: COMPANY_B }));
    const result = await restoreSeoProject("seo-project-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.sEOProject.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to exactly null with the exact where clause", async () => {
    await restoreSeoProject("seo-project-1");
    expect(mockedPrisma.sEOProject.update).toHaveBeenCalledWith({ where: { id: "seo-project-1" }, data: { deletedAt: null } });
  });

  it("5. logs seo_project.restored with no metadata", async () => {
    await restoreSeoProject("seo-project-1");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "seo_project.restored",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-1",
    });
  });

  it("6. revalidates /seo", async () => {
    await restoreSeoProject("seo-project-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo");
  });

  it("7. returns a plain success result", async () => {
    const result = await restoreSeoProject("seo-project-1");
    expect(result).toEqual({ success: true, data: undefined });
  });

  it("8. rejected requests never log activity or revalidate", async () => {
    mockedRequireUser.mockResolvedValue(AUTHOR);
    await restoreSeoProject("seo-project-1");
    expect(mockedLogActivity).not.toHaveBeenCalled();
    expect(mockedRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("addSeoProjectNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(AUTHOR);
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject({ name: "Acme SEO" }));
    mockedPrisma.note.create.mockResolvedValue({ id: "note-new" });
    mockedPrisma.user.findMany.mockResolvedValue([]);
  });

  it("1. rejects when the SEO project does not exist", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    const result = await addSeoProjectNote("seo-project-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("2. rejects when the SEO project belongs to a different company", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(makeSeoProject({ companyId: COMPANY_B }));
    const result = await addSeoProjectNote("seo-project-1", "A note");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("SEO project not found.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("3. rejects a whitespace-only body without creating a note", async () => {
    const result = await addSeoProjectNote("seo-project-1", "    ");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Note cannot be empty.");
    expect(mockedPrisma.note.create).not.toHaveBeenCalled();
  });

  it("4. succeeds for a plain EMPLOYEE (no role gate — self-service)", async () => {
    const result = await addSeoProjectNote("seo-project-1", "A note");
    expect(result.success).toBe(true);
  });

  it("5. creates the note with the trimmed body and the actor/SEO-project association", async () => {
    await addSeoProjectNote("seo-project-1", "  padded note  ");
    expect(mockedPrisma.note.create).toHaveBeenCalledWith({
      data: { authorId: AUTHOR.id, seoProjectId: "seo-project-1", body: "padded note" },
    });
  });

  it("6. logs seo_project.note_added with no metadata", async () => {
    await addSeoProjectNote("seo-project-1", "A note");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: AUTHOR.id,
      action: "seo_project.note_added",
      companyId: COMPANY_A,
      seoProjectId: "seo-project-1",
    });
  });

  it("7. revalidates only the SEO project detail path", async () => {
    await addSeoProjectNote("seo-project-1", "A note");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/seo/seo-project-1");
  });

  it("8. zero mentions in the body sends zero notifications", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addSeoProjectNote("seo-project-1", "No mentions here");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("9. one real @mention sends exactly one notification, matching the exact production message (unquoted project name)", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "user-9", firstName: "Sam" }]);
    await addSeoProjectNote("seo-project-1", "Great work @Sam");
    expect(mockedPrisma.user.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_A, deletedAt: null },
      select: { id: true, firstName: true },
    });
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith({
      userId: "user-9",
      type: "COMMENT_MENTION",
      message: `${AUTHOR.firstName} mentioned you in a note on Acme SEO`,
      link: "/seo/seo-project-1",
    });
  });

  it("10. multiple @mentions send exactly one notification per mentioned user, to the correct recipients", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([
      { id: "user-9", firstName: "Sam" },
      { id: "user-10", firstName: "Jordan" },
    ]);
    await addSeoProjectNote("seo-project-1", "cc @Sam and @Jordan");
    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    const recipients = mockedCreateNotification.mock.calls.map((call: unknown[]) => (call[0] as { userId: string }).userId);
    expect(recipients.sort()).toEqual(["user-10", "user-9"]);
  });

  it("11. never notifies the author for a self-mention", async () => {
    mockedPrisma.user.findMany.mockResolvedValue([{ id: AUTHOR.id, firstName: "Alex" }]);
    await addSeoProjectNote("seo-project-1", "Reminding myself @Alex");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("12. sends no notifications when the request is rejected", async () => {
    mockedPrisma.sEOProject.findUnique.mockResolvedValue(null);
    await addSeoProjectNote("seo-project-1", "Great work @Sam");
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});

