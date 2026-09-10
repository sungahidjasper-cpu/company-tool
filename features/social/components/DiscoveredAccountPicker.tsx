"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import PlatformMark from "@/features/social/components/PlatformMark";
import { selectDiscoveredAccountAction } from "@/features/social/actions/social-connection.actions";
import type { DiscoveredAccount } from "@/features/social/services/social-provider";
import { platformDefinition } from "@/features/social/services/social-platforms";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 9 — picking which page the provider reported.
 *
 * EVERYTHING RENDERED HERE CAME FROM THE PROVIDER. The names and ids are
 * Meta's own, passed through from the callback. There is no text input: a
 * person cannot type a page id, which is the whole reason this screen exists
 * instead of an "external ID" field.
 *
 * The server re-confirms the chosen id against the provider before storing
 * anything, so even this list is not taken on trust.
 */
export default function DiscoveredAccountPicker({
  clientId,
  accounts,
  platform,
}: {
  clientId: string;
  accounts: DiscoveredAccount[];
  platform: SocialPlatform;
}) {
  const router = useRouter();
  const definition = platformDefinition(platform);
  const [selected, setSelected] = useState<string | null>(accounts.length === 1 ? accounts[0].externalId : null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const accountsPath = `/settings/clients/${clientId}/social-accounts`;

  function connect() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      /*
       * Only the page id is sent. Which authorization this finishes comes
       * from the httpOnly cookie the callback set, which script cannot read
       * and this component never sees.
       */
      const result = await selectDiscoveredAccountAction({ externalId: selected });
      if (!result.success) {
        setError(result.message);
        return;
      }
      toast.success(`${result.data.displayName} connected`);
      router.push(accountsPath);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {accounts.map((account) => {
          const isSelected = selected === account.externalId;
          return (
            <li key={account.externalId}>
              <button
                type="button"
                onClick={() => setSelected(account.externalId)}
                aria-pressed={isSelected}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  isSelected ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <PlatformMark platform={platform} decorative />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-slate-700">{account.name}</span>
                  {/* The provider's own id, shown so a person can tell two similarly-named pages apart. */}
                  <span className="truncate text-xs text-slate-500">
                    {definition.accountNoun} ID {account.externalId}
                    {account.handle ? ` · ${account.handle}` : ""}
                  </span>
                </span>
                {isSelected && <Check size={16} className="shrink-0 text-slate-900" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={connect} disabled={isPending || selected === null}>
          Connect this {definition.accountNoun.toLowerCase()}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(accountsPath)} disabled={isPending}>
          Cancel
        </Button>
        <span className="text-xs text-slate-500">
          Cancelling connects nothing and leaves this client&rsquo;s accounts unchanged.
        </span>
      </div>
    </div>
  );
}
