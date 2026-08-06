import { z } from "zod";

import { optionalString } from "@/lib/zod-helpers";

const statusEnum = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]);

export const taskSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  description: optionalString(),
  status: statusEnum,
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  dueDate: optionalString(),
  assigneeId: optionalString(),
});

export const taskStatusSchema = z.object({
  status: statusEnum,
});

export const quickSubtaskSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
});

export type TaskInput = z.infer<typeof taskSchema>;
