"use client";

import { Link2, Link2Off, RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PlatformConnectivity } from "@/features/social/schemas/social-connection.schema";
import type { SocialAccountSummary } from "@/features/social/schemas/social-account.schema";
import { describeConnection } from "@/features/social/services/social-connection-status";
import { platformDefinition } from "@/features/social/services/social-platforms";

/**
 * Phase 9 — the connection half of one account row in client settings.
 *
 * THE RULE IT ENFORCES IN THE UI: the words "Connected" appear only when
 * connectionState is CONNECTED. Everything else says, plainly, that Cloud
 * Compass has not connected — and a hand-added account says why.
 *
 * NO DISABLED-LOOKING CONTROLS. When a platform has no provider yet, or this
 * deployment has no credentials for it, that is a sentence of text explaining
 * so — not a greyed-out Connect button the reader has to hover to understand.
 * Availability is derived from data and stated in words.
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
  const definition = platformDefinition(account.platform);

  const dotClass = connection.isConnected
    ? "bg-emerald-500"
    : connection.needsAttention
      ? "bg-amber-500"
      : "bg-slate-300";

  /*
   * Three reasons an action cannot be offered, each with its own sentence.
   * They are checked in this order because the most fundamental one is the
   * most useful to say: a platform with no provider will not become
   * connectable by setting an environment variable.
   */
  const unavailableReason = !connectivity
    ? `Connecting ${definition.name} is not available yet.`
    : !connectivity.connectable
      ? connectivity.summary
      : !connectivity.configured
        ? connectivity.summary
        : null;

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

        {connection.action !== null && unavailableReason === null && (
          <Button type="button" size="sm" onClick={onConnect} disabled={isPending}>
            <Link2 size={14} />
            {connection.action === "RECONNECT" ? `Reconnect ${definition.name}` : `Connect ${definition.name}`}
          </Button>
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
        Why the action is absent, as text. Only shown where an action would
        otherwise have appeared, so a CONNECTED account is not lectured about
        configuration it no longer needs.
      */}
      {connection.action !== null && unavailableReason !== null && (
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {unavailableReason}
            {connectivity && connectivity.missingKeys.length > 0 && (
              /* Names of unset environment variables, never their values, and only for someone who may manage configuration. */
              <span className="text-slate-400"> Set {connectivity.missingKeys.join(" and ")} to enable it.</span>
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
