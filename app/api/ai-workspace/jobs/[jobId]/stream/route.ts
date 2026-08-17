import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getAiGenerationJob } from "@/lib/jobs/ai-generation-job-table";

type RouteParams = { params: Promise<{ jobId: string }> };

/**
 * Phase 22 — how often this handler re-reads the job row while it's
 * RUNNING. Deliberately DB-polling, not an in-process pub/sub: the
 * AiGenerationJob row is the only source of truth, so this is correct
 * whether this request and the job's own runner happen to be handled by
 * the same server process or not, today or after any future deployment
 * change. See docs referenced in the Phase 22 plan for the full rationale.
 */
const POLL_INTERVAL_MS = 750;

function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * A live, best-effort preview of an in-progress generation — purely
 * additive to the existing 3-second Server Action poll
 * (getAiGenerationJobAction / pollGenerationJob), which remains the only
 * path that ever detects SUCCEEDED/FAILED and transitions the review UI.
 * This stream may be absent, disabled, or drop at any point without
 * affecting correctness — it only stops a live preview from updating.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (process.env.AI_STREAMING_ENABLED !== "true") {
    return NextResponse.json({ error: "Streaming is not enabled." }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const initialJob = await getAiGenerationJob(jobId);
  // Same "not found" framing for a cross-company job as getAiGenerationJobAction — not a stricter rule invented for this route.
  if (!initialJob || initialJob.companyId !== user.companyId) {
    return NextResponse.json({ error: "Generation job not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // undefined = "nothing sent yet" — distinct from null, a genuine reset. Prevents a spurious reset event on the very first tick.
      let lastSentText: string | null | undefined;
      let lastSentProgress: number | null | undefined;

      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        } catch {
          // Controller already closed (client disconnected mid-enqueue) — stop() below will have run or is about to.
        }
      }

      function stop() {
        if (closed) return;
        closed = true;
        if (intervalId) clearInterval(intervalId);
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting — nothing to do.
        }
      }

      async function tick() {
        if (closed) return;
        const current = await getAiGenerationJob(jobId);
        if (!current) {
          send("error", { message: "Generation job no longer exists." });
          stop();
          return;
        }

        if (current.partialResultText !== lastSentText) {
          const previousText = lastSentText;
          lastSentText = current.partialResultText;
          if (current.partialResultText === null) {
            if (previousText) send("reset", {});
          } else {
            send("text", { text: current.partialResultText });
          }
        }

        if (current.progress !== lastSentProgress) {
          lastSentProgress = current.progress;
          send("progress", { progress: current.progress });
        }

        if (current.status === "SUCCEEDED" || current.status === "FAILED") {
          send("done", { status: current.status });
          stop();
        }
      }

      intervalId = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
      void tick();

      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      closed = true;
      if (intervalId) clearInterval(intervalId);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
