/**
 * Structured logger — single-line JSON to stdout/stderr so Vercel log drains
 * and `vercel logs` queries can filter on fields instead of grepping prose.
 *
 * Levels:
 * - debug/info/warn/error — standard severity.
 * - critical — alertable: something a human must act on (audit write failed,
 *   Stripe credit grant failed, missing webhook secret). Emits `"alert":true`
 *   so a log drain / monitor can match on it. Point alerting at:
 *   `{"level":"critical"` or `"alert":true`.
 *
 * Usage:
 *   log.error("stripe_webhook_verify_failed", { err, eventType });
 *   const alog = log.scope("audit");
 *   alog.critical("audit_write_failed", { err, action });
 */

type Level = "debug" | "info" | "warn" | "error" | "critical";

type LogContext = Record<string, unknown>;

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err) };
}

function emit(level: Level, scope: string | null, msg: string, context?: LogContext): void {
  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    ...(scope ? { scope } : {}),
    msg,
  };

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      entry[key] = value instanceof Error ? serializeError(value) : value;
    }
  }

  if (level === "critical") entry.alert = true;

  const line = JSON.stringify(entry);
  if (level === "error" || level === "critical") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  critical(msg: string, context?: LogContext): void;
  scope(name: string): Logger;
}

function makeLogger(scopeName: string | null): Logger {
  return {
    debug: (msg, ctx) => emit("debug", scopeName, msg, ctx),
    info: (msg, ctx) => emit("info", scopeName, msg, ctx),
    warn: (msg, ctx) => emit("warn", scopeName, msg, ctx),
    error: (msg, ctx) => emit("error", scopeName, msg, ctx),
    critical: (msg, ctx) => emit("critical", scopeName, msg, ctx),
    scope: (name) => makeLogger(scopeName ? `${scopeName}.${name}` : name),
  };
}

export const log = makeLogger(null);
