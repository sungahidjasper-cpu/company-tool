import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sEOProject: { findUnique: vi.fn() },
    websiteAnalysisJob: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getSeoAuditReportData } from "@/features/seo/services/website-analysis.service";

const mockFindProject = vi.mocked(prisma.sEOProject.findUnique);
const mockFindJob = vi.mocked(prisma.websiteAnalysisJob.findFirst);

const COMPANY_ID = "company-1";
const PROJECT_ID = "project-1";
const SEO_PROJECT = { id: PROJECT_ID, companyId: COMPANY_ID, name: "Acme Plumbing SEO" };

const ISSUES = [
  { issueType: "MISSING_TITLE", severity: "CRITICAL", url: "https://acme.example/a", status: "OPEN" },
  { issueType: "MISSING_ALT_TEXT", severity: "LOW", url: "https://acme.example/b", status: "OPEN" },
  { issueType: "SITEMAP_ISSUE", severity: "MEDIUM", url: null, status: "RESOLVED" },
];

function jobWithAudit(audit: Record<string, unknown> | null) {
  return {
    id: "job-1",
    companyId: COMPANY_ID,
    domain: "acme.example",
    status: "SUCCEEDED",
    resultJson: {
      businessCategory: "Plumbing",
      services: [],
      locations: [],
      topics: [],
      crawledPages: [],
      sitemapUrlCount: 1,
      warnings: [],
      overallScore: audit ? (audit.overallScore as number) : null,
      audit,
    },
    issues: ISSUES,
  };
}

/** A fully-succeeded audit — every AI task came back. */
const FULL_AUDIT = {
  overallScore: 85,
  categoryScores: {
    technicalSeo: { score: 90, reasoning: "Solid technical baseline." },
    onPageSeo: { score: 80, reasoning: "Good meta coverage." },
    contentQuality: { score: 75, reasoning: "..." },
    structuredData: { score: 60, reasoning: "..." },
    internalLinking: { score: 70, reasoning: "..." },
    eeat: { score: 65, reasoning: "...", factors: [] },
    localSeo: { applicable: false, score: null, reasoning: "..." },
    geoReadiness: { score: 55, reasoning: "...", factors: [] },
    aeoReadiness: { score: 50, reasoning: "...", factors: [] },
  },
  recommendations: [
    {
      title: "Add FAQ schema",
      description: "...",
      whyItMatters: "...",
      estimatedImpact: "HIGH",
      difficulty: "EASY",
      priority: "HIGH",
      category: "STRUCTURED_DATA",
    },
  ],
  keywordIntelligence: null,
  contentGaps: null,
  structuredDataRecommendations: null,
  detectedSchemaTypes: [],
  internalLinkingSuggestions: null,
  orphanPages: [],
  executiveSummary: {
    overallHealthNarrative: "This site has a solid technical foundation but thin content.",
    strengths: ["Fast pages"],
    weaknesses: ["Thin content"],
    topActions: ["Add FAQ schema"],
  },
};

describe("getSeoAuditReportData", () => {
  it("throws when no seoProjectId is given", async () => {
    await expect(getSeoAuditReportData(COMPANY_ID, undefined)).rejects.toThrow(/select an seo project/i);
  });

  it("throws when the project doesn't exist or belongs to another company", async () => {
    mockFindProject.mockResolvedValue(null);
    await expect(getSeoAuditReportData(COMPANY_ID, PROJECT_ID)).rejects.toThrow(/not found/i);
  });

  it("throws a clear, actionable error when the project has no succeeded analysis yet", async () => {
    mockFindProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindJob.mockResolvedValue(null);
    await expect(getSeoAuditReportData(COMPANY_ID, PROJECT_ID)).rejects.toThrow(/Acme Plumbing SEO.*run an analysis/i);
  });

  it("shapes a full audit into summaryCards, a severity chart, the issues table, executive summary, and recommendations", async () => {
    mockFindProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindJob.mockResolvedValue(jobWithAudit(FULL_AUDIT) as never);

    const result = await getSeoAuditReportData(COMPANY_ID, PROJECT_ID);

    expect(result.summaryCards).toEqual([
      { label: "Domain", value: "acme.example" },
      { label: "Overall Score", value: "85/100" },
      { label: "Technical SEO", value: "90/100" },
      { label: "On-Page SEO", value: "80/100" },
      { label: "Total Issues", value: "3" },
      { label: "Critical Issues", value: "1" },
    ]);
    expect(result.chart).toEqual([
      { status: "Critical", count: 1 },
      { status: "High", count: 0 },
      { status: "Medium", count: 1 },
      { status: "Low", count: 1 },
    ]);
    expect(result.columns).toEqual(["Issue Type", "Severity", "URL", "Status"]);
    expect(result.rows).toEqual([
      ["Missing Title", "Critical", "https://acme.example/a", "Open"],
      ["Missing Alt Text", "Low", "https://acme.example/b", "Open"],
      ["Sitemap Issue", "Medium", "(site-wide)", "Resolved"],
    ]);
    expect(result.executiveSummary).toBe("This site has a solid technical foundation but thin content.");
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations?.[0].title).toBe("Add FAQ schema");
  });

  it("produces a complete, honest report when AI never succeeded for this run (audit entirely null) — never a crash, never fabricated scores", async () => {
    mockFindProject.mockResolvedValue(SEO_PROJECT as never);
    mockFindJob.mockResolvedValue(jobWithAudit(null) as never);

    const result = await getSeoAuditReportData(COMPANY_ID, PROJECT_ID);

    expect(result.summaryCards).toEqual([
      { label: "Domain", value: "acme.example" },
      { label: "Overall Score", value: "Unavailable" },
      { label: "Technical SEO", value: "Unavailable" },
      { label: "On-Page SEO", value: "Unavailable" },
      { label: "Total Issues", value: "3" },
      { label: "Critical Issues", value: "1" },
    ]);
    // Deterministic data (issues, severity breakdown) is always present regardless of AI availability.
    expect(result.rows).toHaveLength(3);
    expect(result.chart?.find((row) => row.status === "Critical")?.count).toBe(1);
    // AI-only content is honestly absent, not fabricated.
    expect(result.executiveSummary).toBeNull();
    expect(result.recommendations).toEqual([]);
  });
});
