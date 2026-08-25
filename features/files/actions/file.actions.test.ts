import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: { save: vi.fn(), delete: vi.fn() } }));
vi.mock("@/features/notifications/services/notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("@/features/files/services/entity-target", () => ({
  resolveEntityTypeFromFile: vi.fn(),
  getEntityIdFromFile: vi.fn(),
  resolveEntityContext: vi.fn(),
  canManageEntityFiles: vi.fn(),
  buildActivityRefs: vi.fn(),
}));

type MockPrisma = {
  file: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    file: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { storage } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import {
  resolveEntityTypeFromFile,
  getEntityIdFromFile,
  resolveEntityContext,
  canManageEntityFiles,
  buildActivityRefs,
} from "@/features/files/services/entity-target";
import { deleteFile, restoreFile } from "@/features/files/actions/file.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedStorage = storage as unknown as { save: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedResolveEntityTypeFromFile = resolveEntityTypeFromFile as unknown as ReturnType<typeof vi.fn>;
const mockedGetEntityIdFromFile = getEntityIdFromFile as unknown as ReturnType<typeof vi.fn>;
const mockedResolveEntityContext = resolveEntityContext as unknown as ReturnType<typeof vi.fn>;
const mockedCanManageEntityFiles = canManageEntityFiles as unknown as ReturnType<typeof vi.fn>;
const mockedBuildActivityRefs = buildActivityRefs as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };

function makeFile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "file-1",
    uploadedById: "user-1",
    fileName: "report.pdf",
    url: "uploads/file-1/report.pdf",
    contentId: "content-1",
    ...overrides,
  };
}

describe("deleteFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.file.findUnique.mockResolvedValue(makeFile());
    mockedResolveEntityTypeFromFile.mockReturnValue("content");
    mockedGetEntityIdFromFile.mockReturnValue("content-1");
    mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: ["/seo/seo-1/content/content-1"], isAssignee: false });
    mockedCanManageEntityFiles.mockReturnValue(true);
    mockedBuildActivityRefs.mockReturnValue({ contentId: "content-1" });
    mockedPrisma.file.update.mockResolvedValue({ ...makeFile(), deletedAt: new Date() });
  });

  describe("1. successful soft-delete", () => {
    it("returns a successful ActionResult", async () => {
      const result = await deleteFile("file-1");
      expect(result.success).toBe(true);
    });
  });

  describe("2. uses prisma.file.update()", () => {
    it("calls file.update with the file's id", async () => {
      await deleteFile("file-1");
      expect(mockedPrisma.file.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "file-1" } })
      );
    });
  });

  describe("3. never calls prisma.file.delete()", () => {
    it("does not hard-delete the row", async () => {
      await deleteFile("file-1");
      expect(mockedPrisma.file.delete).not.toHaveBeenCalled();
    });
  });

  describe("4. never calls storage.delete()", () => {
    it("leaves the physical object untouched", async () => {
      await deleteFile("file-1");
      expect(mockedStorage.delete).not.toHaveBeenCalled();
    });
  });

  describe("5. deletedAt is populated", () => {
    it("sets deletedAt to a Date in the update call", async () => {
      await deleteFile("file-1");
      const [{ data }] = mockedPrisma.file.update.mock.calls[0];
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it("sets no other field on the row — deletedAt only", async () => {
      await deleteFile("file-1");
      const [{ data }] = mockedPrisma.file.update.mock.calls[0];
      expect(Object.keys(data)).toEqual(["deletedAt"]);
    });
  });

  describe("6. Activity is logged with the correct entity references", () => {
    it("logs file.deleted with the resolved entity refs and safe metadata", async () => {
      await deleteFile("file-1");
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: "user-1",
        action: "file.deleted",
        companyId: COMPANY_A,
        metadata: { fileId: "file-1", fileName: "report.pdf", entityType: "content" },
        contentId: "content-1",
      });
    });

    it("reuses buildActivityRefs rather than duplicating entity-ref logic", async () => {
      await deleteFile("file-1");
      expect(mockedBuildActivityRefs).toHaveBeenCalledWith("content", "content-1");
    });
  });

  describe("7. permission rejection", () => {
    it("denies when canManageEntityFiles is false and the actor isn't the uploader or an assignee", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: [], isAssignee: false });
      mockedPrisma.file.findUnique.mockResolvedValue(makeFile({ uploadedById: "someone-else" }));

      const result = await deleteFile("file-1");

      expect(result.success).toBe(false);
      expect(mockedPrisma.file.update).not.toHaveBeenCalled();
      expect(mockedLogActivity).not.toHaveBeenCalled();
    });

    it("allows the original uploader even without manage permission", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: [], isAssignee: false });
      mockedPrisma.file.findUnique.mockResolvedValue(makeFile({ uploadedById: "user-1" }));

      const result = await deleteFile("file-1");

      expect(result.success).toBe(true);
    });
  });

  describe("8. tenant/ownership rejection", () => {
    it("rejects when the file's entity belongs to a different company", async () => {
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_B, paths: [], isAssignee: false });

      const result = await deleteFile("file-1");

      expect(result.success).toBe(false);
      expect(mockedPrisma.file.update).not.toHaveBeenCalled();
    });

    it("rejects when the file doesn't exist", async () => {
      mockedPrisma.file.findUnique.mockResolvedValue(null);

      const result = await deleteFile("file-1");

      expect(result.success).toBe(false);
      expect(mockedPrisma.file.update).not.toHaveBeenCalled();
    });

    it("rejects when the file's target entity type can't be resolved", async () => {
      mockedResolveEntityTypeFromFile.mockReturnValue(null);

      const result = await deleteFile("file-1");

      expect(result.success).toBe(false);
      expect(mockedPrisma.file.update).not.toHaveBeenCalled();
    });
  });

  describe("9. existing behavior remains intact", () => {
    it("still revalidates every path from the resolved entity context", async () => {
      const { revalidatePath } = await import("next/cache");
      mockedResolveEntityContext.mockResolvedValue({
        companyId: COMPANY_A,
        paths: ["/seo/seo-1/content/content-1", "/seo/seo-1/content"],
        isAssignee: false,
      });

      await deleteFile("file-1");

      expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/content/content-1");
      expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    });

    it("still allows an assignee (task/lead/seoProject/content) to delete even without manage permission", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: [], isAssignee: true });
      mockedPrisma.file.findUnique.mockResolvedValue(makeFile({ uploadedById: "someone-else" }));

      const result = await deleteFile("file-1");

      expect(result.success).toBe(true);
    });
  });
});

describe("restoreFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedPrisma.file.findUnique.mockResolvedValue(makeFile({ deletedAt: new Date() }));
    mockedResolveEntityTypeFromFile.mockReturnValue("content");
    mockedGetEntityIdFromFile.mockReturnValue("content-1");
    mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: ["/seo/seo-1/content/content-1"], isAssignee: false });
    mockedCanManageEntityFiles.mockReturnValue(true);
    mockedBuildActivityRefs.mockReturnValue({ contentId: "content-1" });
    mockedPrisma.file.update.mockResolvedValue({ ...makeFile(), deletedAt: null });
  });

  describe("1. successful restore", () => {
    it("returns a successful ActionResult", async () => {
      const result = await restoreFile("file-1");
      expect(result.success).toBe(true);
    });
  });

  describe("2. sets deletedAt to null, nothing else", () => {
    it("calls file.update with deletedAt: null only", async () => {
      await restoreFile("file-1");
      const [{ data }] = mockedPrisma.file.update.mock.calls[0];
      expect(data).toEqual({ deletedAt: null });
    });

    it("targets the correct file id", async () => {
      await restoreFile("file-1");
      expect(mockedPrisma.file.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "file-1" } })
      );
    });
  });

  describe("3. never touches storage", () => {
    it("does not call storage.delete()", async () => {
      await restoreFile("file-1");
      expect(mockedStorage.delete).not.toHaveBeenCalled();
    });

    it("does not call storage.save()", async () => {
      await restoreFile("file-1");
      expect(mockedStorage.save).not.toHaveBeenCalled();
    });
  });

  describe("4. never hard-deletes or re-parents the row", () => {
    it("never calls prisma.file.delete()", async () => {
      await restoreFile("file-1");
      expect(mockedPrisma.file.delete).not.toHaveBeenCalled();
    });
  });

  describe("5. Activity is logged with the correct entity references", () => {
    it("logs file.restored with the resolved entity refs and safe metadata", async () => {
      await restoreFile("file-1");
      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: "user-1",
        action: "file.restored",
        companyId: COMPANY_A,
        metadata: { fileId: "file-1", fileName: "report.pdf", entityType: "content" },
        contentId: "content-1",
      });
    });

    it("reuses buildActivityRefs rather than duplicating entity-ref logic", async () => {
      await restoreFile("file-1");
      expect(mockedBuildActivityRefs).toHaveBeenCalledWith("content", "content-1");
    });
  });

  describe("6. permission — mirrors deleteFile's authorization exactly", () => {
    it("denies when canManageEntityFiles is false and the actor isn't the uploader or an assignee", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: [], isAssignee: false });
      mockedPrisma.file.findUnique.mockResolvedValue(makeFile({ uploadedById: "someone-else", deletedAt: new Date() }));

      const result = await restoreFile("file-1");

      expect(result.success).toBe(false);
      expect(mockedPrisma.file.update).not.toHaveBeenCalled();
      expect(mockedLogActivity).not.toHaveBeenCalled();
    });

    it("allows the original uploader even without manage permission", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: [], isAssignee: false });
      mockedPrisma.file.findUnique.mockResolvedValue(makeFile({ uploadedById: "user-1", deletedAt: new Date() }));

      const result = await restoreFile("file-1");

      expect(result.success).toBe(true);
    });

    it("allows an assignee (task/lead/seoProject/content) to restore even without manage permission", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: [], isAssignee: true });
      mockedPrisma.file.findUnique.mockResolvedValue(makeFile({ uploadedById: "someone-else", deletedAt: new Date() }));

      const result = await restoreFile("file-1");

      expect(result.success).toBe(true);
    });
  });

  describe("7. tenant/ownership rejection", () => {
    it("rejects when the file's entity belongs to a different company", async () => {
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_B, paths: [], isAssignee: false });

      const result = await restoreFile("file-1");

      expect(result.success).toBe(false);
      expect(mockedPrisma.file.update).not.toHaveBeenCalled();
    });

    it("rejects when the file doesn't exist", async () => {
      mockedPrisma.file.findUnique.mockResolvedValue(null);

      const result = await restoreFile("file-1");

      expect(result.success).toBe(false);
      expect(mockedPrisma.file.update).not.toHaveBeenCalled();
    });

    it("rejects when the file's target entity type can't be resolved", async () => {
      mockedResolveEntityTypeFromFile.mockReturnValue(null);

      const result = await restoreFile("file-1");

      expect(result.success).toBe(false);
      expect(mockedPrisma.file.update).not.toHaveBeenCalled();
    });
  });

  describe("8. revalidation", () => {
    it("revalidates every path from the resolved entity context", async () => {
      const { revalidatePath } = await import("next/cache");
      mockedResolveEntityContext.mockResolvedValue({
        companyId: COMPANY_A,
        paths: ["/seo/seo-1/content/content-1", "/seo/seo-1/content"],
        isAssignee: false,
      });

      await restoreFile("file-1");

      expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/content/content-1");
      expect(revalidatePath).toHaveBeenCalledWith("/seo/seo-1/content");
    });
  });
});
