/**
 * Structured logging with an allowlist. Anything that looks like a credential,
 * a token or a mailbox never reaches a sink, so a recovery link cannot leak
 * through an error path even if a caller passes it by mistake.
 */
export type LogSink = (entry: Record<string, string | number | boolean>) => void;

const allowedKeys = new Set([
  "event",
  "level",
  "requestId",
  "route",
  "method",
  "status",
  "code",
  "result",
  "principalId",
  "orgId",
  "role",
  "template",
  "attempt",
  "durationMs",
  "count",
]);

const forbiddenValue = /(?:token|password|secret|bearer|smtp:\/\/|smtps:\/\/)/i;

export function createLogger(sink: LogSink = defaultSink) {
  const emit = (
    level: "info" | "warn" | "error",
    event: string,
    fields: Record<string, unknown> = {}
  ) => {
    const entry: Record<string, string | number | boolean> = {
      level,
      event,
    };
    for (const [key, value] of Object.entries(fields)) {
      if (!allowedKeys.has(key) || key === "level" || key === "event") continue;
      if (value === undefined || value === null) continue;
      if (typeof value === "number" || typeof value === "boolean") {
        entry[key] = value;
        continue;
      }
      if (typeof value !== "string") continue;
      if (value.length > 120 || forbiddenValue.test(value) || /[^\w.:@-]/.test(value))
        continue;
      entry[key] = value;
    }
    sink(entry);
  };
  return {
    info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
    error: (event: string, fields?: Record<string, unknown>) =>
      emit("error", event, fields),
  };
}

const defaultSink: LogSink = entry => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

export type Logger = ReturnType<typeof createLogger>;
