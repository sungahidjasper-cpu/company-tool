/**
 * Phase 5 — the timezone list offered when scheduling.
 *
 * Data-driven, not a hard-coded table: the zones come from the runtime's own
 * IANA database via Intl. A curated list would go stale, and inventing one
 * would mean offering zones the server might then reject.
 */

/**
 * The zones a picker may offer, with `preferred` guaranteed present and first.
 *
 * `Intl.supportedValuesOf` is widely available but not universal, so a small
 * fallback keeps the control usable rather than empty. UTC is always included
 * because it is the one zone that is unambiguous everywhere.
 */
export function timeZoneOptions(preferred?: string | null): string[] {
  let all: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === "function") all = supported("timeZone");
  } catch {
    all = [];
  }

  if (all.length === 0) {
    // Enough to schedule with when the runtime cannot enumerate zones.
    all = ["UTC", browserTimeZone()].filter((zone, index, list) => zone && list.indexOf(zone) === index);
  }

  const ordered = ["UTC", ...all.filter((zone) => zone !== "UTC")];
  if (preferred && !ordered.includes(preferred)) ordered.unshift(preferred);
  if (preferred) return [preferred, ...ordered.filter((zone) => zone !== preferred)];
  return ordered;
}

/** The reader's own zone, or UTC when the runtime will not say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
