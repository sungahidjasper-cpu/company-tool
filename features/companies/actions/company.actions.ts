"use server";

import { revalidatePath } from "next/cache";

import type { User as SessionUser } from "next-auth";

import { logActivity } from "@/lib/activity";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { hasMinimumRole, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import {
  companySchema,
  type CompanyInput,
} from "@/features/companies/schemas/company.schema";

function canEditCompany(user: SessionUser, companyId: string) {
  return (
    Permissions.manageCompanies(user.role) ||
    (hasMinimumRole(user.role, "ADMIN") && user.companyId === companyId)
  );
}

export async function createCompany(
  input: CompanyInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();

  if (!Permissions.manageCompanies(user.role)) {
    return actionError("Only a Super Admin can create companies.");
  }

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const existingSlug = await prisma.company.findUnique({
    where: { slug: parsed.data.slug },
  });
  if (existingSlug) {
    return actionError("That slug is already in use.");
  }

  const company = await prisma.company.create({ data: parsed.data });

  await logActivity({
    actorId: user.id,
    action: "company.created",
    metadata: { companyId: company.id, name: company.name },
  });

  revalidatePath("/companies");
  return actionSuccess({ id: company.id });
}

export async function updateCompany(
  id: string,
  input: CompanyInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();

  if (!canEditCompany(user, id)) {
    return actionError("You do not have permission to edit this company.");
  }

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const existingSlug = await prisma.company.findFirst({
    where: { slug: parsed.data.slug, id: { not: id } },
  });
  if (existingSlug) {
    return actionError("That slug is already in use.");
  }

  const company = await prisma.company.update({
    where: { id },
    data: parsed.data,
  });

  await logActivity({
    actorId: user.id,
    action: "company.updated",
    metadata: { companyId: company.id, name: company.name },
  });

  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  return actionSuccess({ id: company.id });
}

export async function archiveCompany(id: string): Promise<ActionResult> {
  const user = await requireUser();

  if (!Permissions.manageCompanies(user.role)) {
    return actionError("Only a Super Admin can archive companies.");
  }

  const company = await prisma.company.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await logActivity({
    actorId: user.id,
    action: "company.archived",
    metadata: { companyId: company.id, name: company.name },
  });

  revalidatePath("/companies");
  return actionSuccess();
}

export async function restoreCompany(id: string): Promise<ActionResult> {
  const user = await requireUser();

  if (!Permissions.manageCompanies(user.role)) {
    return actionError("Only a Super Admin can restore companies.");
  }

  const company = await prisma.company.update({
    where: { id },
    data: { deletedAt: null },
  });

  await logActivity({
    actorId: user.id,
    action: "company.restored",
    metadata: { companyId: company.id, name: company.name },
  });

  revalidatePath("/companies");
  return actionSuccess();
}
