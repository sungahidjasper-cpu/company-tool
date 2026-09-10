"use client";

import { Power } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SocialAccountSummary } from "@/features/social/schemas/social-account.schema";
import { describeAvailability } from "@/features/social/services/social-connection-status";

/**
 * Phase 9C — the OTHER half of an account row, kept visually and
 * structurally apart from SocialConnectionRow on purpose.
 *
 * "Enabled" used to be the only badge an account carried, which is exactly
 * how it came to be misread as "this is working" — Phase 9 separated the two
 * facts in the data; this component is what makes them read as two separate
 * facts on screen. It uses describeAvailability, the SAME wording function
 * the rest of the app would use, so this can never say something different
 * from what Phase 9's own model intends.
 *
 * Never mentions the platform, connection, or authorization — this block is
 * only ever about whether Cloud Compass itself offers the account.
 */
export default function SocialAvailabilityRow({
  account,
  isPending,
  onToggle,
}: {
  account: SocialAccountSummary;
  isPending: boolean;
  onToggle: () => void;
}) {
  const availability = describeAvailability(account.status);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-3">
      <span className="w-32 shrink-0 text-xs font-medium tracking-wide text-slate-400 uppercase">Cloud Compass</span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          account.status === "ACTIVE" ? "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-400"
        }`}
      >
        {availability.label}
      </span>
      <span className="min-w-0 flex-1 text-xs text-slate-500">{availability.detail}</span>
      <Button type="button" variant="outline" size="sm" onClick={onToggle} disabled={isPending}>
        <Power size={14} /> {account.status === "ACTIVE" ? "Disable" : "Enable"}
      </Button>
    </div>
  );
}
