import { Button } from "@/components/ui/button";
import ArticleMarkdownPreview from "@/features/ai-workspace/components/ArticleMarkdownPreview";
import type { ContentRewriteResult } from "@/features/ai-workspace/schemas/content-rewriter.schema";

/**
 * Whether the combined AI `reasoning` can be safely shown verbatim — the
 * exact Meta Tag Optimizer lesson, extended from two fields to four.
 * `reasoning` is one combined blob that can describe any of the four
 * fields regardless of which ones actually changed, so it is only safe to
 * display when EVERY field changed (nothing it says about any field can
 * then be a false claim about an unchanged one). Any other combination
 * falls back to a deterministic "which fields changed" statement built
 * from the same boolean flags — never from the reasoning text, never a
 * partial edit of it.
 */
export type ContentRewriteReasoningDisplay = "ALL_CHANGED" | "PARTIAL" | "NO_CHANGE";

export function computeContentRewriteReasoningDisplay(
  titleChanged: boolean,
  metaTitleChanged: boolean,
  metaDescriptionChanged: boolean,
  bodyChanged: boolean
): ContentRewriteReasoningDisplay {
  const changedCount = [titleChanged, metaTitleChanged, metaDescriptionChanged, bodyChanged].filter(Boolean).length;
  if (changedCount === 4) return "ALL_CHANGED";
  if (changedCount === 0) return "NO_CHANGE";
  return "PARTIAL";
}

/**
 * Splits the four field labels into "changed" and "unchanged" buckets from
 * the same deterministic flags — the raw material for the PARTIAL
 * deterministic message. Order is fixed (title, meta title, meta
 * description, body) regardless of which combination is present, so the
 * rendered sentence is stable and predictable.
 */
export function computeChangedFieldLabels(
  titleChanged: boolean,
  metaTitleChanged: boolean,
  metaDescriptionChanged: boolean,
  bodyChanged: boolean
): { changed: string[]; unchanged: string[] } {
  const entries: Array<[string, boolean]> = [
    ["title", titleChanged],
    ["meta title", metaTitleChanged],
    ["meta description", metaDescriptionChanged],
    ["body", bodyChanged],
  ];
  return {
    changed: entries.filter(([, isChanged]) => isChanged).map(([label]) => label),
    unchanged: entries.filter(([, isChanged]) => !isChanged).map(([label]) => label),
  };
}

/** "a" / "a and b" / "a, b, and c" — plain, no external dependency. */
export function formatFieldList(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/**
 * Whether the "Apply this rewrite" control should be shown at all — same
 * rule as Meta Tag Optimizer's own computeIsApplyEligible, scaled to four
 * fields. A rewrite with nothing changed has nothing to apply (the server's
 * own no-op detection in applyContentRewriteAction is the real safety net
 * regardless), and a rewrite already applied this session shouldn't offer
 * to be applied again — the user would need to regenerate to get a fresh
 * rewrite.
 */
export function computeCanApplyRewrite(
  titleChanged: boolean,
  metaTitleChanged: boolean,
  metaDescriptionChanged: boolean,
  bodyChanged: boolean,
  alreadyApplied: boolean
): boolean {
  if (alreadyApplied) return false;
  return titleChanged || metaTitleChanged || metaDescriptionChanged || bodyChanged;
}

function ChangeBadge({ changed }: { changed: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
        changed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"
      }`}
    >
      {changed ? "Changed" : "Unchanged"}
    </span>
  );
}

function FieldComparisonRow({ label, current, rewritten, changed }: { label: string; current: string; rewritten: string; changed: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current {label}</p>
        <p className="text-sm text-slate-600">{current || <span className="italic text-slate-400">none set</span>}</p>
      </div>
      <div className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rewritten {label}</p>
          <ChangeBadge changed={changed} />
        </div>
        <p className="text-sm text-slate-800">{rewritten}</p>
      </div>
    </div>
  );
}

type ContentRewriterReviewProps = {
  result: ContentRewriteResult;
  /** True once this exact rewrite has been successfully applied this session — flips the badge and hides the Apply control, matching Meta Tag Optimizer's own "Applied" badge convention. */
  isApplied: boolean;
  /** True while an apply request is in flight — disables the button and swaps its label, never a separate loading UI. */
  isApplying: boolean;
  /** Called on an explicit "Apply this rewrite" click, AFTER the confirm dialog — this component never calls it itself or on any automatic trigger. */
  onApply: () => void;
};

/**
 * The dedicated review component — current vs. rewritten for all four
 * fields, the scoped reasoning display, and the Stage E Apply control.
 * Purely presentational: no server action is ever called from inside this
 * component — onApply is invoked only in response to the user's own click
 * on the button rendered here, and the actual server call, confirm dialog,
 * and applied-state tracking all live in the caller (ContentRewriterPicker).
 *
 * The body fields are rendered through the existing ArticleMarkdownPreview
 * component (already used by LongFormContentReview.tsx) rather than a new
 * Markdown dependency — it builds real DOM nodes (never
 * dangerouslySetInnerHTML), so this is safe for AI-sourced text exactly the
 * way it already is for Long-Form content.
 */
export default function ContentRewriterReview({ result, isApplied, isApplying, onApply }: ContentRewriterReviewProps) {
  const display = computeContentRewriteReasoningDisplay(result.titleChanged, result.metaTitleChanged, result.metaDescriptionChanged, result.bodyChanged);
  const { changed, unchanged } = computeChangedFieldLabels(result.titleChanged, result.metaTitleChanged, result.metaDescriptionChanged, result.bodyChanged);
  const canApply = computeCanApplyRewrite(result.titleChanged, result.metaTitleChanged, result.metaDescriptionChanged, result.bodyChanged, isApplied);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">Rewrite preview</p>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            isApplied ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        >
          {isApplied ? "Applied" : "Not applied — review only"}
        </span>
      </div>

      <FieldComparisonRow label="title" current={result.currentTitle} rewritten={result.rewrittenTitle} changed={result.titleChanged} />
      <FieldComparisonRow label="meta title" current={result.currentMetaTitle ?? ""} rewritten={result.rewrittenMetaTitle} changed={result.metaTitleChanged} />
      <FieldComparisonRow
        label="meta description"
        current={result.currentMetaDescription ?? ""}
        rewritten={result.rewrittenMetaDescription}
        changed={result.metaDescriptionChanged}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Body</p>
          <ChangeBadge changed={result.bodyChanged} />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current</p>
            <ArticleMarkdownPreview title={result.currentTitle} body={result.currentBody} />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Rewritten</p>
            <ArticleMarkdownPreview title={result.rewrittenTitle} body={result.rewrittenBody} />
          </div>
        </div>
      </div>

      {display === "ALL_CHANGED" && (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Why this change</p>
          <p className="text-sm text-slate-600">{result.reasoning}</p>
        </div>
      )}

      {display === "NO_CHANGE" && (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-sm italic text-slate-500">No change suggested for this page — the AI returned the same title, meta title, meta description, and body already in place.</p>
        </div>
      )}

      {display === "PARTIAL" && (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-sm italic text-slate-500">
            Only the {formatFieldList(changed)} changed for this page — see the fields above. The {formatFieldList(unchanged)} {unchanged.length > 1 ? "are" : "is"} unchanged.
          </p>
        </div>
      )}

      {canApply && (
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={isApplying} onClick={onApply}>
            {isApplying ? "Applying…" : "Apply this rewrite"}
          </Button>
        </div>
      )}
    </div>
  );
}
