"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ImageAltTextResult } from "@/features/ai-workspace/schemas/image-alt-text.schema";

/**
 * The copied value is the alt text ALONE — no labels, no reasoning, no
 * character count, no ids, no provider metadata. It is going straight into an
 * `alt` attribute, so anything else would have to be deleted by hand.
 */
export function formatAltTextForCopy(result: ImageAltTextResult): string {
  return result.altText;
}

type ImageAltTextReviewProps = {
  result: ImageAltTextResult;
};

/**
 * Read-only display of the generated alt text plus a copy action.
 *
 * Deliberately no Apply control: the File model carries no altText column, so
 * there is no existing safe update path to apply through, and inventing one
 * would mean building persistence to serve the AI tool.
 */
export default function ImageAltTextReview({ result }: ImageAltTextReviewProps) {
  async function handleCopy() {
    await navigator.clipboard.writeText(formatAltTextForCopy(result));
    toast.success("Copied alt text to clipboard");
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">Generated alt text</p>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">Not saved — copy to use it</span>
      </div>

      {/*
        The alt text itself, in a region a screen-reader user can reach and
        read directly. `lang` is not set: the copy may be in the brand's own
        language, and asserting the wrong one would be worse than asserting none.
      */}
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm break-words text-slate-900" data-testid="alt-text-value">
        {result.altText}
      </p>

      <p className="text-xs text-slate-500">
        {result.characterCount} characters. Written from your description — the AI did not see the image, so check it against the picture before using it.
      </p>

      {result.lengthGuidance && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{result.lengthGuidance}</p>}

      {result.accessibilityNote && (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Accessibility note</p>
          <p className="text-sm text-slate-600">{result.accessibilityNote}</p>
        </div>
      )}

      <div className="rounded-lg bg-slate-50 p-3">
        <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Reasoning</p>
        <p className="text-sm text-slate-600">{result.reasoning}</p>
      </div>

      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
          Copy alt text
        </Button>
      </div>
    </div>
  );
}
