import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: { save: vi.fn(), delete: vi.fn() } }));
vi.mock("@/features/reports/services/report.service", () => ({
  REPORT_COMPUTE: {
    PROJECT_SUMMARY: vi.fn(),
    CLIENT_SUMMARY: vi.fn(),
    FINANCIAL: vi.fn(),
    SALES_PIPELINE: vi.fn(),
    SEO_PERFORMANCE: vi.fn(),
    SEO_AUDIT: vi.fn(),
  },
}));

type MockPrisma = {
  report: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  file: { create: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    report: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    file: { create: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { storage } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { REPORT_COMPUTE } from "@/features/reports/services/report.service";
import { generateReport, archiveReport, restoreReport } from "@/features/reports/actions/report.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedStorage = storage as unknown as { save: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
const mockedPrisma = prisma as unknown as MockPrisma;
const mockedCompute = REPORT_COMPUTE as unknown as Record<string, ReturnType<typeof vi.fn>>;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const MANAGER = { id: "user-1", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-2", role: "EMPLOYEE", companyId: COMPANY_A };

function makeReportData(overrides: Partial<Record<string, unknown>> = {}) {
  return { summaryCards: [], columns: ["Name", "Status"], rows: [["Alpha", "Active"]], ...overrides };
}

function makeGenerateFormData(fields: Record<string, string | undefined> = {}) {
  const formData = new FormData();
  const merged = { type: "PROJECT_SUMMARY", title: "Q1 Report", ...fields };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) formData.set(key, value);
  }
  return formData;
}

function makeCustomFormData({
  title = "Custom Report",
  notes,
  fileName,
  mimeType = "text/csv",
  content = "custom file contents",
}: {
  title?: string;
  notes?: string;
  fileName?: string;
  mimeType?: string;
  content?: string | Uint8Array;
} = {}) {
  const formData = new FormData();
  formData.set("type", "CUSTOM");
  formData.set("title", title);
  if (notes !== undefined) formData.set("notes", notes);
  if (fileName) {
    formData.set("file", new File([content] as BlobPart[], fileName, { type: mimeType }));
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(MANAGER);
  mockedCompute.PROJECT_SUMMARY.mockResolvedValue(makeReportData());
  mockedCompute.CLIENT_SUMMARY.mockResolvedValue(makeReportData());
  mockedCompute.FINANCIAL.mockResolvedValue(makeReportData());
  mockedCompute.SALES_PIPELINE.mockResolvedValue(makeReportData());
  mockedCompute.SEO_PERFORMANCE.mockResolvedValue(makeReportData());
  mockedCompute.SEO_AUDIT.mockResolvedValue(makeReportData());
  mockedStorage.save.mockResolvedValue({ key: "uploads/report-key.csv", sizeBytes: 42 });
  mockedStorage.delete.mockResolvedValue(undefined);
  mockedPrisma.file.create.mockResolvedValue({ id: "file-1" });
  mockedPrisma.report.create.mockResolvedValue({ id: "report-1" });
  mockedPrisma.report.update.mockResolvedValue({ id: "report-1" });
  mockedPrisma.report.findUnique.mockResolvedValue({ id: "report-1", companyId: COMPANY_A });
});

describe("generateReport — authorization and validation", () => {
  it("1. rejects an EMPLOYEE — below the manageReports (MANAGER) minimum", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await generateReport(makeGenerateFormData());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedCompute.PROJECT_SUMMARY).not.toHaveBeenCalled();
    expect(mockedPrisma.report.create).not.toHaveBeenCalled();
  });

  it("2. rejects invalid input (title too short) before any compute/storage/db work", async () => {
    const result = await generateReport(makeGenerateFormData({ title: "A" }));
    expect(result.success).toBe(false);
    expect(mockedCompute.PROJECT_SUMMARY).not.toHaveBeenCalled();
    expect(mockedPrisma.report.create).not.toHaveBeenCalled();
  });

  it("3. rejects an SEO Audit report with no scopeId, without ever calling compute", async () => {
    const result = await generateReport(makeGenerateFormData({ type: "SEO_AUDIT" }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Select an SEO project to generate an SEO Audit Report.");
    expect(mockedCompute.SEO_AUDIT).not.toHaveBeenCalled();
    expect(mockedPrisma.report.create).not.toHaveBeenCalled();
  });
});

describe("generateReport — CUSTOM path", () => {
  it("1. rejects an oversized attachment without creating a report", async () => {
    const formData = makeCustomFormData({ fileName: "big.csv", content: new Uint8Array(10 * 1024 * 1024 + 1) });
    const result = await generateReport(formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("File exceeds the 10MB size limit.");
    expect(mockedPrisma.report.create).not.toHaveBeenCalled();
  });

  it("2. rejects an unsupported attachment MIME type without creating a report", async () => {
    const formData = makeCustomFormData({ fileName: "malware.exe", mimeType: "application/x-msdownload" });
    const result = await generateReport(formData);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("This file type is not supported.");
    expect(mockedPrisma.report.create).not.toHaveBeenCalled();
  });

  it("3. creates a CUSTOM report with fileId: null when no attachment is provided", async () => {
    const result = await generateReport(makeCustomFormData({ notes: "no attachment here" }));
    expect(result.success).toBe(true);
    expect(mockedStorage.save).not.toHaveBeenCalled();
    const [{ data }] = mockedPrisma.report.create.mock.calls[0];
    expect(data.fileId).toBeNull();
    expect(data.type).toBe("CUSTOM");
    expect(data.status).toBe("COMPLETED");
    expect(data.parameters).toEqual({ notes: "no attachment here" });
  });

  it("4. saves a provided attachment to storage and links it via fileId", async () => {
    mockedStorage.save.mockResolvedValue({ key: "uploads/custom-1.csv", sizeBytes: 21 });
    mockedPrisma.file.create.mockResolvedValue({ id: "custom-file-1" });

    await generateReport(makeCustomFormData({ fileName: "notes.csv", content: "a,b,c" }));

    expect(mockedStorage.save).toHaveBeenCalledTimes(1);
    const [saveArgs] = mockedStorage.save.mock.calls[0];
    expect(saveArgs.fileName).toBe("notes.csv");
    expect(saveArgs.mimeType).toBe("text/csv");
    expect(saveArgs.buffer.toString("utf-8")).toBe("a,b,c");

    expect(mockedPrisma.file.create).toHaveBeenCalledWith({
      data: {
        uploadedById: MANAGER.id,
        fileName: "notes.csv",
        url: "uploads/custom-1.csv",
        mimeType: "text/csv",
        sizeBytes: 21,
      },
    });

    const [{ data }] = mockedPrisma.report.create.mock.calls[0];
    expect(data.fileId).toBe("custom-file-1");
  });

  it("5. logs report.generated with type CUSTOM", async () => {
    mockedPrisma.report.create.mockResolvedValue({ id: "custom-report-1" });
    await generateReport(makeCustomFormData());
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "report.generated",
      companyId: COMPANY_A,
      metadata: { reportId: "custom-report-1", type: "CUSTOM" },
    });
  });

  // Documents the CURRENT production behavior rather than an assumption: unlike
  // the compute-based path below, the CUSTOM path has no try/catch around its
  // prisma.report.create call, so a DB failure here does NOT roll back a
  // storage object that was already saved. This is a real asymmetry in the
  // existing implementation — flagged separately in the Stage 8 report, not
  // something this test suite changes or silently "fixes."
  it("6. [documents existing behavior] does NOT call storage.delete if report.create fails after a custom attachment was already saved", async () => {
    mockedPrisma.file.create.mockResolvedValue({ id: "custom-file-1" });
    mockedPrisma.report.create.mockRejectedValue(new Error("db write failed"));

    await expect(
      generateReport(makeCustomFormData({ fileName: "notes.csv" }))
    ).rejects.toThrow("db write failed");

    expect(mockedStorage.delete).not.toHaveBeenCalled();
  });
});

describe("generateReport — compute failure (before any storage write)", () => {
  it("1. creates a FAILED report row and returns the thrown error's message, without ever touching storage", async () => {
    mockedCompute.PROJECT_SUMMARY.mockRejectedValue(new Error("query timed out"));

    const result = await generateReport(makeGenerateFormData({ scopeId: "project-1" }));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("query timed out");
    expect(mockedStorage.save).not.toHaveBeenCalled();
    expect(mockedStorage.delete).not.toHaveBeenCalled();
    expect(mockedPrisma.report.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_A,
        generatedById: MANAGER.id,
        title: "Q1 Report",
        type: "PROJECT_SUMMARY",
        status: "FAILED",
        parameters: { scopeId: "project-1" },
      },
    });
  });

  it("2. falls back to a generic message when a non-Error value is thrown", async () => {
    mockedCompute.PROJECT_SUMMARY.mockRejectedValue("not an Error instance");
    const result = await generateReport(makeGenerateFormData());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Failed to generate report.");
  });
});

describe("generateReport — storage rollback on DB failure AFTER a successful storage.save (high priority)", () => {
  it("1. rolls back storage with the exact saved key when prisma.file.create fails", async () => {
    mockedStorage.save.mockResolvedValue({ key: "uploads/rollback-target.csv", sizeBytes: 7 });
    mockedPrisma.file.create.mockRejectedValue(new Error("file insert failed"));

    const result = await generateReport(makeGenerateFormData());

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("file insert failed");
    expect(mockedStorage.delete).toHaveBeenCalledWith("uploads/rollback-target.csv");
    expect(mockedStorage.delete).toHaveBeenCalledTimes(1);
  });

  it("2. rolls back storage with the exact saved key when prisma.report.create fails (after file.create succeeded)", async () => {
    mockedStorage.save.mockResolvedValue({ key: "uploads/rollback-target-2.csv", sizeBytes: 9 });
    mockedPrisma.file.create.mockResolvedValue({ id: "file-99" });
    mockedPrisma.report.create
      .mockRejectedValueOnce(new Error("report insert failed"))
      .mockResolvedValueOnce({ id: "failed-report-1" });

    const result = await generateReport(makeGenerateFormData());

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("report insert failed");
    expect(mockedStorage.delete).toHaveBeenCalledWith("uploads/rollback-target-2.csv");
  });

  it("3. writes a FAILED report row after the rollback, and does not falsely report success", async () => {
    mockedPrisma.file.create.mockRejectedValue(new Error("file insert failed"));

    const result = await generateReport(makeGenerateFormData({ scopeId: "project-1" }));

    expect(result.success).toBe(false);
    expect(mockedPrisma.report.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_A,
        generatedById: MANAGER.id,
        title: "Q1 Report",
        type: "PROJECT_SUMMARY",
        status: "FAILED",
        parameters: { scopeId: "project-1" },
      },
    });
  });

  it("4. falls back to a generic save-failure message when a non-Error value is thrown after storage.save", async () => {
    mockedPrisma.file.create.mockRejectedValue("not an Error instance");
    const result = await generateReport(makeGenerateFormData());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Failed to save the generated report.");
  });

  it("5. does NOT call storage.delete on the successful path", async () => {
    const result = await generateReport(makeGenerateFormData());
    expect(result.success).toBe(true);
    expect(mockedStorage.delete).not.toHaveBeenCalled();
  });
});

describe("generateReport — successful compute-based generation", () => {
  it("1. computes using the actor's own companyId (never a client-supplied one) and the given scopeId", async () => {
    await generateReport(makeGenerateFormData({ scopeId: "project-1" }));
    expect(mockedCompute.PROJECT_SUMMARY).toHaveBeenCalledWith(COMPANY_A, "project-1");
  });

  it("2. generates the CSV from the computed columns/rows and saves it under a slugified filename", async () => {
    mockedCompute.PROJECT_SUMMARY.mockResolvedValue(
      makeReportData({ columns: ["Name"], rows: [["Alpha"]] })
    );

    await generateReport(makeGenerateFormData({ title: "Q1 Project Report!" }));

    const [args] = mockedStorage.save.mock.calls[0];
    expect(args.fileName).toBe("q1-project-report.csv");
    expect(args.mimeType).toBe("text/csv");
    expect(args.buffer.toString("utf-8")).toBe("Name\nAlpha");
  });

  it("3. creates the File row with the storage key/size, then the Report row with matching parameters", async () => {
    mockedStorage.save.mockResolvedValue({ key: "uploads/psum.csv", sizeBytes: 55 });
    mockedPrisma.file.create.mockResolvedValue({ id: "file-55" });
    const data = makeReportData({ columns: ["Name"], rows: [["Alpha"]] });
    mockedCompute.PROJECT_SUMMARY.mockResolvedValue(data);

    await generateReport(makeGenerateFormData({ scopeId: "project-1" }));

    expect(mockedPrisma.file.create).toHaveBeenCalledWith({
      data: {
        uploadedById: MANAGER.id,
        fileName: "q1-report.csv",
        url: "uploads/psum.csv",
        mimeType: "text/csv",
        sizeBytes: 55,
      },
    });
    const [{ data: reportData }] = mockedPrisma.report.create.mock.calls[0];
    expect(reportData.fileId).toBe("file-55");
    expect(reportData.status).toBe("COMPLETED");
    expect(reportData.parameters).toEqual({ ...data, scopeId: "project-1" });
    expect(reportData.generatedAt).toBeInstanceOf(Date);
  });

  it("4. sets projectId (and no other scope FK) for a project-scoped report", async () => {
    await generateReport(makeGenerateFormData({ type: "PROJECT_SUMMARY", scopeId: "project-1" }));
    const [{ data }] = mockedPrisma.report.create.mock.calls[0];
    expect(data.projectId).toBe("project-1");
    expect(data.clientId).toBeUndefined();
    expect(data.seoProjectId).toBeUndefined();
  });

  it("5. sets clientId (and no other scope FK) for a client-scoped report", async () => {
    await generateReport(makeGenerateFormData({ type: "CLIENT_SUMMARY", scopeId: "client-1" }));
    const [{ data }] = mockedPrisma.report.create.mock.calls[0];
    expect(data.clientId).toBe("client-1");
    expect(data.projectId).toBeUndefined();
    expect(data.seoProjectId).toBeUndefined();
  });

  it("6. sets seoProjectId (and no other scope FK) for an SEO-project-scoped report", async () => {
    await generateReport(makeGenerateFormData({ type: "SEO_PERFORMANCE", scopeId: "seo-1" }));
    const [{ data }] = mockedPrisma.report.create.mock.calls[0];
    expect(data.seoProjectId).toBe("seo-1");
    expect(data.projectId).toBeUndefined();
    expect(data.clientId).toBeUndefined();
  });

  it("7. sets no scope FK at all for an unscoped report (Sales Pipeline)", async () => {
    await generateReport(makeGenerateFormData({ type: "SALES_PIPELINE" }));
    const [{ data }] = mockedPrisma.report.create.mock.calls[0];
    expect(data.projectId).toBeUndefined();
    expect(data.clientId).toBeUndefined();
    expect(data.seoProjectId).toBeUndefined();
  });

  it("8. logs report.generated with the actual report type", async () => {
    mockedPrisma.report.create.mockResolvedValue({ id: "report-77" });
    await generateReport(makeGenerateFormData({ type: "FINANCIAL", scopeId: "client-1" }));
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "report.generated",
      companyId: COMPANY_A,
      metadata: { reportId: "report-77", type: "FINANCIAL" },
    });
  });

  it("9. returns the new report's id", async () => {
    mockedPrisma.report.create.mockResolvedValue({ id: "report-77" });
    const result = await generateReport(makeGenerateFormData());
    expect(result).toEqual({ success: true, data: { id: "report-77" } });
  });
});

describe("generateReport — defensive fallback for an unregistered report type", () => {
  it("returns 'This report type is not yet available.' and performs no mutation when REPORT_COMPUTE has no entry for the validated type", async () => {
    // SUPPORTED_REPORT_TYPES always maps to a REPORT_COMPUTE entry today, so this
    // branch is not reachable through real schema-validated input — it's a
    // defensive guard for a future type added to the schema without also being
    // registered here. Simulating that gap directly protects the guard itself.
    const original = mockedCompute.PROJECT_SUMMARY;
    delete mockedCompute.PROJECT_SUMMARY;

    const result = await generateReport(makeGenerateFormData());

    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("This report type is not yet available.");
    expect(mockedPrisma.report.create).not.toHaveBeenCalled();
    expect(mockedStorage.save).not.toHaveBeenCalled();

    mockedCompute.PROJECT_SUMMARY = original;
  });
});

describe("archiveReport", () => {
  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await archiveReport("report-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.report.update).not.toHaveBeenCalled();
  });

  it("2. returns 'Report not found.' for a missing report", async () => {
    mockedPrisma.report.findUnique.mockResolvedValue(null);
    const result = await archiveReport("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Report not found.");
    expect(mockedPrisma.report.update).not.toHaveBeenCalled();
  });

  it("3. returns 'Report not found.' for a cross-company report (tenant isolation)", async () => {
    mockedPrisma.report.findUnique.mockResolvedValue({ id: "report-1", companyId: COMPANY_B });
    const result = await archiveReport("report-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Report not found.");
    expect(mockedPrisma.report.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to a Date instance and logs report.archived", async () => {
    const result = await archiveReport("report-1");

    expect(mockedPrisma.report.update).toHaveBeenCalledWith({
      where: { id: "report-1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "report.archived",
      companyId: COMPANY_A,
      metadata: { reportId: "report-1" },
    });
    expect(result.success).toBe(true);
  });
});

describe("restoreReport", () => {
  it("1. rejects an EMPLOYEE", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await restoreReport("report-1");
    expect(result.success).toBe(false);
    expect(mockedPrisma.report.update).not.toHaveBeenCalled();
  });

  it("2. returns 'Report not found.' for a missing report", async () => {
    mockedPrisma.report.findUnique.mockResolvedValue(null);
    const result = await restoreReport("missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Report not found.");
    expect(mockedPrisma.report.update).not.toHaveBeenCalled();
  });

  it("3. returns 'Report not found.' for a cross-company report (tenant isolation)", async () => {
    mockedPrisma.report.findUnique.mockResolvedValue({ id: "report-1", companyId: COMPANY_B });
    const result = await restoreReport("report-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Report not found.");
    expect(mockedPrisma.report.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to null and logs report.restored", async () => {
    const result = await restoreReport("report-1");

    expect(mockedPrisma.report.update).toHaveBeenCalledWith({
      where: { id: "report-1" },
      data: { deletedAt: null },
    });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: MANAGER.id,
      action: "report.restored",
      companyId: COMPANY_A,
      metadata: { reportId: "report-1" },
    });
    expect(result.success).toBe(true);
  });
});
