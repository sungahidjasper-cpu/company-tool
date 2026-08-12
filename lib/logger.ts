/**
 * Minimal structured logging — this app has no logging framework anywhere
 * else (confirmed: zero console.* calls in lib/ or features/ before this),
 * so a full framework (pino/winston) would be a new dependency for a need
 * this thin wrapper already covers. Output is one JSON object per line,
 * consistent with what most hosting platforms' log aggregation expects.
 */
type LogContext = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", message: string, context?: LogContext) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    emit("error", message, context);
  },
};
