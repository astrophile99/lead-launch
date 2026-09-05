/**
 * Structured job logging. Every long-running external operation (AI call,
 * discovery run, audit, build, deployment) emits start/finish lines with a
 * correlation id and duration. Secrets are never passed in - callers hand over
 * identifiers, not credentials.
 */

type Level = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

// Matches credential-shaped field names only. Deliberately not a bare /token/,
// which would redact harmless usage counters such as tokensIn / tokensOut.
const SENSITIVE =
  /^(apikey|api_key|api-key|key|secret|password|passwd|authorization|auth|bearer|access_token|accesstoken|refresh_token|credential|token)$/i;

function scrub(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  }
  return out;
}

function emit(level: Level, op: string, fields: LogFields) {
  const line = {
    ts: new Date().toISOString(),
    level,
    op,
    ...scrub(fields),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export type JobLogger = {
  id: string;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  /** Records the failure and returns the elapsed milliseconds. */
  fail: (error: unknown, fields?: LogFields) => number;
  /** Records success and returns the elapsed milliseconds. */
  done: (fields?: LogFields) => number;
};

let counter = 0;

export function startJob(op: string, fields: LogFields = {}): JobLogger {
  const id = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  const started = Date.now();
  emit("info", `${op}.start`, { jobId: id, ...fields });
  return {
    id,
    info: (msg, f = {}) => emit("info", `${op}.${msg}`, { jobId: id, ...f }),
    warn: (msg, f = {}) => emit("warn", `${op}.${msg}`, { jobId: id, ...f }),
    fail: (error, f = {}) => {
      const durationMs = Date.now() - started;
      emit("error", `${op}.fail`, {
        jobId: id,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
        ...f,
      });
      return durationMs;
    },
    done: (f = {}) => {
      const durationMs = Date.now() - started;
      emit("info", `${op}.done`, { jobId: id, durationMs, ...f });
      return durationMs;
    },
  };
}
