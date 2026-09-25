import { Compass } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Public legal-page chrome, shared by /privacy and /data-deletion.
 *
 * Deliberately outside the authenticated app shell — no sidebar, no session
 * check, no data fetching. Meta (and anyone else) must be able to load this
 * with no Cloud Compass account at all.
 */
export default function LegalPageShell({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-6 py-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <Compass size={18} className="text-[#2F4156]" />
          </span>
          <Link href="/" className="text-sm font-semibold text-slate-800 hover:underline">
            Cloud Compass OS
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">Last updated: {lastUpdated}</p>

        <div className="prose-legal mt-8 flex flex-col gap-8 text-sm leading-relaxed text-slate-700">
          {children}
        </div>
      </main>
    </div>
  );
}

/** One numbered/titled section, so every section in both pages shares the same rhythm. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-base font-semibold text-slate-900">{heading}</h2>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}
