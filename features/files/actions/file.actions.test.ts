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
  buildEntityWhere: vi.fn(),
  getFileNotificationRecipients: vi.fn(),
}));

type MockPrisma = {
  file: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    file: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn() },
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
  buildEntityWhere,
  getFileNotificationRecipients,
} from "@/features/files/services/entity-target";
import { createNotification } from "@/features/notifications/services/notification.service";
import { uploadFile, deleteFile, restoreFile } from "@/features/files/actions/file.actions";
import { MAX_FILE_SIZE_BYTES } from "@/features/files/schemas/file.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedStorage = storage as unknown as { save: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedResolveEntityTypeFromFile = resolveEntityTypeFromFile as unknown as ReturnType<typeof vi.fn>;
const mockedGetEntityIdFromFile = getEntityIdFromFile as unknown as ReturnType<typeof vi.fn>;
const mockedResolveEntityContext = resolveEntityContext as unknown as ReturnType<typeof vi.fn>;
const mockedCanManageEntityFiles = canManageEntityFiles as unknown as ReturnType<typeof vi.fn>;
const mockedBuildActivityRefs = buildActivityRefs as unknown as ReturnType<typeof vi.fn>;
const mockedBuildEntityWhere = buildEntityWhere as unknown as ReturnType<typeof vi.fn>;
const mockedGetFileNotificationRecipients = getFileNotificationRecipients as unknown as ReturnType<typeof vi.fn>;
const mockedCreateNotification = createNotification as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A, firstName: "Morgan" };

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

function makeUploadFormData({
  entityType = "project",
  entityId = "entity-1",
  fileName = "report.pdf",
  mimeType = "application/pdf",
  content,
}: {
  entityType?: string;
  entityId?: string;
  fileName?: string;
  mimeType?: string;
  content?: string | Uint8Array;
} = {}) {
  const formData = new FormData();
  formData.set("entityType", entityType);
  formData.set("entityId", entityId);
  formData.set("file", new File([content ?? "file contents"] as BlobPart[], fileName, { type: mimeType }));
  return formData;
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

describe("uploadFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(MANAGER);
    mockedResolveEntityContext.mockResolvedValue({
      companyId: COMPANY_A,
      paths: ["/projects/entity-1"],
      isAssignee: false,
    });
    mockedCanManageEntityFiles.mockReturnValue(true);
    mockedBuildEntityWhere.mockReturnValue({ projectId: "entity-1" });
    mockedBuildActivityRefs.mockReturnValue({ projectId: "entity-1" });
    mockedGetFileNotificationRecipients.mockResolvedValue([]);
    mockedStorage.save.mockResolvedValue({ key: "uploads/generated-key.pdf", sizeBytes: 13 });
    mockedPrisma.file.create.mockResolvedValue({ id: "new-file-1", fileName: "report.pdf" });
  });

  describe("1. upfront validation — rejected before entity resolution", () => {
    it("rejects an invalid entityType", async () => {
      const formData = makeUploadFormData({ entityType: "not-a-real-type" });
      const result = await uploadFile(formData);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Invalid upload target.");
      expect(mockedResolveEntityContext).not.toHaveBeenCalled();
    });

    it("rejects when no file is provided", async () => {
      const formData = makeUploadFormData();
      formData.set("file", "not-a-file");
      const result = await uploadFile(formData);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("No file provided.");
      expect(mockedResolveEntityContext).not.toHaveBeenCalled();
    });
  });

  describe("2. file validation", () => {
    it("rejects an empty file, before entity resolution or any side effect", async () => {
      const formData = makeUploadFormData({ content: "" });
      const result = await uploadFile(formData);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("The selected file is empty.");
      expect(mockedResolveEntityContext).not.toHaveBeenCalled();
      expect(mockedStorage.save).not.toHaveBeenCalled();
      expect(mockedPrisma.file.create).not.toHaveBeenCalled();
    });

    it("rejects a file over the 10MB limit", async () => {
      const formData = makeUploadFormData({ content: new Uint8Array(MAX_FILE_SIZE_BYTES + 1) });
      const result = await uploadFile(formData);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("File exceeds the 10MB size limit.");
      expect(mockedResolveEntityContext).not.toHaveBeenCalled();
      expect(mockedStorage.save).not.toHaveBeenCalled();
      expect(mockedPrisma.file.create).not.toHaveBeenCalled();
    });

    it("rejects a MIME type outside the allow-list", async () => {
      const formData = makeUploadFormData({ mimeType: "application/x-msdownload" });
      const result = await uploadFile(formData);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("This file type is not supported.");
      expect(mockedResolveEntityContext).not.toHaveBeenCalled();
      expect(mockedStorage.save).not.toHaveBeenCalled();
      expect(mockedPrisma.file.create).not.toHaveBeenCalled();
    });
  });

  describe("3. entity resolution / tenant isolation", () => {
    it("rejects when the target entity cannot be resolved", async () => {
      mockedResolveEntityContext.mockResolvedValue(null);
      const result = await uploadFile(makeUploadFormData());

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("Target record not found.");
      expect(mockedStorage.save).not.toHaveBeenCalled();
      expect(mockedPrisma.file.create).not.toHaveBeenCalled();
      expect(mockedLogActivity).not.toHaveBeenCalled();
      expect(mockedCreateNotification).not.toHaveBeenCalled();
    });

    it("rejects when the resolved entity belongs to a different company than the actor (tenant isolation) — the production companyId comparison runs for real", async () => {
      mockedResolveEntityContext.mockResolvedValue({
        companyId: COMPANY_B,
        paths: ["/projects/entity-1"],
        isAssignee: false,
      });
      const result = await uploadFile(makeUploadFormData());

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("You do not have access to this record.");
      expect(mockedStorage.save).not.toHaveBeenCalled();
      expect(mockedPrisma.file.create).not.toHaveBeenCalled();
      expect(mockedLogActivity).not.toHaveBeenCalled();
      expect(mockedCreateNotification).not.toHaveBeenCalled();
    });
  });

  describe("4. layered authorization — canManageEntityFiles(entityType, role) || (eligible assignee type && isAssignee)", () => {
    it("A. allows upload via the role-based branch alone, for an entity type that is not assignee-eligible", async () => {
      mockedCanManageEntityFiles.mockReturnValue(true);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: ["/projects/entity-1"], isAssignee: false });

      const result = await uploadFile(makeUploadFormData({ entityType: "project" }));

      expect(result.success).toBe(true);
      expect(mockedStorage.save).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.file.create).toHaveBeenCalledTimes(1);
    });

    it("B. allows upload via the assignee branch alone, for an eligible entity type, even when canManageEntityFiles is false", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: ["/projects/task-1"], isAssignee: true });

      const result = await uploadFile(makeUploadFormData({ entityType: "task", entityId: "task-1" }));

      expect(result.success).toBe(true);
      expect(mockedStorage.save).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.file.create).toHaveBeenCalledTimes(1);
    });

    it("C. rejects an assignee on an entity type NOT in the eligible list (task/lead/seoProject/content), even though isAssignee is true", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: ["/projects/entity-1"], isAssignee: true });

      const result = await uploadFile(makeUploadFormData({ entityType: "project" }));

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("You do not have permission to upload files here.");
      expect(mockedStorage.save).not.toHaveBeenCalled();
      expect(mockedPrisma.file.create).not.toHaveBeenCalled();
      expect(mockedLogActivity).not.toHaveBeenCalled();
      expect(mockedCreateNotification).not.toHaveBeenCalled();
    });

    it("D. rejects when neither branch is satisfied — no manage permission and not an assignee", async () => {
      mockedCanManageEntityFiles.mockReturnValue(false);
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: ["/projects/entity-1"], isAssignee: false });

      const result = await uploadFile(makeUploadFormData());

      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe("You do not have permission to upload files here.");
      expect(mockedStorage.save).not.toHaveBeenCalled();
      expect(mockedPrisma.file.create).not.toHaveBeenCalled();
      expect(mockedLogActivity).not.toHaveBeenCalled();
      expect(mockedCreateNotification).not.toHaveBeenCalled();
    });
  });

  describe("5. successful upload — downstream side effects", () => {
    it("saves to storage with the file's actual buffer content, name, and MIME type", async () => {
      await uploadFile(makeUploadFormData({ fileName: "brief.pdf", mimeType: "application/pdf", content: "hello world" }));

      expect(mockedStorage.save).toHaveBeenCalledTimes(1);
      const [args] = mockedStorage.save.mock.calls[0];
      expect(args.fileName).toBe("brief.pdf");
      expect(args.mimeType).toBe("application/pdf");
      expect(Buffer.isBuffer(args.buffer)).toBe(true);
      expect(args.buffer.toString("utf-8")).toBe("hello world");
    });

    it("creates the File record with the uploader, the storage key/size, and the entity-where from buildEntityWhere", async () => {
      mockedStorage.save.mockResolvedValue({ key: "uploads/xyz.pdf", sizeBytes: 999 });
      mockedBuildEntityWhere.mockReturnValue({ projectId: "entity-1" });

      await uploadFile(makeUploadFormData({ fileName: "brief.pdf", mimeType: "application/pdf" }));

      expect(mockedPrisma.file.create).toHaveBeenCalledWith({
        data: {
          uploadedById: MANAGER.id,
          fileName: "brief.pdf",
          url: "uploads/xyz.pdf",
          mimeType: "application/pdf",
          sizeBytes: 999,
          projectId: "entity-1",
        },
      });
    });

    it("logs file.uploaded with the resolved companyId, safe metadata, and buildActivityRefs's entity refs", async () => {
      mockedPrisma.file.create.mockResolvedValue({ id: "new-file-1", fileName: "brief.pdf" });
      mockedBuildActivityRefs.mockReturnValue({ projectId: "entity-1" });

      await uploadFile(makeUploadFormData({ entityType: "project", fileName: "brief.pdf" }));

      expect(mockedLogActivity).toHaveBeenCalledWith({
        actorId: MANAGER.id,
        action: "file.uploaded",
        companyId: COMPANY_A,
        metadata: { fileId: "new-file-1", fileName: "brief.pdf", entityType: "project" },
        projectId: "entity-1",
      });
      expect(mockedBuildActivityRefs).toHaveBeenCalledWith("project", "entity-1");
    });

    it("resolves notification recipients for the target entity and notifies each one", async () => {
      mockedResolveEntityContext.mockResolvedValue({ companyId: COMPANY_A, paths: ["/projects/entity-1"], isAssignee: false });
      mockedGetFileNotificationRecipients.mockResolvedValue(["recipient-1"]);
      mockedPrisma.file.create.mockResolvedValue({ id: "new-file-1", fileName: "brief.pdf" });

      await uploadFile(makeUploadFormData({ entityType: "project", fileName: "brief.pdf" }));

      expect(mockedGetFileNotificationRecipients).toHaveBeenCalledWith("project", "entity-1", MANAGER.id);
      expect(mockedCreateNotification).toHaveBeenCalledWith({
        userId: "recipient-1",
        type: "FILE_UPLOADED",
        message: `${MANAGER.firstName} uploaded "brief.pdf"`,
        link: "/projects/entity-1",
      });
    });

    it("does not notify anyone when there are no recipients", async () => {
      mockedGetFileNotificationRecipients.mockResolvedValue([]);
      await uploadFile(makeUploadFormData());
      expect(mockedCreateNotification).not.toHaveBeenCalled();
    });

    it("revalidates every path from the resolved entity context", async () => {
      const { revalidatePath } = await import("next/cache");
      mockedResolveEntityContext.mockResolvedValue({
        companyId: COMPANY_A,
        paths: ["/projects/entity-1", "/projects"],
        isAssignee: false,
      });

      await uploadFile(makeUploadFormData());

      expect(revalidatePath).toHaveBeenCalledWith("/projects/entity-1");
      expect(revalidatePath).toHaveBeenCalledWith("/projects");
    });

    it("returns the new file's id", async () => {
      mockedPrisma.file.create.mockResolvedValue({ id: "new-file-1", fileName: "brief.pdf" });
      const result = await uploadFile(makeUploadFormData());
      expect(result).toEqual({ success: true, data: { id: "new-file-1" } });
    });
  });
});
