"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { publishContentAction, retryPublishAction } from "@/features/publishing/actions/publishing-content.actions";
import type { ConnectionPublicationState } from "@/features/publishing/services/content-publication-state.service";

const selectClassName =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type PublishContentPanelProps = {
  contentId: string;
  /** Already filtered to ACTIVE connections by the server component — this panel never re-checks connection status. */
  connections: { id: string; label: string }[];
  /** One entry per ACTIVE connection, from getContentPublicationState — read-only, credential-free. */
  publicationState: ConnectionPublicationState[];
};

/**
 * Phase 24 Stage 2D — the only UI for triggering a WordPress publish.
 * Deliberately thin: all authorization, ownership, eligibility,
 * idempotency, and retry-safety logic lives server-side in
 * publishing-content.actions.ts — this component only renders whatever
 * state the server already computed and calls the two existing actions.
 * After any action call it uses router.refresh() to re-fetch that server
 * state rather than guessing/duplicating retryability logic on the client.
 *
 * This panel never reads or writes Content.status, Content.publishedAt, or
 * Content.body — "Published to WordPress" below is a fact about
 * ContentPublication, a separate record, never a claim about Compass's own
 * internal content lifecycle.
 */
export default function PublishContentPanel({ contentId, connections, publicationState }: PublishContentPanelProps) {
  const router = useRouter();
  const [selectedConnectionId, setSelectedConnectionId] = useState(connections[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  const selectedState = publicationState.find((state) => state.connectionId === selectedConnectionId) ?? null;

  function runAction(action: (input: { contentId: string; connectionId: string }) => ReturnType<typeof publishContentAction>) {
    startTransition(async () => {
      const result = await action({ contentId, connectionId: selectedConnectionId });
      if (result.success) {
        toast.success(result.data.alreadyPublished ? "Already published to WordPress." : "Published to WordPress.");
      } else {
        toast.error(result.message);
      }
      router.refresh();
    });
  }

  if (connections.length === 0) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-slate-500">No active WordPress connections.</p>
        <Link href="/settings/publishing" className="font-medium text-primary hover:underline">
          Connect a destination →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="publish-connection" className="text-sm font-medium">
          Destination
        </label>
        <select
          id="publish-connection"
          className={selectClassName}
          value={selectedConnectionId}
          onChange={(e) => setSelectedConnectionId(e.target.value)}
          disabled={isPending}
        >
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.label}
            </option>
          ))}
        </select>
      </div>

      {selectedState?.publication ? (
        <div className="flex flex-col gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-800">Published to WordPress</p>
          {selectedState.publication.externalUrl && (
            <a
              href={selectedState.publication.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 hover:underline"
            >
              {selectedState.publication.externalUrl}
            </a>
          )}
          <p className="text-xs text-emerald-600">{selectedState.publication.publishedAt.toLocaleString()}</p>
        </div>
      ) : selectedState?.jobStatus === "FAILED" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-destructive">
            {selectedState.errorType === "AMBIGUOUS_RESPONSE"
              ? "The outcome of the last publish attempt could not be confirmed, so it was not retried automatically."
              : "The last publish attempt failed."}
          </p>
          {selectedState.canRetry && (
            <Button type="button" variant="outline" onClick={() => runAction(retryPublishAction)} disabled={isPending}>
              {isPending ? "Retrying…" : "Retry"}
            </Button>
          )}
        </div>
      ) : selectedState?.jobStatus === "PENDING" || selectedState?.jobStatus === "RUNNING" ? (
        <p className="text-sm text-slate-500">A publish request is already in progress.</p>
      ) : (
        <Button type="button" onClick={() => runAction(publishContentAction)} disabled={isPending}>
          {isPending ? "Publishing…" : "Publish"}
        </Button>
      )}
    </div>
  );
}
