"use client";

import { Link2, Link2Off, RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PlatformConnectivity } from "@/features/social/schemas/social-connection.schema";
import type { SocialAccountSummary } from "@/features/social/schemas/social-account.schema";
import { describeConnection, describePlatformCapability } from "@/features/social/services/social-connection-status";
import { platformDefinition } from "@/features/social/services/social-platforms";

/**
 * Phase 9 — the connection half of one account row in client settings.
 * Phase 9E — the action slot now names the platform's own capability
 * (NOT_IMPLEMENTED / NOT_CONFIGURED / READY) instead of one merged "why not"
 * sentence, using the single describePlatformCapability function so this can
 * never disagree with the settings page's own platform cards.
 *
 * THE RULE IT ENFORCES IN THE UI: the words "Connected" appear only when
 * connectionState is CONNECTED. Everything else says, plainly, that Cloud
 * Compass has not connected — and a hand-added account says why.
 *
 * THE ACTION SLOT IS NEVER A DEAD BUTTON. When the platform is not READY, the
 * slot holds an inert, clearly-labelled span — "Configuration required" or
 * "Not available" — never an interactive-looking control a person would
 * press expecting something to happen. The explanatory sentence beneath it
 * still says why, in full, so the label is a name for the state, not the
 * whole of the explanation.
 *
 * NO OAUTH VOCABULARY. Connect, Connected, Reconnect, Disconnect, "needs
 * attention". No tokens, no scopes, no grants.
 */
export default function SocialConnectionRow({
  account,
  connectivity,
  isPending,
  onConnect,
  onDisconnect,
  onCheck,
}: {
  account: SocialAccountSummary;
  /** Whether this platform can be connected at all, and whether it is configured here. */
  connectivity: PlatformConnectivity | undefined;
  isPending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onCheck: () => void;
}) {
  const connection = describeConnection(account.connectionState);
  const capability = describePlatformCapability(connectivity);
  const definition = platformDefinition(account.platform);

  const dotClass = connection.isConnected
    ? "bg-emerald-500"
    : connection.needsAttention
      ? "bg-amber-500"
      : "bg-slate-300";

  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/*
          Labelled to match SocialAvailabilityRow's "CLOUD COMPASS" prefix, so
          the two facts read as two clearly separate rows rather than one
          badge with a caption — the whole point of Phase 9C.
        */}
        <span className="w-32 shrink-0 text-xs font-medium tracking-wide text-slate-400 uppercase">Connection</span>
        <span className="flex items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
          <span className="text-sm font-medium text-slate-700">{connection.label}</span>
        </span>

        <span className="min-w-0 flex-1 text-xs text-slate-500">{connection.detail}</span>

        {connection.action !== null && capability.state === "READY" && (
          <Button type="button" size="sm" onClick={onConnect} disabled={isPending}>
            <Link2 size={14} />
            {connection.action === "RECONNECT" ? `Reconnect ${definition.name}` : `Connect ${definition.name}`}
          </Button>
        )}

        {/*
          An honest stand-in for the action, never a functioning-looking
          control: a plain, muted, non-interactive span. A screen reader has
          nothing to "activate" here because there is nothing to activate.
        */}
        {connection.action !== null && capability.state !== "READY" && (
          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-400">
            {capability.state === "NOT_IMPLEMENTED" ? "Not available" : "Configuration required"}
          </span>
        )}

        {connection.isConnected && (
          <span className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={onCheck} disabled={isPending}>
              <RefreshCw size={14} /> Check
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDisconnect} disabled={isPending}>
              <Link2Off size={14} /> Disconnect
            </Button>
          </span>
        )}
      </div>

      {/*
        Why the action is absent, as full text. Only shown where the badge
        above appeared, so a CONNECTED account is not lectured about
        configuration it no longer needs.
      */}
      {connection.action !== null && capability.state !== "READY" && (
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {capability.detail}
            {capability.missingKeys.length > 0 && (
              /* Names of unset environment variables, never their values, and only for someone who may manage configuration. */
              <span className="text-slate-400"> Set {capability.missingKeys.join(" and ")} to enable it.</span>
            )}
          </span>
        </p>
      )}

      {/* The real platform identity, once a provider supplied one. A Page id is public. */}
      {account.externalId && (
        <p className="text-xs text-slate-400">
          {definition.accountNoun} ID {account.externalId} — confirmed by {definition.name}.
        </p>
      )}

      {account.lastCheckError && !connection.isConnected && (
        <p className="text-xs text-amber-700">{account.lastCheckError}</p>
      )}

      {connection.isConnected && account.lastCheckedAt && (
        <p className="text-xs text-slate-400">Last checked {new Date(account.lastCheckedAt).toLocaleString()}.</p>
      )}
    </div>
  );
}
