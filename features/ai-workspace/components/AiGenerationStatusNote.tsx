"use client";

/**
 * Phase B B3.3 — a one-line status note for the seven pickers that previously
 * showed nothing while the system fell back to a backup provider.
 *
 * The shared generation lifecycle hook already tracks and exposes
 * `isSwitchingProvider`; only Content Brief and Long-Form ever read it, so
 * everywhere else a fallback looked like a frozen progress bar. Given how
 * often the primary provider is unavailable in practice, a switch is a normal
 * event rather than an edge case, and the user deserves to know generation is
 * restarting rather than stuck.
 *
 * Deliberately reuses Content Brief's exact existing wording so the two
 * treatments stay identical, and deliberately says nothing about which
 * provider, why, or any other internal detail. Renders nothing unless a
 * switch is actually in progress — this is not a provider-status readout.
 */
export default function AiGenerationStatusNote({ isSwitchingProvider }: { isSwitchingProvider: boolean }) {
  if (!isSwitchingProvider) return null;
  return <p className="text-sm text-slate-500">Switching to backup AI provider — restarting…</p>;
}
