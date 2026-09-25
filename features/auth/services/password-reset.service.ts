import { createHash, randomBytes } from "node:crypto";

import { sendPasswordResetEmail } from "@/lib/email/email.service";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Minimum time between two reset-token creations for the SAME account,
 * checked against existing PasswordResetToken rows — no new infrastructure,
 * just a read of state this feature already writes. This is intentionally
 * account-scoped, not IP-scoped: Cloud Compass has no shared/distributed
 * rate-limiting infrastructure today (confirmed during the architecture
 * review — the only precedent, lib/ai/ai-limit.service.ts, is in-memory and
 * per-process), so a real IP-based limiter is out of scope here and remains
 * a future infrastructure improvement, not something to build just for this
 * feature.
 */
const REQUEST_COOLDOWN_MS = 60 * 1000;

/**
 * A reset token is a single high-entropy secret, not a human-chosen
 * password — it doesn't need bcrypt's slow, salted hashing (which also
 * can't be looked up by exact value without knowing the salt in advance).
 * A fast, deterministic SHA-256 digest is the standard approach: the token's
 * own randomness is the only security property the hash needs to preserve,
 * and it must be findable via a plain equality lookup.
 */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

class ResetTokenInvalidError extends Error {}

/**
 * Always resolves — never reveals whether the email address belongs to a
 * real, active account. Every branch (unknown email, deleted/suspended
 * user, cooldown skip, email-send failure) does its work (or deliberately
 * doesn't) and returns identically; the caller (the Server Action) shows
 * the same generic confirmation regardless.
 */
export async function requestPasswordReset(email: string, appOrigin: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt || user.status === "SUSPENDED" || !user.passwordHash) {
    return;
  }

  const recentToken = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - REQUEST_COOLDOWN_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (recentToken) {
    return;
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.$transaction(async (tx) => {
    // Only one pending token per user at a time — this is also what keeps
    // the account-scoped cooldown check above meaningful, since it's always
    // reading at most one still-relevant row.
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });
  });

  const resetUrl = `${appOrigin}/reset-password?token=${rawToken}`;
  const result = await sendPasswordResetEmail({ to: user.email, resetUrl });
  if (!result.ok) {
    // Never surfaced to the caller — the confirmation screen must stay
    // generic regardless of whether the email actually went out. Safe to
    // log: no address, no token, no URL, just the failure classification.
    logger.error("Password reset email could not be sent", { errorType: result.errorType });
  }
}

export type ResetPasswordResult = { ok: true } | { ok: false; reason: "INVALID_OR_EXPIRED" };

/**
 * Consumes a reset token and sets the new password in one transaction. The
 * `updateMany` below is the concurrency guard: its WHERE clause
 * (usedAt: null, expiresAt in the future) is re-checked atomically by
 * Postgres against the current row on update, so if two requests race to
 * consume the same token, only one can ever see count === 1 — the other
 * sees 0 and is rejected, even though both started from a token that looked
 * valid. Nothing here trusts client-supplied state beyond the raw token
 * value itself.
 */
export async function resetPassword(rawToken: string, newPassword: string): Promise<ResetPasswordResult> {
  const tokenHash = hashToken(rawToken);
  const passwordHash = await hashPassword(newPassword);

  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new ResetTokenInvalidError();
      }

      const record = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { userId: true } });
      if (!record) {
        throw new ResetTokenInvalidError();
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, securityVersion: { increment: 1 } },
      });
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof ResetTokenInvalidError) {
      return { ok: false, reason: "INVALID_OR_EXPIRED" };
    }
    throw error;
  }
}
