import { resendAdapter } from "@/lib/email/resend-adapter";
import type { EmailAdapter, SendEmailResult } from "@/lib/email/types";

/**
 * Cloud Compass's own email concept boundary. Password Reset (or any future
 * caller) only ever imports from this file — never lib/email/resend-adapter
 * directly — so the provider can be replaced later by swapping this one
 * constant, without any caller changing.
 */
const adapter: EmailAdapter = resendAdapter;

export function isEmailConfigured(): boolean {
  return adapter.isConfigured();
}

export async function sendPasswordResetEmail(params: { to: string; resetUrl: string }): Promise<SendEmailResult> {
  return adapter.sendPasswordResetEmail(params);
}
