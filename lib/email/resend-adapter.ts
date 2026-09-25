import { logger } from "@/lib/logger";
import type { EmailAdapter, EmailErrorType, SendEmailResult } from "@/lib/email/types";

/**
 * Resend's REST API directly via fetch, matching how this app already talks
 * to WordPress and Facebook's Graph API (raw HTTP, not a vendor SDK) rather
 * than adding a new dependency for a single POST request.
 */
const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

function isConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS);
}

/** Resend's documented error responses: https://resend.com/docs/api-reference/errors */
function classifyStatusCode(statusCode: number): EmailErrorType {
  if (statusCode === 401 || statusCode === 403) return "AUTH_FAILED";
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode === 400 || statusCode === 422) return "INVALID_REQUEST";
  if (statusCode >= 500) return "PROVIDER_UNAVAILABLE";
  return "UNKNOWN";
}

function buildPasswordResetContent(resetUrl: string): { subject: string; text: string; html: string } {
  const subject = "Reset your Cloud Compass password";
  const text = `We received a request to reset your Cloud Compass password.\n\nReset your password:\n${resetUrl}\n\nThis link expires in 60 minutes. If you didn't request this, you can safely ignore this email.`;
  const html = `<p>We received a request to reset your Cloud Compass password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 60 minutes. If you didn't request this, you can safely ignore this email.</p>`;
  return { subject, text, html };
}

function buildInvitationContent({
  firstName,
  companyName,
  inviteUrl,
}: {
  firstName: string;
  companyName: string;
  inviteUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `You're invited to join ${companyName} on Cloud Compass`;
  const text = `Hi ${firstName},\n\nYou've been invited to join ${companyName} on Cloud Compass OS.\n\nAccept your invitation and set up your account:\n${inviteUrl}\n\nThis invitation link expires in 7 days. If you weren't expecting this, you can safely ignore this email.`;
  const html = `<p>Hi ${firstName},</p><p>You've been invited to join <strong>${companyName}</strong> on Cloud Compass OS.</p><p><a href="${inviteUrl}">Accept your invitation and set up your account</a></p><p>This invitation link expires in 7 days. If you weren't expecting this, you can safely ignore this email.</p>`;
  return { subject, text, html };
}

/**
 * Shared by both send functions below — the only difference between a
 * password reset and an invitation email is the recipient, subject and body;
 * the request/error handling is identical.
 */
async function sendViaResend({
  to,
  subject,
  text,
  html,
  logLabel,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
  logLabel: string;
}): Promise<SendEmailResult> {
  if (!isConfigured()) {
    return { ok: false, errorType: "NOT_CONFIGURED", message: "Email sending is not configured." };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM_ADDRESS, to, subject, text, html }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorType = classifyStatusCode(response.status);
      // Deliberately never logs the response body — Resend may echo request
      // fields (including `to`) back in validation error bodies.
      logger.error(`Resend: ${logLabel} failed`, { status: response.status, errorType });
      return { ok: false, errorType, message: `Failed to send the ${logLabel}.` };
    }

    return { ok: true };
  } catch (error) {
    logger.error(`Resend: ${logLabel} request failed`, { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false, errorType: "PROVIDER_UNAVAILABLE", message: `Failed to send the ${logLabel}.` };
  }
}

async function sendPasswordResetEmail({ to, resetUrl }: { to: string; resetUrl: string }): Promise<SendEmailResult> {
  const { subject, text, html } = buildPasswordResetContent(resetUrl);
  return sendViaResend({ to, subject, text, html, logLabel: "password reset email" });
}

async function sendInvitationEmail({
  to,
  inviteUrl,
  firstName,
  companyName,
}: {
  to: string;
  inviteUrl: string;
  firstName: string;
  companyName: string;
}): Promise<SendEmailResult> {
  const { subject, text, html } = buildInvitationContent({ firstName, companyName, inviteUrl });
  return sendViaResend({ to, subject, text, html, logLabel: "invitation email" });
}

export const resendAdapter: EmailAdapter = { isConfigured, sendPasswordResetEmail, sendInvitationEmail };
