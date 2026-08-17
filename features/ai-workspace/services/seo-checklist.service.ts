import type { ContentBriefOutput } from "@/features/ai-workspace/schemas/content-brief.schema";
import type { ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";

export type LengthStatus = "OK" | "TOO_SHORT" | "TOO_LONG";

export type LengthCheck = {
  length: number;
  min: number;
  max: number;
  status: LengthStatus;
};

function checkLength(value: string, min: number, max: number): LengthCheck {
  const length = value.length;
  const status: LengthStatus = length < min ? "TOO_SHORT" : length > max ? "TOO_LONG" : "OK";
  return { length, min, max, status };
}

/**
 * Pure, deterministic, computed client-side on every render/edit — never a
 * blocking gate. Meta title target 50-60 chars, meta description 150-160,
 * matching Google's commonly-cited SERP truncation points.
 */
export function checkMetaLengths(brief: Pick<ContentBriefOutput, "metaTitle" | "metaDescription">): {
  metaTitle: LengthCheck;
  metaDescription: LengthCheck;
} {
  return {
    metaTitle: checkLength(brief.metaTitle, 50, 60),
    metaDescription: checkLength(brief.metaDescription, 150, 160),
  };
}

/** Pure word count — used for the soft target-vs-actual display, never for a hard gate/regenerate loop. */
export function computeWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export type ChecklistItemStatus = "PASS" | "WARN";

export type ChecklistItem = {
  id: string;
  label: string;
  status: ChecklistItemStatus;
  detail: string;
};

function keywordAppearsIn(keyword: string | undefined, ...values: string[]): boolean {
  if (!keyword) return true; // nothing to check against — don't manufacture a warning
  const needle = keyword.toLowerCase();
  return values.some((value) => value.toLowerCase().includes(needle));
}

/**
 * Rule-based, deterministic scoring — NOT a second AI call. Every item is
 * ✅/⚠ so a user can see exactly what's missing rather than guessing why an
 * opaque numeric score is low. `targetKeyword` is optional: when absent
 * (ad-hoc/notes-only generation), keyword-presence checks are skipped
 * entirely rather than warning about something the user never specified.
 */
export function computeSeoChecklist(brief: ContentBriefOutput, settings: ContentBriefSettings, targetKeyword?: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const lengths = checkMetaLengths(brief);

  items.push({
    id: "meta-title-length",
    label: "Meta title length (50-60 chars)",
    status: lengths.metaTitle.status === "OK" ? "PASS" : "WARN",
    detail: `${lengths.metaTitle.length} characters`,
  });
  items.push({
    id: "meta-description-length",
    label: "Meta description length (150-160 chars)",
    status: lengths.metaDescription.status === "OK" ? "PASS" : "WARN",
    detail: `${lengths.metaDescription.length} characters`,
  });

  if (targetKeyword) {
    items.push({
      id: "keyword-in-title",
      label: "Target keyword present in title",
      status: keywordAppearsIn(targetKeyword, brief.title) ? "PASS" : "WARN",
      detail: brief.title,
    });
    items.push({
      id: "keyword-in-meta-title",
      label: "Target keyword present in meta title",
      status: keywordAppearsIn(targetKeyword, brief.metaTitle) ? "PASS" : "WARN",
      detail: brief.metaTitle,
    });
    items.push({
      id: "keyword-in-meta-description",
      label: "Target keyword present in meta description",
      status: keywordAppearsIn(targetKeyword, brief.metaDescription) ? "PASS" : "WARN",
      detail: brief.metaDescription,
    });
  }

  items.push({
    id: "outline-count",
    label: `Outline has the requested ${settings.outline.h2Count} sections`,
    status: brief.outline.length >= settings.outline.h2Count ? "PASS" : "WARN",
    detail: `${brief.outline.length} of ${settings.outline.h2Count} requested`,
  });

  if (settings.sections.internalLinks) {
    items.push({
      id: "internal-links",
      label: "Internal-link suggestions present",
      status: brief.internalLinkSuggestions.length > 0 ? "PASS" : "WARN",
      detail: `${brief.internalLinkSuggestions.length} suggestion(s)`,
    });
  }
  if (settings.sections.externalSources) {
    items.push({
      id: "external-sources",
      label: "External-source suggestions present",
      status: brief.externalSources.length > 0 ? "PASS" : "WARN",
      detail: `${brief.externalSources.length} suggestion(s)`,
    });
  }
  if (settings.sections.faq) {
    items.push({
      id: "faq",
      label: `FAQ has the requested ${settings.faqConfig.count} items`,
      status: brief.faq.length >= settings.faqConfig.count ? "PASS" : "WARN",
      detail: `${brief.faq.length} of ${settings.faqConfig.count} requested`,
    });
  }
  if (settings.sections.cta) {
    const hasCta = Boolean(settings.cta.title || settings.cta.text || settings.cta.buttonText);
    items.push({
      id: "cta",
      label: "CTA configured",
      status: hasCta ? "PASS" : "WARN",
      detail: hasCta ? "CTA fields provided" : "No CTA text/title/button provided",
    });
  }
  if (settings.qualityControls.includeEeatSignals) {
    items.push({
      id: "eeat",
      label: "EEAT signals noted",
      status: brief.geoAeoNotes.trim().length > 0 ? "PASS" : "WARN",
      detail: brief.geoAeoNotes || "No notes generated",
    });
  }

  return items;
}
