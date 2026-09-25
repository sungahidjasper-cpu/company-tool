import { contentDetailHref } from "@/features/content-workspace/services/content-location";
import { formatIsoDate } from "@/features/ai-workspace/schemas/content-calendar.schema";
import { instantToZonedParts } from "@/features/content-workspace/services/content-scheduling";

/**
 * The Content Workspace's read model.
 *
 * Two existing sources are surfaced side by side and deliberately NOT merged:
 *
 * - CONTENT — a real page. Its date is `scheduledAt` when it is SCHEDULED and
 *   `publishedAt` once it has actually been published. A page with neither
 *   genuinely has no calendar date and is listed separately rather than being
 *   placed on a guessed day. The two are never conflated: a schedule is an
 *   intention, and only `publishedAt` means it went out.
 * - PLAN — a saved Content Calendar Assistant entry. Its date is the planned
 *   publishing date. A plan entry is an intention, never a page.
 *
 * Their statuses come from different lifecycles and are kept apart: a planned
 * item is never shown as published, and a page is never shown as scheduled.
 *
 * Read-only. Nothing in this module writes.
 */

export const WORKSPACE_ITEM_KINDS = ["CONTENT", "PLAN"] as const;
export type WorkspaceItemKind = (typeof WORKSPACE_ITEM_KINDS)[number];

/**
 * The four states the calendar must keep visually distinct.
 *
 * PLANNED belongs to the Content Calendar Assistant and is a different model
 * entirely; the other three are Content. Keeping them in one union makes it
 * impossible to render a plan as a schedule, or a schedule as a publication,
 * by accident.
 */
export const WORKSPACE_ITEM_STATES = ["PLANNED", "DRAFT", "SCHEDULED", "PUBLISHED"] as const;
export type WorkspaceItemState = (typeof WORKSPACE_ITEM_STATES)[number];

export const STATE_LABELS: Record<WorkspaceItemState, string> = {
  PLANNED: "Planned",
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
};

export const KIND_LABELS: Record<WorkspaceItemKind, string> = {
  CONTENT: "Content",
  PLAN: "Planned",
};

export type WorkspaceItem = {
  id: string;
  kind: WorkspaceItemKind;
  title: string;
  /** `yyyy-MM-dd`, or null when the record genuinely carries no calendar date. */
  date: string | null;
  /** How that date should be described to the user — never guessed. */
  dateLabel: string | null;
  /** The record's own status, from its own lifecycle. */
  status: string;
  /** Which of the four distinct calendar states this item is in. */
  state: WorkspaceItemState;
  statusLabel: string;
  /** Optional: a client-owned record has no SEO project. */
  seoProjectId: string | null;
  seoProjectName: string | null;
  clientId: string | null;
  clientName: string | null;
  /** Content type, only where the record genuinely has one. Content rows do not. */
  contentType: string | null;
  /** Where clicking the item should go — an existing route, never a new one. */
  href: string;
  /** Extra context for the detail panel; only fields that really exist. */
  detail: {
    url?: string | null;
    keywordTerm?: string | null;
    role?: string | null;
    calendarName?: string | null;
    notes?: string | null;
    generatedByAi?: boolean;
    lastModified?: string | null;
  };
};

const CONTENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

const PLAN_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  BRIEF_CREATED: "Brief created",
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  PUBLISHED: "Published",
  COMPLETED: "Completed",
};

const PLAN_TYPE_LABELS: Record<string, string> = {
  ARTICLE: "Article",
  GUIDE: "Guide",
  LANDING_PAGE: "Landing page",
  FAQ_PAGE: "FAQ page",
  CASE_STUDY: "Case study",
  COMPARISON: "Comparison",
  OTHER: "Other",
  /*
   * The five real Content types share this lookup. They are not plan types,
   * but the calendar mixes both kinds of item and labels them the same way,
   * so one map keeps the two from drifting apart.
   */
  SOCIAL_POST: "Social post",
  BLOG_POST: "Blog post",
  SEO_CONTENT: "SEO content",
  NEWSLETTER: "Newsletter",
  PRESS_RELEASE: "Press release",
};

const PLAN_ROLE_LABELS: Record<string, string> = { PILLAR: "Pillar", SUPPORTING: "Supporting", RELATED: "Related" };

export function contentStatusLabel(status: string): string {
  return CONTENT_STATUS_LABELS[status] ?? status;
}

export function planStatusLabel(status: string): string {
  return PLAN_STATUS_LABELS[status] ?? status;
}

export function planTypeLabel(type: string): string {
  return PLAN_TYPE_LABELS[type] ?? type;
}

/**
 * The short badge a calendar card shows, so an item's kind is readable
 * without opening it.
 *
 * Text rather than colour alone — a colour-only signal is unreadable for a
 * meaningful share of users and disappears entirely in print. Returns null
 * for an item whose type genuinely is not recorded, so nothing is invented.
 */
/**
 * The five REAL content types, as opposed to the planned-item vocabulary
 * (ARTICLE, GUIDE, LANDING_PAGE…) that shares the same label lookup.
 *
 * Exported because the workspace needs to tell the two apart: content types
 * belong in the context bar, plan types in the filter panel.
 */
export const CONTENT_TYPE_KEYS: readonly string[] = ["SOCIAL_POST", "BLOG_POST", "SEO_CONTENT", "NEWSLETTER", "PRESS_RELEASE"];

const CONTENT_TYPE_BADGES: Record<string, string> = {
  SOCIAL_POST: "SOCIAL",
  BLOG_POST: "BLOG",
  SEO_CONTENT: "SEO",
  NEWSLETTER: "NEWSLETTER",
  PRESS_RELEASE: "PRESS RELEASE",
};

export function contentTypeBadge(type: string | null): string | null {
  if (type === null) return null;
  return CONTENT_TYPE_BADGES[type] ?? null;
}

// ---------------------------------------------------------------------------
// Shaping — pure, so the placement rules are testable without a database
// ---------------------------------------------------------------------------

export type ContentRow = {
  id: string;
  title: string;
  url: string | null;
  status: string;
  publishedAt: Date | null;
  /** Phase 5 — the intended publication instant, UTC. Null unless SCHEDULED. */
  scheduledAt?: Date | null;
  /** Phase 5 — the zone that instant was chosen in. Null unless SCHEDULED. */
  scheduledTimezone?: string | null;
  /** Phase 6 — present only when the row is a social post. */
  socialPost?: { id: string } | null;
  updatedAt: Date;
  generatedByAi: boolean;
  clientId: string | null;
  client: { id: string; name: string } | null;
  /** The record's own type. Null only where it genuinely was never recorded. */
  contentType: string | null;
  seoProjectId: string | null;
  seoProject: { id: string; name: string; clientId: string | null; client: { name: string } | null } | null;
};

export type PlanRow = {
  id: string;
  topic: string;
  scheduledDate: Date;
  status: string;
  contentType: string;
  role: string;
  notes: string | null;
  contentId: string | null;
  keyword: { term: string } | null;
  calendar: { id: string; name: string; seoProject: { id: string; name: string; clientId: string | null; client: { name: string } | null } };
};

/**
 * Shapes a real page into a workspace item.
 *
 * The date is `publishedAt` and nothing else. When it is absent the item
 * carries `date: null`, which is what keeps it off the grid instead of being
 * placed on its creation or update date — neither of which is a publishing
 * date, and showing one as though it were would be a fabrication.
 */
export function toContentItem(row: ContentRow): WorkspaceItem {
  /*
   * Phase 5 — a scheduled page sits on the day the user INTENDED, read in the
   * zone they chose. Using the UTC day instead would move a 23:00 New York
   * schedule onto the following day on the calendar, which is not the day the
   * person picked.
   *
   * A schedule counts only when both fields are present and the status agrees;
   * a half-written row is treated as having no schedule rather than being
   * placed on a date it cannot justify.
   */
  const scheduled =
    row.status === "SCHEDULED" && row.scheduledAt && row.scheduledTimezone
      ? (instantToZonedParts(row.scheduledAt, row.scheduledTimezone)?.dateIso ?? null)
      : null;
  const published = row.publishedAt ? formatIsoDate(row.publishedAt) : null;

  return {
    id: `content-${row.id}`,
    kind: "CONTENT",
    title: row.title,
    date: scheduled ?? published,
    dateLabel: scheduled ? "Scheduled" : published ? "Published" : null,
    status: row.status,
    state: scheduled ? "SCHEDULED" : row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    statusLabel: contentStatusLabel(row.status),
    seoProjectId: row.seoProject?.id ?? null,
    seoProjectName: row.seoProject?.name ?? null,
    clientId: row.clientId ?? row.seoProject?.clientId ?? null,
    clientName: row.client?.name ?? row.seoProject?.client?.name ?? null,
    /*
     * The record's own recorded type. The social-half fallback remains for
     * the one case it still proves something: a social post whose column was
     * somehow never written is still, demonstrably, a social post.
     */
    contentType: row.contentType ?? (row.socialPost ? "SOCIAL_POST" : null),
    href: contentDetailHref({ id: row.id, seoProjectId: row.seoProjectId }),
    detail: {
      url: row.url,
      generatedByAi: row.generatedByAi,
      lastModified: formatIsoDate(row.updatedAt),
    },
  };
}

/**
 * Shapes a saved plan entry into a workspace item.
 *
 * When the entry links to a real page, clicking it opens THAT page — the plan
 * is not a second content record and must not pretend to be one. Otherwise it
 * opens the saved calendar it belongs to, which is an existing route.
 */
export function toPlanItem(row: PlanRow): WorkspaceItem {
  const project = row.calendar.seoProject;
  return {
    id: `plan-${row.id}`,
    kind: "PLAN",
    title: row.topic,
    date: formatIsoDate(row.scheduledDate),
    dateLabel: "Planned for",
    status: row.status,
    // Always PLANNED — a Content Calendar Assistant entry is never a Content
    // schedule, whatever its own lifecycle status says.
    state: "PLANNED",
    statusLabel: planStatusLabel(row.status),
    seoProjectId: project.id,
    seoProjectName: project.name,
    clientId: project.clientId,
    clientName: project.client?.name ?? null,
    contentType: row.contentType,
    href: row.contentId ? `/seo/${project.id}/content/${row.contentId}` : `/ai/content-calendar/${row.calendar.id}`,
    detail: {
      keywordTerm: row.keyword?.term ?? null,
      role: PLAN_ROLE_LABELS[row.role] ?? row.role,
      calendarName: row.calendar.name,
      notes: row.notes,
    },
  };
}

// ---------------------------------------------------------------------------
// Filtering — display only; nothing here touches the database
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/**
 * The text one item is searchable by.
 *
 * Only fields the record genuinely carries — a page's title and project, a
 * planned item's topic, its target keyword, its planning notes and the
 * calendar it came from. Nothing is inferred, and the status LABEL is included
 * so searching "draft" behaves the way a user expects.
 */
export function searchableText(item: WorkspaceItem): string {
  return [
    item.title,
    item.seoProjectName,
    item.clientName ?? "",
    item.statusLabel,
    item.contentType ? planTypeLabel(item.contentType) : "",
    item.detail.keywordTerm ?? "",
    item.detail.calendarName ?? "",
    item.detail.notes ?? "",
    item.detail.url ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** Case- and whitespace-insensitive substring match over the fields above. */
export function matchesSearch(item: WorkspaceItem, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  return searchableText(item).includes(needle);
}

export type WorkspaceFilters = {
  clientIds: string[];
  seoProjectIds: string[];
  kinds: WorkspaceItemKind[];
  statuses: string[];
  /**
   * Phase 3 — content type. Only PLANNED items carry one, because the Content
   * model has no type column, so selecting a type necessarily narrows to
   * planned items. The UI labels the group to say exactly that rather than
   * leaving the user to infer it.
   */
  contentTypes: string[];
  search: string;
};

export const EMPTY_FILTERS: WorkspaceFilters = { clientIds: [], seoProjectIds: [], kinds: [], statuses: [], contentTypes: [], search: "" };

/** The sentinel for "belongs to no client", so that group is filterable like any other. */
export const NO_CLIENT = "__none__";

/**
 * Applies the display filters. An empty list for a dimension means "no
 * restriction on that dimension" rather than "match nothing" — which is what
 * makes an untouched filter panel show everything.
 *
 * Statuses are matched as `KIND:STATUS`, because a content status and a plan
 * status are different vocabularies that happen to share some words. Matching
 * on the bare value would let "Published" from one lifecycle silently select
 * items from the other.
 */
export function statusKey(kind: WorkspaceItemKind, status: string): string {
  return `${kind}:${status}`;
}

export function filterItems(items: readonly WorkspaceItem[], filters: WorkspaceFilters): WorkspaceItem[] {
  return items.filter((item) => {
    if (filters.kinds.length > 0 && !filters.kinds.includes(item.kind)) return false;
    /*
     * A project filter NARROWS. An item with no project cannot satisfy one,
     * so it drops out — the filter never widens the scope back.
     */
    if (filters.seoProjectIds.length > 0 && (item.seoProjectId === null || !filters.seoProjectIds.includes(item.seoProjectId))) return false;
    if (filters.clientIds.length > 0 && !filters.clientIds.includes(item.clientId ?? NO_CLIENT)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(statusKey(item.kind, item.status))) return false;

    // An item with no type can never satisfy a type restriction — which is
    // why choosing a type narrows to planned items by construction.
    if (filters.contentTypes.length > 0 && (item.contentType === null || !filters.contentTypes.includes(item.contentType))) return false;

    return matchesSearch(item, filters.search);
  });
}

/** Items that can appear on the grid — those with a real calendar date. */
export function datedItems(items: readonly WorkspaceItem[]): WorkspaceItem[] {
  return items.filter((item) => item.date !== null);
}

/** Items with no calendar date. Listed separately, never placed on a guessed day. */
export function undatedItems(items: readonly WorkspaceItem[]): WorkspaceItem[] {
  return items.filter((item) => item.date === null);
}

/** Groups dated items by their day, so a grid cell is one lookup. */
export function groupByDate(items: readonly WorkspaceItem[]): Map<string, WorkspaceItem[]> {
  const byDate = new Map<string, WorkspaceItem[]>();
  for (const item of items) {
    if (item.date === null) continue;
    const bucket = byDate.get(item.date);
    if (bucket) bucket.push(item);
    else byDate.set(item.date, [item]);
  }
  // Content before plans within a day, then alphabetical — a stable order, so
  // the grid does not reshuffle between renders.
  for (const bucket of byDate.values()) {
    bucket.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "CONTENT" ? -1 : 1));
  }
  return byDate;
}

/** Counts per dimension, so the filter panel can show how much each option would match. */
export function countBy(items: readonly WorkspaceItem[], key: (item: WorkspaceItem) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
