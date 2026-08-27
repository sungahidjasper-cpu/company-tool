/**
 * Phase 30 Stage 5 — pure presentation-support helper for the SEO project
 * linking UI: which of a company's active Knowledge Sources are NOT
 * already linked to a given project. No Prisma call, no new backend
 * query — both inputs are already fetched by the existing Stage 2
 * services (listKnowledgeSources / listKnowledgeSourceLinksForSeoProject).
 */
export function getUnlinkedKnowledgeSources<T extends { id: string }>(
  companySources: T[],
  existingLinks: { knowledgeSourceId: string }[]
): T[] {
  const linkedIds = new Set(existingLinks.map((link) => link.knowledgeSourceId));
  return companySources.filter((source) => !linkedIds.has(source.id));
}
