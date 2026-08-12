import { z as zv4 } from "zod/v4";
import { z } from "zod";

import { optionalString } from "@/lib/zod-helpers";

export const startWebsiteAnalysisSchema = z.object({
  domain: z.string().min(3, "Enter a domain or URL"),
  seoProjectId: optionalString(),
  clientId: optionalString(),
});

export type StartWebsiteAnalysisInput = z.infer<typeof startWebsiteAnalysisSchema>;

/**
 * The LLM's structured-extraction output shape. Uses zod/v4 (not this app's
 * usual classic "zod" import) because the Anthropic SDK's zodOutputFormat
 * helper requires a zod/v4 schema instance.
 */
export const websiteAnalysisExtractionSchema = zv4.object({
  businessCategory: zv4.string(),
  services: zv4.array(zv4.string()),
  locations: zv4.array(zv4.string()),
  topics: zv4.array(zv4.string()),
});

export type WebsiteAnalysisExtraction = zv4.infer<typeof websiteAnalysisExtractionSchema>;
