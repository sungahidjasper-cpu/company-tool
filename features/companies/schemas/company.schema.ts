import { z } from "zod";

import { optionalString, optionalUrl } from "@/lib/zod-helpers";

export const companySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  industry: optionalString(),
  website: optionalUrl(),
  timezone: optionalString(),
});

export type CompanyInput = z.infer<typeof companySchema>;
