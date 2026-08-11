import { z } from "zod";

import { optionalString } from "@/lib/zod-helpers";

export const SEO_PROJECT_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED"] as const;

export const seoProjectSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  domain: z.string().min(3, "Enter a valid domain"),
  clientId: optionalString(),
  ownerId: optionalString(),
  status: z.enum(SEO_PROJECT_STATUSES),
  startDate: optionalString(),
});

export type SeoProjectInput = z.infer<typeof seoProjectSchema>;
