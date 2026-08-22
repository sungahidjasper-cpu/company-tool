"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  connectDestinationAction,
  disconnectDestinationAction,
} from "@/features/publishing/actions/publishing-connection.actions";
import type { PublishingConnectionSummary } from "@/features/publishing/schemas/publishing-connection.schema";

type ConnectionManagerProps = {
  initialConnections: PublishingConnectionSummary[];
};

const EMPTY_FORM = { label: "", baseUrl: "", username: "", applicationPassword: "" };

/**
 * Phase 24 Stage 1 — connection management only. No destination-selection
 * or publish action lives here; this component never reads back a stored
 * credential (there is no "view/edit credential" flow — only create-new or
 * disconnect-and-recreate).
 */
export default function ConnectionManager({ initialConnections }: ConnectionManagerProps) {
  const [connections, setConnections] = useState(initialConnections);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  function handleConnect() {
    setError(null);
    startTransition(async () => {
      const result = await connectDestinationAction(form);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setConnections((prev) => [result.data, ...prev]);
      setForm(EMPTY_FORM);
      toast.success(`Connected to ${result.data.label}`);
    });
  }

  function handleDisconnect(connectionId: string) {
    setDisconnectingId(connectionId);
    startTransition(async () => {
      const result = await disconnectDestinationAction({ connectionId });
      setDisconnectingId(null);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setConnections((prev) => prev.map((c) => (c.id === connectionId ? { ...c, status: "REVOKED" as const } : c)));
      toast.success("Disconnected");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-700">Connect a WordPress site</h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pub-label" className="text-sm font-medium">
            Label
          </label>
          <Input
            id="pub-label"
            placeholder="e.g. Acme Blog"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pub-baseurl" className="text-sm font-medium">
            Site URL
          </label>
          <Input
            id="pub-baseurl"
            placeholder="https://example.com"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pub-username" className="text-sm font-medium">
            WordPress username
          </label>
          <Input
            id="pub-username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pub-app-password" className="text-sm font-medium">
            Application password
          </label>
          <Input
            id="pub-app-password"
            type="password"
            value={form.applicationPassword}
            onChange={(e) => setForm({ ...form, applicationPassword: e.target.value })}
          />
          <p className="text-xs text-slate-500">
            Generate this under your WordPress user profile → Application Passwords. Never your login password.
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="button" onClick={handleConnect} disabled={isPending}>
          {isPending && disconnectingId === null ? "Validating…" : "Connect"}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-slate-700">Connections</h2>
        {connections.length === 0 ? (
          <p className="text-sm text-slate-500">No destinations connected yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-slate-700">{connection.label}</span>
                  <span className="text-slate-500">
                    {connection.providerType} · {connection.baseUrl}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className={
                      connection.status === "ACTIVE"
                        ? "text-xs font-medium text-emerald-600"
                        : connection.status === "REVOKED"
                          ? "text-xs font-medium text-slate-400"
                          : "text-xs font-medium text-amber-600"
                    }
                  >
                    {connection.status}
                  </span>
                  {connection.status === "ACTIVE" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(connection.id)}
                      disabled={isPending}
                    >
                      {disconnectingId === connection.id ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
