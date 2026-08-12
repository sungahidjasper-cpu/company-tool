import { describeProviderConfiguration } from "@/lib/ai/providers/registry";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const REQUIRED_ENV_VARS = ["DATABASE_URL", "DIRECT_DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL"];
const OLLAMA_CHECK_TIMEOUT_MS = 2000;

function checkRequiredEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
}

async function checkOllamaReachability(): Promise<{ checked: boolean; reachable: boolean }> {
  const host = process.env.OLLAMA_HOST;
  if (!host) return { checked: false, reachable: false };

  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(OLLAMA_CHECK_TIMEOUT_MS) });
    return { checked: true, reachable: response.ok };
  } catch {
    return { checked: true, reachable: false };
  }
}

/**
 * Any WebsiteAnalysisJob still RUNNING belongs to a previous process
 * lifetime — this one just started, so nothing it created could
 * legitimately be RUNNING yet. Without this, a job whose process died
 * mid-analysis stays RUNNING forever (nothing else ever reaps it — there's
 * no poller, jobs only ever advance via the request that created them).
 */
async function reapStaleRunningJobs(): Promise<number> {
  const result = await prisma.websiteAnalysisJob.updateMany({
    where: { status: "RUNNING" },
    data: {
      status: "FAILED",
      errorMessage: "The server restarted while this analysis was running.",
      errorType: "SERVICE_UNAVAILABLE",
    },
  });
  return result.count;
}

export async function runStartupChecks(): Promise<void> {
  const missingEnvVars = checkRequiredEnvVars();
  if (missingEnvVars.length > 0) {
    logger.error("Missing required environment variables", { missing: missingEnvVars });
  }

  const providers = await describeProviderConfiguration();
  const enabled = providers.filter((p) => p.configured && p.health === "HEALTHY").map((p) => p.name);
  const skipped = providers.filter((p) => !p.configured || p.health !== "HEALTHY");
  logger.info("Startup: AI provider configuration", {
    enabled,
    skipped: skipped.map((p) => ({ name: p.name, reason: p.reason })),
  });

  const ollama = await checkOllamaReachability();
  if (ollama.checked) {
    logger.info("Startup: Ollama reachability check", { reachable: ollama.reachable, host: process.env.OLLAMA_HOST });
  }

  const reapedCount = await reapStaleRunningJobs();
  if (reapedCount > 0) {
    logger.warn("Startup: reaped stale RUNNING website analysis jobs", { count: reapedCount });
  }

  const warnings: string[] = [];
  if (missingEnvVars.length > 0) warnings.push(`Missing env vars: ${missingEnvVars.join(", ")}`);
  if (enabled.length === 0) warnings.push("No AI providers are configured — Website Analysis will fail immediately.");
  if (ollama.checked && !ollama.reachable) warnings.push(`OLLAMA_HOST is set (${process.env.OLLAMA_HOST}) but not reachable.`);

  if (process.env.NODE_ENV === "development" && warnings.length > 0) {
    console.warn(
      [
        "",
        "⚠ Startup configuration warnings:",
        ...warnings.map((w) => `  - ${w}`),
        "",
      ].join("\n")
    );
  }
}
