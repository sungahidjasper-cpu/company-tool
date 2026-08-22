import { z as zv4 } from "zod/v4";

/**
 * Phase 24 Stage 1 — input/output shapes for connection management.
 * connectDestinationInputSchema intentionally has no companyId field: the
 * acting company is always derived server-side from the session, never
 * accepted from the client.
 */

export const connectDestinationInputSchema = zv4.object({
  label: zv4.string().trim().min(1, "Label is required.").max(100),
  baseUrl: zv4
    .string()
    .trim()
    .min(1, "Base URL is required.")
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, "Base URL must be a valid https:// URL."),
  username: zv4.string().trim().min(1, "Username is required.").max(200),
  applicationPassword: zv4.string().trim().min(1, "Application password is required.").max(500),
});

export type ConnectDestinationInput = zv4.infer<typeof connectDestinationInputSchema>;

export const updateConnectionLabelInputSchema = zv4.object({
  connectionId: zv4.string().min(1),
  label: zv4.string().trim().min(1, "Label is required.").max(100),
});

export type UpdateConnectionLabelInput = zv4.infer<typeof updateConnectionLabelInputSchema>;

export const disconnectDestinationInputSchema = zv4.object({
  connectionId: zv4.string().min(1),
});

export type DisconnectDestinationInput = zv4.infer<typeof disconnectDestinationInputSchema>;

/**
 * The only shape a PublishingConnection is ever allowed to leave a server
 * action as — deliberately excludes any credential field. There is no
 * "PublishingConnectionWithCredential" type anywhere in this feature.
 */
export type PublishingConnectionSummary = {
  id: string;
  providerType: "WORDPRESS";
  label: string;
  baseUrl: string;
  status: "ACTIVE" | "INVALID" | "REVOKED";
  createdAt: Date;
  lastVerifiedAt: Date | null;
};
