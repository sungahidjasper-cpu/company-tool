"use client";

import { Check, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PlatformMark from "@/features/social/components/PlatformMark";
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
import SocialConnectionRow from "@/features/social/components/SocialConnectionRow";
import type { SocialAccountSummary } from "@/features/social/schemas/social-account.schema";
import type { PlatformConnectivity } from "@/features/social/schemas/social-connection.schema";
import { ALL_PLATFORMS, platformDefinition } from "@/features/social/services/social-platforms";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 7 — Settings → Clients → [client] → Social accounts.
 * Phase 9 — and where a real connection is made.
 *
 * The ONLY place a client's social accounts are created, renamed, disabled,
 * removed, connected or disconnected. The composer reads this list and never
 * writes to it, so choosing who to post as and deciding who the client is on
 * a platform stay separate.
 *
 * TWO DIFFERENT FACTS, SHOWN SEPARATELY. Every row now states both:
 *
 *   Enabled / Disabled   the user's own switch — do we offer this account
 *                        when writing a post?
 *   Connection state     whether Cloud Compass has actually authorized with
 *                        the platform
 *
 * Before Phase 9 a single badge covered both, so typing a handle produced
 * something that looked ready to publish. Adding an account still adds
 * identity only — it now says "Not connected", because that is the truth.
 *
 * NO CREDENTIAL FIELD, STILL. There is no password box and no token box.
 * Connecting hands the person to the platform's own authorization screen and
 * the credential never passes through this component.
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
  const [platform, setPlatform] = useState<SocialPlatform>(ALL_PLATFORMS[0]);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHandle, setEditHandle] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [isPending, startTransition] = useTransition();

  const definition = platformDefinition(platform);
  const connectivityByPlatform = new Map(connectivity.map((row) => [row.platform, row]));

  /**
   * Starts an authorization. The server decides where to send the person and
   * returns a URL — this component never builds a provider URL itself, and
   * never sees an app id or secret.
   *
   * A full navigation, not a fetch: the person is going to Facebook's own
   * consent screen and must see it in their address bar.
   */
  function connect(account: SocialAccountSummary) {
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

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await addSocialAccountAction({ clientId, platform, handle, displayName });
      if (!result.success) {
        setError(result.message);
        return;
      }
      const added = result.data;
      setAccounts((prev) => [...prev.filter((account) => account.id !== added.id), added].sort(compareAccounts));
      setHandle("");
      setDisplayName("");
      toast.success(`${platformDefinition(added.platform).name} account added`);
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
      setAccounts((prev) => prev.map((account) => (account.id === saved.id ? saved : account)).sort(compareAccounts));
      setEditingId(null);
      toast.success("Account updated");
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

  /*
   * A platform is offered here only when it is genuinely connectable, is
   * configured on this server, and this client has no account for it yet —
   * an existing account carries its own Connect action in its row.
   */
  const platformsWithAccounts = new Set(accounts.map((account) => account.platform));
  const connectableWithoutAccount = connectivity.filter(
    (row) => row.connectable && row.configured && !platformsWithAccounts.has(row.platform)
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        These accounts tell Cloud Compass who {clientName} is on each platform, so a post can be written for the right audience and
        previewed with the right identity. Adding an account records who they are;{" "}
        <span className="font-medium text-slate-700">connecting is a separate step that goes through the platform&rsquo;s own
        authorization</span>. Cloud Compass never asks for a social password, and{" "}
        <span className="font-medium text-slate-700">nothing is published from here</span>.
      </p>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">Add an account</h2>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Platform</span>
          <div className="flex flex-wrap gap-2">
            {ALL_PLATFORMS.map((option) => {
              const optionDefinition = platformDefinition(option);
              const selected = option === platform;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPlatform(option)}
                  aria-pressed={selected}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                    selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <PlatformMark platform={option} size="sm" decorative />
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
              placeholder={definition.handlePlaceholder}
              onChange={(event) => setHandle(event.target.value)}
            />
            <p className="text-xs text-slate-500">The public handle, exactly as it reads on {definition.name}.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="social-display-name" className="text-sm font-medium">
              {definition.accountNoun} name <span className="font-normal text-slate-400">(optional)</span>
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

        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div>
          <Button type="button" onClick={add} disabled={isPending || handle.trim().length === 0}>
            <Plus size={15} /> Add {definition.name} {definition.accountNoun.toLowerCase()}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-slate-700">
          Configured accounts {accounts.length > 0 && <span className="font-normal text-slate-400">({accounts.length})</span>}
        </h2>

        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            {clientName} has no social accounts configured yet. Add one above and it becomes selectable in the Social Composer.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((account) => {
              const accountDefinition = platformDefinition(account.platform);
              const isEditing = editingId === account.id;
              return (
                <li key={account.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <PlatformMark platform={account.platform} decorative />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-slate-700">{account.displayName ?? account.handle}</span>
                      <span className="truncate text-xs text-slate-500">
                        {accountDefinition.name}
                        {account.displayName ? ` · ${account.handle}` : ""}
                        {account.targetCount > 0
                          ? ` · targeted by ${account.targetCount} post${account.targetCount === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </span>
                    {/*
                      The user's own switch, and labelled as nothing more.
                      "Enabled" used to be the only badge on this row, which is
                      how it came to be read as "working" — the connection is
                      stated separately, below.
                    */}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        account.status === "ACTIVE" ? "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-400"
                      }`}
                      title={
                        account.status === "ACTIVE"
                          ? "Available to choose when writing a post"
                          : "Not offered for new posts"
                      }
                    >
                      {account.status === "ACTIVE" ? "Enabled" : "Disabled"}
                    </span>

                    {!isEditing && (
                      <span className="flex items-center gap-1.5">
                        <Button type="button" variant="outline" size="sm" onClick={() => beginEdit(account)} disabled={isPending}>
                          <Pencil size={14} /> Edit
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => toggleStatus(account)} disabled={isPending}>
                          <Power size={14} /> {account.status === "ACTIVE" ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => remove(account)}
                          disabled={isPending}
                          aria-label={`Remove ${account.handle}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </span>
                    )}
                  </div>

                  <SocialConnectionRow
                    account={account}
                    connectivity={connectivityByPlatform.get(account.platform)}
                    isPending={isPending}
                    onConnect={() => connect(account)}
                    onDisconnect={() => disconnect(account)}
                    onCheck={() => check(account)}
                  />

                  {isEditing && (
                    <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`handle-${account.id}`} className="text-xs font-medium text-slate-600">
                          Handle
                        </label>
                        <Input id={`handle-${account.id}`} value={editHandle} onChange={(event) => setEditHandle(event.target.value)} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`name-${account.id}`} className="text-xs font-medium text-slate-600">
                          {accountDefinition.accountNoun} name
                        </label>
                        <Input
                          id={`name-${account.id}`}
                          value={editDisplayName}
                          onChange={(event) => setEditDisplayName(event.target.value)}
                        />
                      </div>
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <Button type="button" size="sm" onClick={() => saveEdit(account.id)} disabled={isPending}>
                          <Check size={14} /> Save
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)} disabled={isPending}>
                          <X size={14} /> Cancel
                        </Button>
                        <span className="text-xs text-slate-500">
                          The platform cannot be changed — add a separate account instead, so existing posts keep pointing where they
                          were sent.
                        </span>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        Connecting a platform this client has no account for at all. Only
        platforms that can genuinely be connected AND are configured here
        appear — an unconfigured platform is described in the accounts above
        rather than offered as a button that leads nowhere.
      */}
      {connectableWithoutAccount.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-slate-700">Connect a platform</h2>
          <p className="text-xs text-slate-500">
            Authorize through the platform and choose which {clientName} page to use. The account is created from what the
            platform reports, so its identity is the real one.
          </p>
          <div className="flex flex-wrap gap-2">
            {connectableWithoutAccount.map((row) => (
              <Button
                key={row.platform}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => connectPlatform(row.platform)}
                disabled={isPending}
              >
                <PlatformMark platform={row.platform} size="sm" decorative />
                Connect {platformDefinition(row.platform).name}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function compareAccounts(a: SocialAccountSummary, b: SocialAccountSummary): number {
  return a.platform === b.platform ? a.handle.localeCompare(b.handle) : a.platform.localeCompare(b.platform);
}
