import { z } from "zod";

import { optionalEmail, optionalString } from "@/lib/zod-helpers";

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;

export const leadSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  companyName: optionalString(),
  email: optionalEmail(),
  phone: optionalString(),
  source: optionalString(),
  status: z.enum(LEAD_STATUSES),
  value: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || !Number.isNaN(Number(value)), {
      message: "Enter a valid number",
    }),
  assignedUserId: optionalString(),
  clientId: optionalString(),
  projectId: optionalString(),
});

export type LeadInput = z.infer<typeof leadSchema>;

export const leadStatusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
});

export const quickLeadTaskSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
});
