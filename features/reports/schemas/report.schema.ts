import { z } from "zod";

import { optionalString } from "@/lib/zod-helpers";

/**
 * Client-safe metadata for every supported report type — no compute
 * functions here (those touch Prisma and live server-side only, in
 * report.service.ts's REPORT_COMPUTE map). This is the one place that
 * knows which types exist and what scope picker each needs; the form,
 * the schema, and the action all derive from this instead of each
 * re-declaring their own list. Adding a future report type means adding
 * one entry here (+ its compute function) rather than editing switches
 * scattered across the form/action/pages.
 *
 * SEO_PERFORMANCE is intentionally omitted — the SEO Workspace has no
 * real data anywhere yet, so there's nothing to report on.
 */
export const REPORT_TYPE_OPTIONS = [
  { value: "PROJECT_SUMMARY", label: "Project Summary", scopeKind: "project" },
  { value: "CLIENT_SUMMARY", label: "Client Summary", scopeKind: "client" },
  { value: "FINANCIAL", label: "Budget Rollup", scopeKind: "client" },
  { value: "SALES_PIPELINE", label: "Sales Pipeline", scopeKind: "none" },
  { value: "CUSTOM", label: "Custom", scopeKind: "custom" },
] as const;

export type SupportedReportType = (typeof REPORT_TYPE_OPTIONS)[number]["value"];
export type ReportScopeKind = (typeof REPORT_TYPE_OPTIONS)[number]["scopeKind"];

const SUPPORTED_REPORT_TYPES = REPORT_TYPE_OPTIONS.map((option) => option.value) as [
  SupportedReportType,
  ...SupportedReportType[],
];

export function getScopeKind(type: string): ReportScopeKind | undefined {
  return REPORT_TYPE_OPTIONS.find((option) => option.value === type)?.scopeKind;
}

export const generateReportSchema = z.object({
  type: z.enum(SUPPORTED_REPORT_TYPES),
  title: z.string().min(2, "Title must be at least 2 characters"),
  scopeId: optionalString(),
  notes: optionalString(),
});

export type GenerateReportInput = z.infer<typeof generateReportSchema>;
