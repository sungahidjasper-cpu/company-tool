/**
 * Phase C4 — contextual hand-offs from a Content record to the existing AI
 * Workspace optimization tools.
 *
 * Pure functions only: no state, no I/O, no AI, no orchestration. They build
 * and read a query string so a tool can open already focused on one Content
 * record instead of making the user find it again.
 *
 * These values carry NO authority. They are navigation hints; every tool
 * re-derives ownership from the authenticated actor and re-validates the ids
 * server-side (see meta-tag-optimizer.actions.ts's getOwnedSeoProject /
 * getOwnedContentRows, which check company AND project AND soft-delete before
 * generating or applying anything). A hand-crafted URL can therefore only ever
 * preselect something the actor was already allowed to see.
 */

export type ContentOptimizerHandoff = {
  seoProjectId: string;
  contentId: string;
};

/**
 * Whether a Content record is a valid target for the optimization tools.
 *
 * Deliberately does NOT consider `generatedByAi`: a manually-authored page is
 * just as valid an optimization target as an AI-drafted one.
 *
 * The project's own soft-delete state matters as much as the record's. The
 * tools resolve their project list from `listSeoProjectOptions`, which
 * excludes trashed projects, so a record under a trashed project cannot be
 * preselected there — offering the action anyway would be a dead end. Browser
 * verification found exactly that case (a live Content row under a trashed
 * project), which is why this check exists.
 *
 * This governs whether the button is *shown*. It is never the security
 * boundary: the tool re-derives ownership and re-checks soft-delete state
 * server-side on both generate and apply.
 */
export function canOfferContentOptimizerActions(input: {
  canManage: boolean;
  contentDeletedAt: Date | string | null;
  projectDeletedAt: Date | string | null;
}): boolean {
  return input.canManage && input.contentDeletedAt === null && input.projectDeletedAt === null;
}

/** Returns null when either id is missing, so callers can decline to render the action at all. */
export function buildContentOptimizerHandoff(seoProjectId: string, contentId: string): ContentOptimizerHandoff | null {
  if (!seoProjectId.trim() || !contentId.trim()) return null;
  return { seoProjectId, contentId };
}

/** Targets the EXISTING Meta Tag Optimizer route — no new route is introduced. */
export function buildMetaTagOptimizerHref(handoff: ContentOptimizerHandoff): string {
  const params = new URLSearchParams({ seoProjectId: handoff.seoProjectId, contentId: handoff.contentId });
  return `/ai/meta-tag-optimizer/new?${params.toString()}`;
}

/** Phase C4.2 — targets the EXISTING Content Rewriter route, same parameter contract as above. */
export function buildContentRewriterHref(handoff: ContentOptimizerHandoff): string {
  const params = new URLSearchParams({ seoProjectId: handoff.seoProjectId, contentId: handoff.contentId });
  return `/ai/content-rewriter/new?${params.toString()}`;
}

/**
 * Phase C4.3 — targets the EXISTING Schema Markup Generator route, same
 * parameter contract as its two siblings above.
 *
 * That tool needs no extra eligibility rule of its own. It grounds its
 * recommendations in only { title, metaDescription, url }, and `title` is
 * non-nullable, so any live Content row already carries enough information —
 * unlike the Rewriter, which needs an actual body to rewrite. Visibility is
 * therefore governed by canOfferContentOptimizerActions alone.
 *
 * Note this tool is REVIEW-ONLY: it never writes to the database, so no
 * apply/revision path exists here to guard.
 */
export function buildSchemaMarkupHref(handoff: ContentOptimizerHandoff): string {
  const params = new URLSearchParams({ seoProjectId: handoff.seoProjectId, contentId: handoff.contentId });
  return `/ai/schema-markup/new?${params.toString()}`;
}

/**
 * Phase C4.5 — targets the EXISTING Social Snippet Generator route, same
 * parameter contract as its three siblings above.
 *
 * Like the Schema Markup generator, it needs no extra eligibility rule: it
 * grounds snippets in { title, url, metaDescription, body }, and `title` is
 * non-nullable, so any live Content row already carries enough information.
 * Unlike Schema Markup, that tool requires a contentId (every snippet
 * promotes one specific real page), which the route seeds from this hand-off.
 *
 * Review-only, like Schema Markup: nothing is written, posted, or scheduled,
 * so there is no apply/revision path here to guard.
 */
export function buildSocialSnippetHref(handoff: ContentOptimizerHandoff): string {
  const params = new URLSearchParams({ seoProjectId: handoff.seoProjectId, contentId: handoff.contentId });
  return `/ai/social-snippet-generator/new?${params.toString()}`;
}

/**
 * Content record → Email Newsletter Drafter.
 *
 * Same contract as buildSocialSnippetHref: ids only, carrying no authority,
 * seeding a tool that requires a contentId because the newsletter is drafted
 * from one specific real page.
 *
 * Draft-only, like Schema Markup and Social Snippets — nothing is written,
 * posted, scheduled or sent, so there is no apply path here to guard. The
 * drafter re-verifies company ownership, the project/content match and both
 * soft-delete states server-side before generating anything.
 */
export function buildEmailNewsletterHref(handoff: ContentOptimizerHandoff): string {
  const params = new URLSearchParams({ seoProjectId: handoff.seoProjectId, contentId: handoff.contentId });
  return `/ai/email-newsletter/new?${params.toString()}`;
}

/**
 * Content record → Internal Link Analyzer.
 *
 * Same ids-only contract as its siblings. The analyzer's own input schema is
 * exactly { seoProjectId, contentId } (see internal-link-analyzer.schema.ts,
 * where contentId is REQUIRED because every recommendation is "add a link
 * FROM this page"), so this hand-off supplies precisely the input that tool
 * already takes — nothing is invented for it.
 *
 * Review-only: the analyzer never writes, inserts or persists a link, so
 * there is no apply path here to guard. It re-verifies company ownership,
 * the project/content match and both soft-delete states server-side.
 */
export function buildInternalLinkAnalyzerHref(handoff: ContentOptimizerHandoff): string {
  const params = new URLSearchParams({ seoProjectId: handoff.seoProjectId, contentId: handoff.contentId });
  return `/ai/internal-link-analyzer/new?${params.toString()}`;
}

/** Shared by the two actions that need actual prose to work from. */
function hasUsableBody(body: string | null): boolean {
  return typeof body === "string" && body.trim().length > 0;
}

/**
 * Phase C4.2 — the Rewriter additionally requires something to rewrite.
 *
 * Builds on the shared eligibility rule (manage permission, live record, live
 * project) and adds a non-empty body, which is exactly the rule the Rewriter
 * enforces everywhere else: its route lists only `body: { not: null }` rows,
 * `startContentRewriteAction` rejects an empty body, and the dispatcher
 * re-checks it again. Offering the action without a body would dead-end.
 *
 * Like its peer, this decides whether the button is SHOWN. It is never the
 * security boundary — the action and dispatcher both re-verify server-side.
 */
export function canOfferContentRewrite(input: {
  canManage: boolean;
  contentDeletedAt: Date | string | null;
  projectDeletedAt: Date | string | null;
  body: string | null;
}): boolean {
  if (!canOfferContentOptimizerActions(input)) return false;
  return hasUsableBody(input.body);
}

/**
 * The Internal Link Analyzer additionally requires the source page to have a
 * body.
 *
 * Its system prompt requires every recommendation to be "contextually
 * relevant to the actual supplied source page content", and the prompt
 * builder only includes a content excerpt when a body exists. With nothing
 * but a title and meta description the tool has no prose in which to place an
 * anchor, so offering the action on a brief-only record would dead-end in the
 * same way the Rewriter would.
 *
 * Visibility rule only — never the security boundary. The action and the
 * dispatcher both re-verify ownership and soft-delete state server-side.
 */
export function canOfferInternalLinkAnalysis(input: {
  canManage: boolean;
  contentDeletedAt: Date | string | null;
  projectDeletedAt: Date | string | null;
  body: string | null;
}): boolean {
  if (!canOfferContentOptimizerActions(input)) return false;
  return hasUsableBody(input.body);
}

/**
 * Read-back guard for the tool route's own search params. Shape-only: it
 * returns whatever strings were supplied without judging them, because the
 * route validates them against its own company-scoped data and the server
 * actions validate them again independently.
 */
export function parseContentOptimizerParams(params: { seoProjectId?: string; contentId?: string }): ContentOptimizerHandoff {
  return {
    seoProjectId: typeof params.seoProjectId === "string" ? params.seoProjectId : "",
    contentId: typeof params.contentId === "string" ? params.contentId : "",
  };
}

/**
 * Resolves a requested hand-off against the actor's OWN server-derived
 * options. `contentByProject` is built from a company-scoped, non-soft-deleted
 * query, so a project or content id that isn't present here belongs to another
 * company, another project, or the trash — and is silently dropped rather than
 * preselected. This is defence in depth in front of the actions' own checks,
 * never a replacement for them.
 */
export function resolveContentOptimizerSelection(
  requested: ContentOptimizerHandoff,
  seoProjectIds: readonly string[],
  contentByProject: Readonly<Record<string, readonly { id: string }[]>>
): { seoProjectId: string; contentIds: string[] } {
  if (!requested.seoProjectId || !seoProjectIds.includes(requested.seoProjectId)) {
    return { seoProjectId: "", contentIds: [] };
  }
  const belongsToProject = (contentByProject[requested.seoProjectId] ?? []).some((item) => item.id === requested.contentId);
  return {
    seoProjectId: requested.seoProjectId,
    contentIds: belongsToProject ? [requested.contentId] : [],
  };
}
