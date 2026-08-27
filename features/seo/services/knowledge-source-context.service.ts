import { prisma } from "@/lib/prisma";
import { listKnowledgeSourceLinksForSeoProject } from "@/features/seo/services/knowledge-source.service";

/** Bounds prompt growth — a project could accumulate many links over time; only the most recently linked sources are included. */
const MAX_SOURCES = 5;
/** Per-source content excerpt cap, in characters — keeps one long pasted source from crowding out everything else in the prompt. */
const MAX_CONTENT_CHARS = 800;

function formatSourceEntry(source: { title: string; url: string | null; description: string | null; content: string | null }): string {
  const parts = [source.title];
  if (source.url) parts.push(`(${source.url})`);
  if (source.description) parts.push(`— ${source.description}`);
  if (source.content) {
    const excerpt = source.content.length > MAX_CONTENT_CHARS ? `${source.content.slice(0, MAX_CONTENT_CHARS)}…` : source.content;
    parts.push(`\n  "${excerpt}"`);
  }
  return `- ${parts.join(" ")}`;
}

/**
 * Phase 30 Stage 3 — the first real consumer of Stage 2's KnowledgeSource
 * foundation. Returns a formatted prompt block for the sources currently
 * linked to a project, or null when there are none (the overwhelmingly
 * common case today, since no UI yet exists to create links) — callers
 * append this to an existing prompt only when non-null, so a project with
 * no linked sources produces a byte-identical prompt to before this
 * function existed.
 *
 * Deliberately only surfaces already-human-entered KnowledgeSource.content
 * — there is no ingestion/crawling step populating it automatically, so
 * this never introduces untrusted web content into a prompt.
 */
export async function getKnowledgeSourceContextForSeoProject(seoProjectId: string): Promise<string | null> {
  const links = await listKnowledgeSourceLinksForSeoProject(seoProjectId);

  const seen = new Set<string>();
  const activeSources = [];
  for (const link of links) {
    const source = link.knowledgeSource;
    if (source.deletedAt !== null) continue; // archived — never surfaced as live context
    if (seen.has(source.id)) continue; // the same source can be linked more than once
    seen.add(source.id);
    activeSources.push(source);
    if (activeSources.length >= MAX_SOURCES) break;
  }

  if (activeSources.length === 0) return null;

  const entries = activeSources.map(formatSourceEntry).join("\n");
  return `Supplied authoritative sources for this project (human-verified — you may ground claims in these, but never invent additional sources beyond them, and never state something these sources don't actually support just because a source is present):\n${entries}`;
}

/**
 * Phase 30 Stage 8 — a tenant-safe entry point for callers (Website Analysis)
 * that receive a `seoProjectId` from a persisted job row rather than from a
 * request already scoped to a verified SEOProject the way Content Brief's/
 * Long-Form's callers are. `seoProjectId` alone is never trusted as an
 * authorization boundary — this re-verifies the project actually belongs to
 * `companyId` (same ownership check already used in
 * knowledge-source.actions.ts's linkKnowledgeSourceToSeoProject) before ever
 * calling into getKnowledgeSourceContextForSeoProject above, so a job whose
 * seoProjectId doesn't belong to its own company can never pull another
 * company's Knowledge Source content into an AI prompt. Returns null (never
 * throws) for a missing/absent/foreign project — indistinguishable from "no
 * sources linked," which is the correct, non-error outcome for a job with no
 * applicable Knowledge Source context.
 */
export async function getVerifiedKnowledgeSourceContextForJob(
  companyId: string,
  seoProjectId: string | null | undefined
): Promise<string | null> {
  if (!seoProjectId) return null;

  const seoProject = await prisma.sEOProject.findUnique({
    where: { id: seoProjectId },
    select: { companyId: true },
  });
  if (!seoProject || seoProject.companyId !== companyId) return null;

  return getKnowledgeSourceContextForSeoProject(seoProjectId);
}
