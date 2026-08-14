import { z } from "zod";

/** Same blank-to-undefined normalization as lib/zod-helpers.ts's optionalNumericString, plus a positivity check — blank means "no limit," matching the fields' null-means-unlimited semantics on Company. */
const optionalPositiveNumericString = () =>
  z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || (!Number.isNaN(Number(value)) && Number(value) > 0), {
      message: "Enter a positive number, or leave blank for no limit",
    });

export const companyAiLimitsSchema = z.object({
  aiMonthlyBudgetUsd: optionalPositiveNumericString(),
  aiRateLimitPerMinute: optionalPositiveNumericString(),
});

export type CompanyAiLimitsInput = z.infer<typeof companyAiLimitsSchema>;
