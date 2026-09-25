/**
 * Cloud Compass's own email failure taxonomy — deliberately separate from
 * PublishingErrorType and LlmErrorType, the same reasoning as
 * publishing-errors.ts: a transactional email provider fails for different
 * reasons than a publishing destination or an LLM provider, and this is
 * intentionally the only vocabulary Password Reset (or any future email
 * sender) ever sees. No adapter-specific error shape ever crosses this
 * boundary.
 */
export type EmailErrorType = "AUTH_FAILED" | "RATE_LIMITED" | "INVALID_REQUEST" | "PROVIDER_UNAVAILABLE" | "NOT_CONFIGURED" | "UNKNOWN";

export type SendEmailResult = { ok: true } | { ok: false; errorType: EmailErrorType; message: string };

/**
 * The boundary a provider adapter must implement. Cloud Compass's email
 * service (email.service.ts) is the only caller — a feature like Password
 * Reset never imports an adapter directly, so swapping providers later means
 * writing a new adapter and changing the one import in email.service.ts.
 */
export type EmailAdapter = {
  isConfigured(): boolean;
  sendPasswordResetEmail(params: { to: string; resetUrl: string }): Promise<SendEmailResult>;
  sendInvitationEmail(params: { to: string; inviteUrl: string; firstName: string; companyName: string }): Promise<SendEmailResult>;
};
