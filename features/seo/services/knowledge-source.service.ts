import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";
import { checkLinkHealth } from "@/features/seo/services/website-crawler.service";

export async function getKnowledgeSourceById(id: string) {
  if (!isUuid(id)) return null;

  return prisma.knowledgeSource.findUnique({
    where: { id },
    include: {
      addedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export function listKnowledgeSources(
  companyId: string,
  options: { includeArchived?: boolean } = {}
) {
  return prisma.knowledgeSource.findMany({
    where: {
      companyId,
      deletedAt: options.includeArchived ? undefined : null,
    },
    orderBy: { createdAt: "desc" },
    include: {
      addedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export function listKnowledgeSourceLinksForSeoProject(seoProjectId: string) {
  return prisma.knowledgeSourceLink.findMany({
    where: { seoProjectId },
    orderBy: { createdAt: "desc" },
    include: {
      knowledgeSource: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export type KnowledgeSourceVerificationResult = { verified: true } | { verified: false; reason: string };

/**
 * Phase 30 Stage 6 — reuses website-crawler.service.ts's existing
 * checkLinkHealth exactly as-is (same HEAD-first/GET-fallback,
 * 8s-timeout, ≤5-redirect-hop mechanism already relied on by
 * seo-issue-detection.service.ts) rather than building a second
 * link-checking implementation. Deliberately returns only a verified/
 * reason signal — never the response body, never fetched content —
 * so this stays a pure freshness check, not a step toward ingestion.
 */
export async function verifyKnowledgeSourceUrl(url: string): Promise<KnowledgeSourceVerificationResult> {
  const result = await checkLinkHealth(url);
  if (result.broken) {
    return { verified: false, reason: result.status ? `The URL returned an error (status ${result.status}).` : "The URL could not be reached." };
  }
  return { verified: true };
}

/** Case-insensitive, whitespace-normalized comparison — mirrors the CSV-import dedupe normalization already used elsewhere in this feature (e.g. keyword-cluster matching). */
export async function findDuplicateKnowledgeSourceByUrl(
  companyId: string,
  url: string
) {
  const normalized = url.trim().toLowerCase();
  const candidates = await prisma.knowledgeSource.findMany({
    where: { companyId, deletedAt: null, url: { not: null } },
    select: { id: true, url: true },
  });
  return candidates.find((c) => c.url?.trim().toLowerCase() === normalized) ?? null;
}
