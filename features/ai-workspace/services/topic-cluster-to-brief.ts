import type { ContentBriefType } from "@/features/ai-workspace/schemas/content-brief.schema";
import type { TopicContentType, TopicSupportingTopic } from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";
import type { BriefHandoff } from "@/features/ai-workspace/services/content-gap-to-brief";

/**
 * Topic Cluster Planner → Content Brief.
 *
 * Deliberately reuses `BriefHandoff` and `buildBriefHandoffHref` from
 * content-gap-to-brief.ts rather than inventing a second hand-off contract:
 * the Brief route already reads exactly those query params, and a second
 * mechanism would be two things to keep correct instead of one.
 *
 * Pure functions only — no state, no I/O, no AI. The values carry NO
 * authority: they are form prefills. The Brief's own action re-derives the
 * company from the authenticated actor and re-verifies the project id, so a
 * hand-crafted URL can only ever prefill fields the user could have typed.
 */

/**
 * Maps this tool's content-type vocabulary onto the Brief's existing enum.
 *
 * No enum is widened to accommodate AI wording. Types with no honest
 * equivalent (FAQ_PAGE, CASE_STUDY, COMPARISON) map to OTHER rather than
 * being forced into a shape that misdescribes them — the same conservative
 * choice mapGapContentTypeToBriefType already made for the same reason.
 * Null means "no prefill; let the user choose", never a guessed default.
 */
const TOPIC_TYPE_TO_BRIEF_TYPE: Record<TopicContentType, ContentBriefType> = {
  ARTICLE: "BLOG_POST",
  GUIDE: "PILLAR_PAGE",
  LANDING_PAGE: "LANDING_PAGE",
  FAQ_PAGE: "OTHER",
  CASE_STUDY: "OTHER",
  COMPARISON: "OTHER",
};

export function mapTopicContentTypeToBriefType(suggested: string | null | undefined): ContentBriefType | null {
  if (!suggested) return null;
  return TOPIC_TYPE_TO_BRIEF_TYPE[suggested as TopicContentType] ?? null;
}

export type SelectedTopicForBrief = {
  primaryTopic: string;
  clusterName: string;
  topic: TopicSupportingTopic;
  /** The user's own audience/notes from the planner form, carried through unchanged. */
  audience?: string;
};

/**
 * Composes one selected supporting topic into the Brief's existing `notes`
 * field.
 *
 * `notes` is the correct carrier for the same reason the Content Gap hand-off
 * uses it: contentBriefInputSchema has no dedicated topic field, and notes is
 * already free text, already fed to the prompt, and — most importantly —
 * already visible and editable, so the user reviews this context before it
 * influences anything.
 *
 * The hierarchy is preserved in the text (primary topic → cluster → topic →
 * subtopics) because that structure is the whole point of the planner. Only
 * fields the topic genuinely carries are included; the overlap note is
 * deliberately omitted — it is guidance for the planning screen, not context
 * the brief writer should treat as fact about the page being briefed.
 */
export function buildBriefNotesFromTopic(selection: SelectedTopicForBrief): string {
  const { primaryTopic, clusterName, topic } = selection;
  const lines: string[] = [
    `Primary topic: ${primaryTopic}`,
    `Topic cluster: ${clusterName}`,
    `Target topic for this page: ${topic.topic}`,
  ];

  if (topic.relationshipToPillar.trim()) lines.push(`How it supports the cluster: ${topic.relationshipToPillar.trim()}`);
  if (topic.rationale.trim()) lines.push(`Why it matters: ${topic.rationale.trim()}`);
  if (topic.searchIntent) lines.push(`Suggested search intent: ${topic.searchIntent}`);
  if (topic.subtopics.length > 0) lines.push(`Subtopics to cover:\n${topic.subtopics.map((s) => `- ${s}`).join("\n")}`);
  if (topic.relatedKeywords.length > 0) lines.push(`Related existing keywords in this project: ${topic.relatedKeywords.join(", ")}`);
  if (topic.existingCoverage.status === "POSSIBLE_MATCH" && topic.existingCoverage.matchedTitle) {
    lines.push(`Potential existing coverage: "${topic.existingCoverage.matchedTitle}" (title match only — review before writing).`);
  }
  if (selection.audience?.trim()) lines.push(`Target audience: ${selection.audience.trim()}`);

  return lines.join("\n\n");
}

/**
 * Builds the hand-off for ONE selected supporting topic. Returns null when
 * the selection has no usable topic or project, so the caller can decline to
 * offer the action rather than starting a brief from nothing.
 *
 * One brief per topic is deliberate: a Content Brief describes a single page,
 * and the existing Brief → Content → Long-Form workflow creates one Content
 * record from one brief. Bundling several topics into one brief would produce
 * a page that tries to be several pages — precisely the outcome this planner
 * exists to avoid.
 */
export function buildTopicBriefHandoff(seoProjectId: string, selection: SelectedTopicForBrief): BriefHandoff | null {
  if (!seoProjectId.trim() || !selection.topic.topic.trim() || !selection.primaryTopic.trim()) return null;

  const contentType = mapTopicContentTypeToBriefType(selection.topic.suggestedContentType);
  return {
    seoProjectId,
    notes: buildBriefNotesFromTopic(selection),
    ...(contentType ? { contentType } : {}),
  };
}
