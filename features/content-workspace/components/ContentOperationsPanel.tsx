import { FileEdit, Link2, Lock, Mail, MessageSquareText, ShieldCheck, Sparkles, Tags, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  UNAVAILABLE_OPERATIONS,
  type ContentOperation,
  type ContentOperationKey,
  type ContentOperationSection,
} from "@/features/content-workspace/services/content-operations";

/**
 * Phase 4 — the Content Operations panel on a Content record.
 *
 * A server component: it renders a resolved list and holds no state, so it
 * needs no client bundle. All decisions were already made by the pure
 * buildContentOperations, which is what keeps this file free of eligibility
 * rules of its own.
 *
 * The important property: an unavailable operation renders as TEXT with its
 * reason, never as a control. There is no disabled button here, because a
 * disabled button invites clicking and explains nothing.
 */

const ICONS: Record<ContentOperationKey, LucideIcon> = {
  META_TAGS: Tags,
  REWRITE: FileEdit,
  INTERNAL_LINKS: Link2,
  LONG_FORM: Sparkles,
  SOCIAL_SNIPPETS: MessageSquareText,
  NEWSLETTER: Mail,
  SCHEMA: ShieldCheck,
};

function OperationRow({ operation }: { operation: ContentOperation }) {
  const Icon = ICONS[operation.key];

  if (operation.href === null) {
    return (
      <div className="flex min-w-0 items-start gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2.5">
        <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{operation.label}</p>
          <p className="mt-0.5 text-xs leading-snug text-slate-500">{operation.unavailableReason}</p>
        </div>
      </div>
    );
  }

  return (
    <Link
      href={operation.href}
      className="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <Icon size={16} className="mt-0.5 shrink-0 text-slate-600" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{operation.label}</p>
        <p className="mt-0.5 text-xs leading-snug text-slate-500">{operation.description}</p>
      </div>
    </Link>
  );
}

export default function ContentOperationsPanel({
  sections,
  unavailableReason,
}: {
  sections: ContentOperationSection[];
  /** Set when the panel as a whole is unavailable; `sections` is then empty. */
  unavailableReason: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Content operations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {unavailableReason ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">{unavailableReason}</p>
        ) : (
          sections.map((section) => (
            <div key={section.key} className="flex flex-col gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                <p className="text-xs leading-snug text-slate-500">{section.description}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {section.operations.map((operation) => (
                  <OperationRow key={operation.key} operation={operation} />
                ))}
              </div>
            </div>
          ))
        )}

        {/*
          Listed without controls on purpose. The content workspace roadmap
          promises scheduling and social publishing; saying plainly that they
          do not exist yet is the honest alternative to either hiding them
          (leaving the user to wonder whether it is a permission problem) or
          showing a button that cannot work.
        */}
        <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-2">
            <Lock size={14} className="shrink-0 text-slate-400" />
            <p className="text-sm font-semibold text-slate-700">Not available yet</p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {UNAVAILABLE_OPERATIONS.map((entry) => (
              <li key={entry.label} className="text-xs leading-snug text-slate-500">
                <span className="font-medium text-slate-600">{entry.label}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
