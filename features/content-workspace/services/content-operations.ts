/**
 * Phase 4 — the Content Operations entry point for a single Content record.
 *
 * Pure and read-only: no I/O, no state, no writes, no AI, no new model. It
 * turns the record's own columns plus the actor's permission into a grouped
 * list of operations, where every operation is EITHER a link to a tool that
 * genuinely accepts this record as input OR a clearly-worded reason it is
 * unavailable. There is no third state: a rendered operation without an href
 * is never clickable, so no button here can appear to work when it does not.
 *
 * Why it exists: the detail page previously offered six hand-offs as one flat
 * row of buttons, with no grouping and no explanation when one was missing —
 * an action simply vanished. Resolving each operation explicitly means an
 * absent action always comes with a reason.
 *
 * The eligibility rules are NOT restated here. Every one delegates to the
 * existing helpers in content-optimizer-handoff.ts so a single rule governs
 * both the button and the tool it points at. None of this is a security
 * boundary — each target route and server action re-derives ownership and
 * re-checks both soft-delete states independently.
 */

import {
  buildContentOptimizerHandoff,
  buildContentRewriterHref,
  buildEmailNewsletterHref,
  buildInternalLinkAnalyzerHref,
  buildMetaTagOptimizerHref,
  buildSchemaMarkupHref,
  buildSocialSnippetHref,
  canOfferContentOptimizerActions,
  canOfferContentRewrite,
  canOfferInternalLinkAnalysis,
} from "@/features/ai-workspace/services/content-optimizer-handoff";
import type { ContentWorkflowStage } from "@/features/ai-workspace/services/saved-brief-summary";
import { ALL_CLIENTS_SELECTION, NO_CLIENT_SELECTION } from "@/features/content-workspace/services/workspace-context";

export type ContentOperationKey =
  | "LONG_FORM"
  | "META_TAGS"
  | "REWRITE"
  | "INTERNAL_LINKS"
  | "SCHEMA"
  | "SOCIAL_SNIPPETS"
  | "NEWSLETTER";

export type ContentOperationSectionKey = "IMPROVE" | "REPURPOSE" | "TECHNICAL";

export type ContentOperation = {
  key: ContentOperationKey;
  label: string;
  /** What the tool does, stated in terms of what it will and will not change. */
  description: string;
  /** Where the operation goes. `null` means unavailable — never render a control. */
  href: string | null;
  /** Why it is unavailable. Always set when `href` is null, always null otherwise. */
  unavailableReason: string | null;
};

export type ContentOperationSection = {
  key: ContentOperationSectionKey;
  title: string;
  description: string;
  operations: ContentOperation[];
};

export type ContentOperationsInput = {
  /**
   * Null for client-owned content. The content-optimizer tools are all
   * project-scoped, so without one there are no operations to offer — the
   * panel explains that rather than showing dead buttons.
   */
  seoProjectId: string | null;
  contentId: string;
  canManage: boolean;
  contentDeletedAt: Date | string | null;
  projectDeletedAt: Date | string | null;
  body: string | null;
  workflowStage: ContentWorkflowStage;
};

/**
 * The single reason the whole panel can be unavailable, as opposed to one
 * operation within it. Returns null when operations can be offered at all.
 *
 * These are the three states canOfferContentOptimizerActions already gates
 * on; naming each one separately is what turns a disappearing panel into an
 * explanation.
 */
export function describeOperationsUnavailable(input: {
  canManage: boolean;
  contentDeletedAt: Date | string | null;
  projectDeletedAt: Date | string | null;
  /** Present so client-owned content can be told WHY, instead of seeing an empty panel. */
  seoProjectId?: string | null;
}): string | null {
  if (input.seoProjectId === null) {
    return "Content operations are SEO-project tools, and this content is not in an SEO project. Move it into one to run them.";
  }
  if (canOfferContentOptimizerActions(input)) return null;
  if (input.contentDeletedAt !== null) {
    return "This content is in the trash. Restore it to run content operations on it.";
  }
  if (input.projectDeletedAt !== null) {
    return "The SEO project this content belongs to is in the trash. Restore the project to run content operations.";
  }
  return "Content operations are available to users who can manage SEO projects.";
}

const NEEDS_ARTICLE = "This record has no article body yet — add or generate the content first.";

/**
 * Builds the grouped operations for one Content record.
 *
 * Returns [] when the panel itself is unavailable (see
 * describeOperationsUnavailable) — the caller renders that one reason rather
 * than a list of seven identical ones.
 */
export function buildContentOperations(input: ContentOperationsInput): ContentOperationSection[] {
  if (!canOfferContentOptimizerActions(input)) return [];

  if (input.seoProjectId === null) return [];
  const handoff = buildContentOptimizerHandoff(input.seoProjectId, input.contentId);
  if (!handoff) return [];

  const rewriteAvailable = canOfferContentRewrite(input);
  const internalLinksAvailable = canOfferInternalLinkAnalysis(input);

  /*
   * Long-Form is offered only for a BRIEF_ONLY record, which is the rule the
   * detail page already applied: a record that already has an article has
   * nothing to generate from its brief, and a manually-authored record has no
   * brief to generate from. Both cases are stated rather than hidden.
   */
  const longFormReason =
    input.workflowStage === "HAS_ARTICLE"
      ? "This record already has an article. Use Rewrite content to revise it."
      : "Only a record saved from an AI content brief can be expanded into a long-form article.";

  const improve: ContentOperation[] = [
    {
      key: "META_TAGS",
      label: "Optimize meta tags",
      description: "Suggests a meta title and description. You review each suggestion and apply it yourself — nothing is saved automatically.",
      href: buildMetaTagOptimizerHref(handoff),
      unavailableReason: null,
    },
    {
      key: "REWRITE",
      label: "Rewrite content",
      description: "Rewrites the article for a chosen goal or tone. The rewrite is reviewed before it replaces anything, and applying it records a new version.",
      href: rewriteAvailable ? buildContentRewriterHref(handoff) : null,
      unavailableReason: rewriteAvailable ? null : NEEDS_ARTICLE,
    },
    {
      key: "INTERNAL_LINKS",
      label: "Analyze internal links",
      description: "Recommends links from this page to other real pages in the same project. Review only — no link is ever inserted for you.",
      href: internalLinksAvailable ? buildInternalLinkAnalyzerHref(handoff) : null,
      unavailableReason: internalLinksAvailable ? null : NEEDS_ARTICLE,
    },
    {
      key: "LONG_FORM",
      label: "Generate long-form article",
      description: "Expands this record's saved content brief into a full article for review.",
      href: input.workflowStage === "BRIEF_ONLY" ? `/ai/content-brief/${input.contentId}/long-form` : null,
      unavailableReason: input.workflowStage === "BRIEF_ONLY" ? null : longFormReason,
    },
  ];

  const repurpose: ContentOperation[] = [
    {
      key: "SOCIAL_SNIPPETS",
      label: "Generate social snippets",
      description: "Drafts short copy promoting this page, to read and copy. Nothing is posted, scheduled or connected to any social account.",
      href: buildSocialSnippetHref(handoff),
      unavailableReason: null,
    },
    {
      key: "NEWSLETTER",
      label: "Draft newsletter",
      description: "Drafts a newsletter based on this page, to read and copy. Nothing is sent, scheduled or added to any mailing list.",
      href: buildEmailNewsletterHref(handoff),
      unavailableReason: null,
    },
  ];

  const technical: ContentOperation[] = [
    {
      key: "SCHEMA",
      label: "Generate schema markup",
      description: "Produces JSON-LD grounded in this page's title, description and URL. Review only — nothing is written to the page.",
      href: buildSchemaMarkupHref(handoff),
      unavailableReason: null,
    },
  ];

  return [
    {
      key: "IMPROVE",
      title: "Improve this page",
      description: "Works on the page itself. Anything that changes the saved content is reviewed first and recorded as a version.",
      operations: improve,
    },
    {
      key: "REPURPOSE",
      title: "Repurpose this page",
      description: "Draft-only. These produce copy to read and use elsewhere; none of them publishes, sends or schedules anything.",
      operations: repurpose,
    },
    {
      key: "TECHNICAL",
      title: "Technical markup",
      description: "Review-only output for a developer or CMS to apply.",
      operations: technical,
    },
  ];
}

/**
 * Operations that do not exist yet.
 *
 * Listed deliberately, and deliberately WITHOUT controls: the workspace
 * roadmap promises scheduling, social publishing and performance feedback,
 * and someone looking at this page needs to know whether their absence is a
 * missing feature or a missing permission. A named, control-free "not yet
 * available" line answers that; a greyed-out button that looks clickable
 * would not.
 *
 * Each entry states honestly what is missing in this system rather than
 * implying a date.
 */
export const UNAVAILABLE_OPERATIONS: readonly { label: string; reason: string }[] = [
  {
    label: "Schedule a publish date",
    reason: "Content records have no scheduled date. A publish date is recorded only once the content is actually published.",
  },
  {
    label: "Publish to social platforms",
    reason: "Social publishing is available through the Social Composer. Publishing this content directly from this page is not currently available.",
  },
  {
    label: "Per-platform content variants",
    reason: "Platform-specific versions are supported for social posts. They are not available for this content type.",
  },
  {
    label: "Performance and analytics feedback",
    reason: "No analytics source is connected to individual content records.",
  },
];

/**
 * What this Content record IS — resolved from its own columns only.
 *
 * `contentType` is deliberately absent from the return: the Content model has
 * no type column, and the workspace already reports this honestly rather than
 * inferring one. `clientName` is null when the owning SEO project has no
 * client assigned, which is a legitimate state (SEOProject.clientId is
 * optional), not missing data to guess at.
 */
export type ContentIdentity = {
  clientName: string | null;
  clientId: string | null;
  /** Null for client-owned content that is in no SEO project. */
  seoProjectName: string | null;
  hasArticle: boolean;
  /** Human sentence for the record's derived workflow stage. */
  stageLabel: string;
  stageDetail: string;
};

export function describeContentIdentity(input: {
  clientId: string | null;
  clientName: string | null;
  seoProjectName: string | null;
  body: string | null;
  workflowStage: ContentWorkflowStage;
}): ContentIdentity {
  const stage: Record<ContentWorkflowStage, { label: string; detail: string }> = {
    BRIEF_ONLY: {
      label: "Brief only",
      detail: "An AI content brief is saved for this record, but no article has been written yet.",
    },
    HAS_ARTICLE: {
      label: "Article drafted",
      detail: "This record has an article body. Every change to it is recorded in Version History.",
    },
    MANUAL: {
      label: "Manually created",
      detail: "This record was created by hand and has no article body or saved brief yet.",
    },
  };

  return {
    clientId: input.clientId,
    clientName: input.clientName,
    seoProjectName: input.seoProjectName,
    hasArticle: typeof input.body === "string" && input.body.trim().length > 0,
    stageLabel: stage[input.workflowStage].label,
    stageDetail: stage[input.workflowStage].detail,
  };
}

/**
 * The workspace selection that corresponds to one Content record.
 *
 * A record whose SEO project has NO client belongs to the "No client assigned"
 * selection, not to "All clients" — browser verification caught exactly that:
 * returning from such a record reset the client filter to every client, which
 * is a wider view than the one the user came from. `all` is reserved for the
 * case where there is genuinely nothing more specific to say.
 *
 * A hint only. /content re-resolves it against the actor's own scope, so a
 * client the actor cannot see falls back to the default view.
 */
export function workspaceSelectionForContent(clientId: string | null, seoProjectId: string | null): { clientId: string; projectId: string } {
  return {
    clientId: clientId ?? (seoProjectId ? NO_CLIENT_SELECTION : ALL_CLIENTS_SELECTION),
    projectId: seoProjectId ?? "",
  };
}
