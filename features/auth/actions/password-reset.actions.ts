"use server";

import {
  forgotPasswordSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from "@/features/auth/schemas/password-reset.schema";
import { requestPasswordReset, resetPassword } from "@/features/auth/services/password-reset.service";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";

/**
 * Unauthenticated by design — requestUser()/requireUser() must never gate
 * either action here. The request-reset action is authorized by nothing
 * more than "an email address was submitted" (matching the login page's own
 * exposure); the completion action is authorized purely by possession of a
 * valid, unexpired, unused reset token, verified entirely server-side
 * inside resetPassword().
 */

export async function requestPasswordResetAction(input: ForgotPasswordInput): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    // Only ever fires for a malformed address (e.g. missing "@") — reveals
    // nothing about whether an account exists, so it's safe to surface as a
    // normal field-validation message.
    return actionError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
  }

  await requestPasswordReset(parsed.data.email, process.env.NEXTAUTH_URL!);

  // Always success, always identical — this is the one response for an
  // existing account, an unknown email, and a deleted/suspended account
  // alike. Never branch this on what requestPasswordReset actually did.
  return actionSuccess();
}

export type ResetPasswordActionResult =
  | { success: true }
  | { success: false; reason: "VALIDATION"; message: string }
  | { success: false; reason: "INVALID_TOKEN" };

export async function resetPasswordAction(input: ResetPasswordInput): Promise<ResetPasswordActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, reason: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const result = await resetPassword(parsed.data.token, parsed.data.newPassword);
  if (!result.ok) {
    return { success: false, reason: "INVALID_TOKEN" };
  }

  return { success: true };
}
