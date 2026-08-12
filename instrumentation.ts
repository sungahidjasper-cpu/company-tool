/**
 * Runs once when the server starts, before it handles any request (Next.js's
 * documented instrumentation hook). Only the Node.js runtime touches the
 * database/env — the Edge runtime can't use Prisma/pg, so the actual logic
 * lives in a separate module, imported dynamically per Next's own guidance
 * for runtime-specific code in instrumentation.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupChecks } = await import("@/lib/startup");
    await runStartupChecks();
  }
}
