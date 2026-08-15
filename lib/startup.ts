import { describeProviderConfiguration, type ProviderConfigurationStatus } from "@/lib/ai/providers/registry";
import { isKnownModel } from "@/lib/ai/providers/pricing";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const REQUIRED_ENV_VARS = ["DATABASE_URL", "DIRECT_DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL"];
const OLLAMA_CHECK_TIMEOUT_MS = 2000;

function checkRequiredEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
}

/** Phase 20 — today this only ever happens per-request inside describeProviderConfiguration (registry.ts), silently producing a permanently-skipped phantom entry. Surfacing it as its own startup warning class catches an LLM_PROVIDER_ORDER typo at boot instead of only when someone notices a provider never gets tried. */
function checkUnrecognizedProviderNames(providers: ProviderConfigurationStatus[]): string[] {
  return providers.filter((p) => p.reason.includes("not a recognized provider name")).map((p) => p.name);
}

/**
 * Phase 20 — a warning, never a block: an unrecognized model still works at
 * runtime (pricing.ts's own estimateFromTable/getContextWindow already
 * degrade gracefully to a fallback rate/window), this just surfaces it at
 * boot instead of only the first time a cost/context estimate silently uses
 * a fallback. Only checked for providers with a real per-model table
 * (Gemini/OpenAI/Anthropic) — Ollama/OpenRouter have no fixed model catalog
 * to check a configured value against.
 */
const MODEL_ENV_VAR_BY_PROVIDER: Record<string, string> = {
  gemini: "GEMINI_MODEL",
  openai: "OPENAI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
};

function checkUnrecognizedModels(providers: ProviderConfigurationStatus[]): string[] {
  const warnings: string[] = [];
  for (const p of providers) {
    if (!p.configured) continue;
    const envVar = MODEL_ENV_VAR_BY_PROVIDER[p.name];
    if (!envVar) continue;
    const model = process.env[envVar];
    if (!isKnownModel(p.name, model)) {
      warnings.push(`${envVar}="${model}" is not a recognized ${p.name} model — cost/context-window estimates will use a fallback default.`);
    }
  }
  return warnings;
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

/**
 * Phase 18 — same reasoning as reapStaleRunningJobs above, extended
 * slightly: any AiGenerationJob still RUNNING at boot is definitely
 * orphaned (nothing from a previous process lifetime could legitimately
 * still be running). PENDING rows are ALSO swept, but only once they're
 * older than PENDING_GRACE_MS — PENDING should only ever be a millisecond-
 * scale transient state (the fire-and-forget kickoff starts immediately
 * after the row is created), so a PENDING row that's survived this long
 * means the process crashed in the narrow window between "job row created"
 * and "runner actually started," before it ever reached RUNNING. Without
 * this, that row would sit PENDING forever — nothing else ever reaps it.
 */
const PENDING_GRACE_MS = 5 * 60 * 1000;

async function reapStaleAiGenerationJobs(): Promise<number> {
  const result = await prisma.aiGenerationJob.updateMany({
    where: {
      OR: [{ status: "RUNNING" }, { status: "PENDING", createdAt: { lt: new Date(Date.now() - PENDING_GRACE_MS) } }],
    },
    data: {
      status: "FAILED",
      errorMessage: "The server restarted while this generation was running.",
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

  const unrecognizedProviderNames = checkUnrecognizedProviderNames(providers);
  if (unrecognizedProviderNames.length > 0) {
    logger.warn("Startup: LLM_PROVIDER_ORDER contains unrecognized provider name(s)", { names: unrecognizedProviderNames });
  }

  const unrecognizedModelWarnings = checkUnrecognizedModels(providers);
  for (const warning of unrecognizedModelWarnings) {
    logger.warn("Startup: configured model not in the known-models table", { warning });
  }

  const ollama = await checkOllamaReachability();
  if (ollama.checked) {
    logger.info("Startup: Ollama reachability check", { reachable: ollama.reachable, host: process.env.OLLAMA_HOST });
  }

  const reapedCount = await reapStaleRunningJobs();
  if (reapedCount > 0) {
    logger.warn("Startup: reaped stale RUNNING website analysis jobs", { count: reapedCount });
  }

  const reapedAiGenerationJobCount = await reapStaleAiGenerationJobs();
  if (reapedAiGenerationJobCount > 0) {
    logger.warn("Startup: reaped stale AI generation jobs", { count: reapedAiGenerationJobCount });
  }

  const warnings: string[] = [];
  if (missingEnvVars.length > 0) warnings.push(`Missing env vars: ${missingEnvVars.join(", ")}`);
  if (enabled.length === 0) warnings.push("No AI providers are configured — Website Analysis will fail immediately.");
  if (ollama.checked && !ollama.reachable) warnings.push(`OLLAMA_HOST is set (${process.env.OLLAMA_HOST}) but not reachable.`);
  if (unrecognizedProviderNames.length > 0) warnings.push(`LLM_PROVIDER_ORDER contains unrecognized name(s): ${unrecognizedProviderNames.join(", ")}`);
  warnings.push(...unrecognizedModelWarnings);

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
