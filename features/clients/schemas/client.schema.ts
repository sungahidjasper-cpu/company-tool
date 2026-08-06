import { z } from "zod";

import { optionalEmail, optionalString, optionalUrl } from "@/lib/zod-helpers";

export const clientSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: optionalEmail(),
  phone: optionalString(),
  website: optionalUrl(),
  industry: optionalString(),
  address: optionalString(),
  source: optionalString(),
  status: z.enum(["LEAD", "ACTIVE", "INACTIVE", "CHURNED"]),
  ownerId: optionalString(),
});

export type ClientInput = z.infer<typeof clientSchema>;
