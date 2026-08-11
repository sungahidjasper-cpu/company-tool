import { z } from "zod";

import { optionalString } from "@/lib/zod-helpers";

export const keywordClusterSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: optionalString(),
});

export type KeywordClusterInput = z.infer<typeof keywordClusterSchema>;
