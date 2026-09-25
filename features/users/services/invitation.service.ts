import { createHash, randomBytes } from "node:crypto";

import { logActivity } from "@/lib/activity";
import { sendInvitationEmail } from "@/lib/email/email.service";
import type { UserRole } from "@/lib/generated/prisma/enums";
import { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const TOKEN_BYTES = 32;
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Same token shape as Password Reset (features/auth/services/password-reset.service.ts):
 * a single high-entropy secret hashed with SHA-256 before storage, never the
 * raw value. The raw token exists only in the emailed invitation URL.
 */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

class InvitationInvalidError extends Error {}

/**
 * Prisma 7 + the pg driver adapter has been observed elsewhere in this app
 * (lib/jobs/transient-database-error.ts) to surface some driver-level
 * failures as the generic P2010 with the real Postgres SQLSTATE nested at
 * meta.driverAdapterError.cause.originalCode, rather than as Prisma's own
 * semantic P2002 — checked as a fallback here so a raced User.email unique
 * violation can't silently defeat this guard.
 */
function isEmailUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2002") return true;
  const meta = error.meta as Record<string, unknown> | undefined;
  const adapterCause = (meta?.driverAdapterError as Record<string, unknown> | undefined)?.cause as
    | Record<string, unknown>
    | undefined;
  return adapterCause?.originalCode === "23505";
}

export type CreateInvitationInput = {
  companyId: string;
  invitedById: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
};

export type CreateInvitationResult =
  | { ok: true }
  | { ok: false; reason: "EMAIL_ALREADY_REGISTERED" | "INVITATION_ALREADY_PENDING" | "EMAIL_SEND_FAILED" };

/**
 * Unlike Password Reset's request step, this is an authenticated admin
 * action naming a specific person on purpose — there is no anti-enumeration
 * requirement to hide "this email already has an account" from the admin
 * who is choosing to invite it.
 */
export async function createInvitation(input: CreateInvitationInput, appOrigin: string): Promise<CreateInvitationResult> {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    return { ok: false, reason: "EMAIL_ALREADY_REGISTERED" };
  }

  const pendingInvitation = await prisma.userInvitation.findFirst({
    where: { email: input.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (pendingInvitation) {
    return { ok: false, reason: "INVITATION_ALREADY_PENDING" };
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const invitation = await prisma.userInvitation.create({
    data: {
      companyId: input.companyId,
      invitedById: input.invitedById,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      tokenHash,
      expiresAt,
    },
  });

  const company = await prisma.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { name: true } });
  const inviteUrl = `${appOrigin}/accept-invitation?token=${rawToken}`;
  const result = await sendInvitationEmail({ to: input.email, inviteUrl, firstName: input.firstName, companyName: company.name });

  if (!result.ok) {
    // Never surfaced with provider detail — logged safely, no raw token/URL.
    logger.error("Invitation email could not be sent", { errorType: result.errorType });
    // No Resend Invitation feature exists yet in this MVP, so a dead pending
    // row here would permanently block re-inviting this email (see
    // INVITATION_ALREADY_PENDING above) with no way to recover — removing it
    // lets the admin simply try again.
    await prisma.userInvitation.delete({ where: { id: invitation.id } });
    return { ok: false, reason: "EMAIL_SEND_FAILED" };
  }

  return { ok: true };
}

export type InvitationPreview = { firstName: string; lastName: string; email: string; companyName: string } | null;

/**
 * Read-only lookup for the Accept Invitation page to greet the invitee by
 * name before they submit anything — safe because possession of the raw
 * token already proves legitimate access to this specific invitation; it
 * reveals nothing an attacker couldn't already see by opening the emailed
 * link. Never consumes the invitation.
 */
export async function getInvitationPreview(rawToken: string): Promise<InvitationPreview> {
  const tokenHash = hashToken(rawToken);
  const invitation = await prisma.userInvitation.findFirst({
    where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { company: { select: { name: true } } },
  });
  if (!invitation) return null;

  return {
    firstName: invitation.firstName,
    lastName: invitation.lastName,
    email: invitation.email,
    companyName: invitation.company.name,
  };
}

export type AcceptInvitationResult = { ok: true } | { ok: false; reason: "INVALID_OR_EXPIRED" };

/**
 * Consumes an invitation and creates the real User account in one
 * transaction. The `updateMany` below is the same concurrency guard
 * resetPassword() uses: its WHERE clause (acceptedAt: null, revokedAt: null,
 * expiresAt in the future) is re-checked atomically by Postgres, so a raced
 * double-accept can only ever see count === 1 once.
 */
export async function acceptInvitation(rawToken: string, password: string): Promise<AcceptInvitationResult> {
  const tokenHash = hashToken(rawToken);
  const passwordHash = await hashPassword(password);

  try {
    const userId = await prisma.$transaction(async (tx) => {
      const consumed = await tx.userInvitation.updateMany({
        where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new InvitationInvalidError();
      }

      const invitation = await tx.userInvitation.findUnique({ where: { tokenHash } });
      if (!invitation) {
        throw new InvitationInvalidError();
      }

      const user = await tx.user.create({
        data: {
          companyId: invitation.companyId,
          email: invitation.email,
          firstName: invitation.firstName,
          lastName: invitation.lastName,
          role: invitation.role,
          passwordHash,
          status: "ACTIVE",
        },
      });

      return user.id;
    });

    await logActivity({ actorId: null, action: "user.invitation_accepted", userId });
    return { ok: true };
  } catch (error) {
    if (error instanceof InvitationInvalidError || isEmailUniqueConstraintViolation(error)) {
      return { ok: false, reason: "INVALID_OR_EXPIRED" };
    }
    throw error;
  }
}
