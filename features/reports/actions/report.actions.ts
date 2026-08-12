"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity";
import {
  actionError,
  actionSuccess,
  type ActionResult,
} from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "@/features/files/schemas/file.schema";
import {
  generateReportSchema,
  getScopeKind,
} from "@/features/reports/schemas/report.schema";
import { REPORT_COMPUTE } from "@/features/reports/services/report.service";
import { toCsv } from "@/lib/csv";

function slugify(title: string) {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

async function saveOptionalAttachment(actorId: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { fileRecordId: null as string | null, error: null as string | null };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { fileRecordId: null, error: "File exceeds the 10MB size limit." };
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { fileRecordId: null, error: "This file type is not supported." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = await storage.save({ buffer, fileName: file.name, mimeType: file.type });
  const record = await prisma.file.create({
    data: {
      uploadedById: actorId,
      fileName: file.name,
      url: saved.key,
      mimeType: file.type,
      sizeBytes: saved.sizeBytes,
    },
  });
  return { fileRecordId: record.id, error: null };
}

export async function generateReport(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  if (!Permissions.manageReports(actor.role)) {
    return actionError("You do not have permission to generate reports.");
  }

  const parsed = generateReportSchema.safeParse({
    type: formData.get("type"),
    title: formData.get("title"),
    scopeId: formData.get("scopeId") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const { type, title, scopeId, notes } = parsed.data;
  const scopeKind = getScopeKind(type);

  if (scopeKind === "custom") {
    const attachment = await saveOptionalAttachment(actor.id, formData);
    if (attachment.error) {
      return actionError(attachment.error);
    }

    const report = await prisma.report.create({
      data: {
        companyId: actor.companyId,
        generatedById: actor.id,
        title,
        type: "CUSTOM",
        status: "COMPLETED",
        parameters: { notes: notes ?? null } satisfies Prisma.InputJsonValue,
        fileId: attachment.fileRecordId,
        generatedAt: new Date(),
      },
    });

    await logActivity({
      actorId: actor.id,
      action: "report.generated",
      companyId: actor.companyId,
      metadata: { reportId: report.id, type: "CUSTOM" },
    });

    revalidatePath("/reports");
    return actionSuccess({ id: report.id });
  }

  const compute = REPORT_COMPUTE[type];
  if (!compute) {
    return actionError("This report type is not yet available.");
  }

  let data;
  try {
    data = await compute(actor.companyId, scopeId || undefined);
  } catch (error) {
    await prisma.report.create({
      data: {
        companyId: actor.companyId,
        generatedById: actor.id,
        title,
        type,
        status: "FAILED",
        parameters: { scopeId: scopeId ?? null } satisfies Prisma.InputJsonValue,
      },
    });
    revalidatePath("/reports");
    return actionError(
      error instanceof Error ? error.message : "Failed to generate report."
    );
  }

  const csv = toCsv(data.columns, data.rows);
  const saved = await storage.save({
    buffer: Buffer.from(csv, "utf-8"),
    fileName: `${slugify(title)}.csv`,
    mimeType: "text/csv",
  });

  try {
    const file = await prisma.file.create({
      data: {
        uploadedById: actor.id,
        fileName: `${slugify(title)}.csv`,
        url: saved.key,
        mimeType: "text/csv",
        sizeBytes: saved.sizeBytes,
      },
    });

    const report = await prisma.report.create({
      data: {
        companyId: actor.companyId,
        generatedById: actor.id,
        title,
        type,
        status: "COMPLETED",
        parameters: { ...data, scopeId: scopeId ?? null } satisfies Prisma.InputJsonValue,
        fileId: file.id,
        generatedAt: new Date(),
        ...(scopeKind === "project" && scopeId ? { projectId: scopeId } : {}),
        ...(scopeKind === "client" && scopeId ? { clientId: scopeId } : {}),
        ...(scopeKind === "seoProject" && scopeId ? { seoProjectId: scopeId } : {}),
      },
    });

    await logActivity({
      actorId: actor.id,
      action: "report.generated",
      companyId: actor.companyId,
      metadata: { reportId: report.id, type },
    });

    revalidatePath("/reports");
    return actionSuccess({ id: report.id });
  } catch (error) {
    await storage.delete(saved.key);
    await prisma.report.create({
      data: {
        companyId: actor.companyId,
        generatedById: actor.id,
        title,
        type,
        status: "FAILED",
        parameters: { scopeId: scopeId ?? null } satisfies Prisma.InputJsonValue,
      },
    });
    revalidatePath("/reports");
    return actionError(
      error instanceof Error ? error.message : "Failed to save the generated report."
    );
  }
}

export async function archiveReport(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageReports(actor.role)) {
    return actionError("You do not have permission to archive reports.");
  }

  const existing = await prisma.report.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Report not found.");
  }

  await prisma.report.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    actorId: actor.id,
    action: "report.archived",
    companyId: actor.companyId,
    metadata: { reportId: id },
  });

  revalidatePath("/reports");
  return actionSuccess();
}

export async function restoreReport(id: string): Promise<ActionResult> {
  const actor = await requireUser();

  if (!Permissions.manageReports(actor.role)) {
    return actionError("You do not have permission to restore reports.");
  }

  const existing = await prisma.report.findUnique({ where: { id } });
  if (!existing || existing.companyId !== actor.companyId) {
    return actionError("Report not found.");
  }

  await prisma.report.update({ where: { id }, data: { deletedAt: null } });

  await logActivity({
    actorId: actor.id,
    action: "report.restored",
    companyId: actor.companyId,
    metadata: { reportId: id },
  });

  revalidatePath("/reports");
  return actionSuccess();
}
