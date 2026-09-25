"use client";

import { Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PlatformMark from "@/features/social/components/PlatformMark";
import SocialAvailabilityRow from "@/features/social/components/SocialAvailabilityRow";
import SocialConnectionRow from "@/features/social/components/SocialConnectionRow";
import { buildPlatformSections, type PlatformSection } from "@/features/social/components/social-account-manager.logic";
import {
  addSocialAccountAction,
  removeSocialAccountAction,
  setSocialAccountStatusAction,
  updateSocialAccountAction,
} from "@/features/social/actions/social-account.actions";
import {
  checkSocialConnectionAction,
  disconnectSocialAccountAction,
  startSocialConnectionAction,
} from "@/features/social/actions/social-connection.actions";
import type { SocialAccountSummary } from "@/features/social/schemas/social-account.schema";
import type { PlatformConnectivity } from "@/features/social/schemas/social-connection.schema";
import { describePlatformCapability } from "@/features/social/services/social-connection-status";
import { platformDefinition } from "@/features/social/services/social-platforms";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 7 — Settings → Clients → [client] → Social accounts.
 * Phase 9 — and where a real connection is made.
 * Phase 9C — restructured so CONNECTING is the page's primary workflow and
 * hand-typing an identity is a clearly secondary, clearly labelled path.
 *
 * WHAT CHANGED, AND WHAT DID NOT. This phase touches presentation only:
 * every action call below (add/update/remove/setStatus/connect/disconnect/
 * check) is the exact same Phase 7/9/9B server action, unchanged. The
 * connection lifecycle, the OAuth flow, the credential handling and the
 * authorization checks all still live entirely server-side, exactly where
 * Phase 9B put them. Nothing here duplicates or re-implements any of that.
 *
 * THE STRUCTURE. One section per platform this schema knows about
 * (ALL_PLATFORMS, via buildPlatformSections) — not one section per account —
 * so a platform Cloud Compass has never touched for this client is still
 * visible and still explained, instead of silently not existing until
 * someone finds the manual form. Each platform with an account shows that
 * account's Connection state and Cloud Compass availability as two
 * separately labelled rows (SocialConnectionRow / SocialAvailabilityRow);
 * each platform WITHOUT one offers Connect where that is genuinely possible,
 * or an honest sentence where it is not.
 *
 * THE MANUAL FORM STILL EXISTS, on purpose: it is the only way to configure
 * a platform this system has no OAuth provider for yet (everything except
 * Facebook, today), and the only way to preview an account's identity before
 * authorizing it. It is collapsed behind an explicit toggle and never named
 * "Connect" — see its own heading below.
 */
export default function SocialAccountManager({
  clientId,
  clientName,
  initialAccounts,
  connectivity,
}: {
  clientId: string;
  clientName: string;
  initialAccounts: SocialAccountSummary[];
  /** Per-platform: can it be connected at all, and is this deployment configured for it. */
  connectivity: PlatformConnectivity[];
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHandle, setEditHandle] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [isPending, startTransition] = useTransition();

  // The manual-identity form: closed by default so it never competes with
  // the Connect workflow above it. Opening it may preset a platform, so the
  // secondary link on a platform's own "not connected" card lands the person
  // on the right tab rather than the first one alphabetically.
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualPlatform, setManualPlatform] = useState<SocialPlatform>("FACEBOOK");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");

  const manualDefinition = platformDefinition(manualPlatform);
  const sections = buildPlatformSections(accounts, connectivity);

  /**
   * Starts an authorization for an EXISTING account (a reconnect). The
   * server decides where to send the person and returns a URL — this
   * component never builds a provider URL itself, and never sees an app id
   * or secret.
   *
   * A full navigation, not a fetch: the person is going to Facebook's own
   * consent screen and must see it in their address bar.
   */
  function connectExisting(account: SocialAccountSummary) {
    setError(null);
    startTransition(async () => {
      const result = await startSocialConnectionAction({
        clientId,
        platform: account.platform,
        accountId: account.id,
      });
      if (!result.success) {
        setError(result.message);
        return;
      }
      window.location.assign(result.data.authorizationUrl);
    });
  }

  /** Starts a connection with no existing account — the flow attaches whichever page is chosen. */
  function connectPlatform(target: SocialPlatform) {
    setError(null);
    startTransition(async () => {
      const result = await startSocialConnectionAction({ clientId, platform: target });
      if (!result.success) {
        setError(result.message);
        return;
      }
      window.location.assign(result.data.authorizationUrl);
    });
  }

  function disconnect(account: SocialAccountSummary) {
    setError(null);
    startTransition(async () => {
      const result = await disconnectSocialAccountAction({ accountId: account.id });
      if (!result.success) {
        setError(result.message);
        return;
      }
      setAccounts((prev) =>
        prev.map((row) =>
          row.id === account.id
            ? { ...row, connectionState: "DISCONNECTED", connectedAt: null, hasStoredCredential: false, lastCheckError: null }
            : row
        )
      );
      toast.success("Disconnected — the account details are kept");
    });
  }

  function check(account: SocialAccountSummary) {
    setError(null);
    startTransition(async () => {
      const result = await checkSocialConnectionAction(account.id);
      if (!result.success) {
        setError(result.message);
        return;
      }
      const state = result.data.connectionState;
      setAccounts((prev) =>
        prev.map((row) =>
          row.id === account.id ? { ...row, connectionState: state, lastCheckedAt: new Date().toISOString() } : row
        )
      );
      toast.success(
        state === "CONNECTED" ? "Still connected" : "The platform no longer accepts this authorization — reconnect it"
      );
    });
  }

  function openManualForm(presetPlatform?: SocialPlatform) {
    setError(null);
    if (presetPlatform) setManualPlatform(presetPlatform);
    setShowManualForm(true);
  }

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await addSocialAccountAction({ clientId, platform: manualPlatform, handle, displayName });
      if (!result.success) {
        setError(result.message);
        return;
      }
      const added = result.data;
      setAccounts((prev) => [...prev.filter((account) => account.id !== added.id), added]);
      setHandle("");
      setDisplayName("");
      setShowManualForm(false);
      toast.success(`${platformDefinition(added.platform).name} account identity added`);
    });
  }

  function beginEdit(account: SocialAccountSummary) {
    setError(null);
    setEditingId(account.id);
    setEditHandle(account.handle);
    setEditDisplayName(account.displayName ?? "");
  }

  function saveEdit(accountId: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateSocialAccountAction({ accountId, handle: editHandle, displayName: editDisplayName });
      if (!result.success) {
        setError(result.message);
        return;
      }
      const saved = result.data;
      setAccounts((prev) => prev.map((account) => (account.id === saved.id ? saved : account)));
      setEditingId(null);
      toast.success("Account identity updated");
    });
  }

  function toggleStatus(account: SocialAccountSummary) {
    setError(null);
    const next = account.status === "ACTIVE" ? "DISCONNECTED" : "ACTIVE";
    startTransition(async () => {
      const result = await setSocialAccountStatusAction({ accountId: account.id, status: next });
      if (!result.success) {
        setError(result.message);
        return;
      }
      const saved = result.data;
      setAccounts((prev) => prev.map((row) => (row.id === saved.id ? saved : row)));
      toast.success(next === "ACTIVE" ? "Account enabled" : "Account disabled — existing posts are unchanged");
    });
  }

  function remove(account: SocialAccountSummary) {
    setError(null);
    startTransition(async () => {
      const result = await removeSocialAccountAction(account.id);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setAccounts((prev) => prev.filter((row) => row.id !== account.id));
      toast.success("Account removed");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>
          Connect {clientName}&rsquo;s social accounts to Cloud Compass so approved content can eventually be published
          through the platform.
        </p>
        <p className="text-xs text-slate-500">
          Cloud Compass never asks for a social password, and nothing is published from here — connecting only lets Cloud
          Compass write posts for the right audience and show the right preview.
        </p>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-slate-700">Social accounts</h2>

        <ul className="flex flex-col gap-3">
          {sections.map((section) =>
            section.accounts.length > 0 ? (
              section.accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  connectivity={section.connectivity}
                  isEditing={editingId === account.id}
                  isPending={isPending}
                  editHandle={editHandle}
                  editDisplayName={editDisplayName}
                  onEditHandleChange={setEditHandle}
                  onEditDisplayNameChange={setEditDisplayName}
                  onBeginEdit={() => beginEdit(account)}
                  onSaveEdit={() => saveEdit(account.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onRemove={() => remove(account)}
                  onToggleStatus={() => toggleStatus(account)}
                  onConnect={() => connectExisting(account)}
                  onDisconnect={() => disconnect(account)}
                  onCheck={() => check(account)}
                />
              ))
            ) : (
              <NoAccountCard
                key={section.platform}
                section={section}
                isPending={isPending}
                onConnect={() => connectPlatform(section.platform)}
                onAddIdentity={() => openManualForm(section.platform)}
              />
            )
          )}
        </ul>
      </section>

      {/*
        De-emphasised on purpose — see the file comment. Never labelled
        "Connect": nothing here talks to a platform, and the disclaimer says
        so before the form itself does.
      */}
      <section className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-200 p-4">
        <button
          type="button"
          onClick={() => setShowManualForm((prev) => !prev)}
          aria-expanded={showManualForm}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          {showManualForm ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          Add an account for preview
        </button>

        {showManualForm && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              This records the account identity in Cloud Compass — a name and a handle so a post can be previewed with the
              right identity. It does <span className="font-medium text-slate-700">not</span> connect the external
              platform; use Connect on a platform above for that.
            </p>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Platform</span>
              <div className="flex flex-wrap gap-2">
                {sections.map(({ platform }) => {
                  const optionDefinition = platformDefinition(platform);
                  const selected = platform === manualPlatform;
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => setManualPlatform(platform)}
                      aria-pressed={selected}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                        selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <PlatformMark platform={platform} size="sm" decorative />
                      {optionDefinition.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="social-handle" className="text-sm font-medium">
                  Handle
                </label>
                <Input
                  id="social-handle"
                  value={handle}
                  placeholder={manualDefinition.handlePlaceholder}
                  onChange={(event) => setHandle(event.target.value)}
                />
                <p className="text-xs text-slate-500">The public handle, exactly as it reads on {manualDefinition.name}.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="social-display-name" className="text-sm font-medium">
                  {manualDefinition.accountNoun} name <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <Input
                  id="social-display-name"
                  value={displayName}
                  placeholder={clientName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
                <p className="text-xs text-slate-500">Shown in the composer and preview when it differs from the handle.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" onClick={add} disabled={isPending || handle.trim().length === 0}>
                <Plus size={15} /> Add account identity
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowManualForm(false)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** One existing account: identity, Connection, Cloud Compass availability, and secondary identity actions. */
function AccountCard({
  account,
  connectivity,
  isEditing,
  isPending,
  editHandle,
  editDisplayName,
  onEditHandleChange,
  onEditDisplayNameChange,
  onBeginEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
  onToggleStatus,
  onConnect,
  onDisconnect,
  onCheck,
}: {
  account: SocialAccountSummary;
  connectivity: PlatformConnectivity | undefined;
  isEditing: boolean;
  isPending: boolean;
  editHandle: string;
  editDisplayName: string;
  onEditHandleChange: (value: string) => void;
  onEditDisplayNameChange: (value: string) => void;
  onBeginEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRemove: () => void;
  onToggleStatus: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onCheck: () => void;
}) {
  const accountDefinition = platformDefinition(account.platform);

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <PlatformMark platform={account.platform} decorative />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-slate-700">{account.displayName ?? account.handle}</span>
          <span className="truncate text-xs text-slate-500">
            {accountDefinition.name}
            {account.displayName ? ` · ${account.handle}` : ""}
            {account.targetCount > 0 ? ` · targeted by ${account.targetCount} post${account.targetCount === 1 ? "" : "s"}` : ""}
          </span>
        </span>

        {/* Secondary, small — identity editing is not the primary action on this card. */}
        {!isEditing && (
          <span className="flex items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={onBeginEdit} disabled={isPending}>
              <Pencil size={13} /> Edit identity
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={isPending}
              aria-label={`Remove ${account.handle}`}
            >
              <Trash2 size={13} />
            </Button>
          </span>
        )}
      </div>

      <SocialConnectionRow
        account={account}
        connectivity={connectivity}
        isPending={isPending}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onCheck={onCheck}
      />

      <SocialAvailabilityRow account={account} isPending={isPending} onToggle={onToggleStatus} />

      {isEditing && (
        <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`handle-${account.id}`} className="text-xs font-medium text-slate-600">
              Handle
            </label>
            <Input id={`handle-${account.id}`} value={editHandle} onChange={(event) => onEditHandleChange(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`name-${account.id}`} className="text-xs font-medium text-slate-600">
              {accountDefinition.accountNoun} name
            </label>
            <Input
              id={`name-${account.id}`}
              value={editDisplayName}
              onChange={(event) => onEditDisplayNameChange(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="button" size="sm" onClick={onSaveEdit} disabled={isPending}>
              <Check size={14} /> Save
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancelEdit} disabled={isPending}>
              <X size={14} /> Cancel
            </Button>
            <span className="text-xs text-slate-500">
              The platform cannot be changed — add a separate account instead, so existing posts keep pointing where they were
              sent.
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * A platform this client has no account on yet.
 *
 * Every platform ALL_PLATFORMS knows about gets one of these, whether or not
 * it can be connected today — the point is that a person can SEE Instagram
 * exists as a platform without first discovering the manual form.
 *
 * Phase 9E — the status label itself now distinguishes NOT_IMPLEMENTED from
 * everything else: "Not available yet" for a platform with no OAuth provider
 * at all (no environment variable would ever fix that), and "Not connected"
 * for one that could genuinely be connected — whether or not it is
 * configured yet — because a real connection simply has not happened. Both
 * the wording and the READY/NOT_CONFIGURED/NOT_IMPLEMENTED split come from
 * the single describePlatformCapability function, so this card can never
 * disagree with SocialConnectionRow's own action slot for an existing
 * account on the same platform.
 */
function NoAccountCard({
  section,
  isPending,
  onConnect,
  onAddIdentity,
}: {
  section: PlatformSection;
  isPending: boolean;
  onConnect: () => void;
  onAddIdentity: () => void;
}) {
  const definition = platformDefinition(section.platform);
  const capability = describePlatformCapability(section.connectivity);
  const statusLabel = capability.state === "NOT_IMPLEMENTED" ? "Not available yet" : "Not connected";

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <PlatformMark platform={section.platform} decorative />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-slate-700">{definition.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="size-2 shrink-0 rounded-full bg-slate-300" aria-hidden />
            {statusLabel} — no {definition.accountNoun.toLowerCase()} configured for this client yet
          </span>
        </span>

        {capability.state === "READY" && (
          <Button type="button" size="sm" onClick={onConnect} disabled={isPending}>
            <Plus size={14} /> Connect {definition.name}
          </Button>
        )}

        {/* An honest stand-in, never a functioning-looking control — nothing here can be "activated". */}
        {capability.state !== "READY" && (
          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-400">
            {capability.state === "NOT_IMPLEMENTED" ? "Not available" : "Configuration required"}
          </span>
        )}
      </div>

      {capability.state !== "READY" && (
        <p className="text-xs text-slate-500">
          {capability.detail}
          {capability.missingKeys.length > 0 && (
            <span className="text-slate-400"> Set {capability.missingKeys.join(" and ")} to enable it.</span>
          )}
        </p>
      )}

      <button type="button" onClick={onAddIdentity} className="w-fit text-xs text-slate-500 underline hover:text-slate-700">
        Add an account identity for preview instead
      </button>
    </li>
  );
}
