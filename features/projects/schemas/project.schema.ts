import { z } from "zod";

import { optionalString } from "@/lib/zod-helpers";

export const projectSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: optionalString(),
  status: z.enum(["PLANNING", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  startDate: optionalString(),
  dueDate: optionalString(),
  clientId: optionalString(),
  ownerId: optionalString(),
  assignedUserIds: z.array(z.string()),
});

export type ProjectInput = z.infer<typeof projectSchema>;
