/**
 * Structured errors. Every external operation that can fail reports through
 * one of these so the UI can always answer: what happened, why, and what the
 * user can do about it.
 */

export type ErrorKind =
  | "not-configured"
  | "provider-error"
  | "timeout"
  | "rate-limited"
  | "unreachable"
  | "blocked"
  | "invalid-input"
  | "not-found"
  | "conflict"
  | "build-failed"
  | "internal";

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly remedy: string;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(opts: {
    kind: ErrorKind;
    message: string;
    remedy: string;
    retryable?: boolean;
    detail?: string;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "AppError";
    this.kind = opts.kind;
    this.remedy = opts.remedy;
    this.retryable = opts.retryable ?? false;
    this.detail = opts.detail;
  }

  toJSON() {
    return {
      kind: this.kind,
      message: this.message,
      remedy: this.remedy,
      retryable: this.retryable,
      detail: this.detail,
    };
  }
}

export function notConfigured(what: string, howToFix: string): AppError {
  return new AppError({
    kind: "not-configured",
    message: `${what} is not configured.`,
    remedy: howToFix,
    retryable: false,
  });
}

export function toAppError(e: unknown, fallbackRemedy = "Retry the operation."): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Error) {
    const timeout = /abort|timeout/i.test(e.message);
    return new AppError({
      kind: timeout ? "timeout" : "internal",
      message: e.message,
      remedy: timeout ? "The operation took too long. Retry, or raise the timeout." : fallbackRemedy,
      retryable: true,
      cause: e,
    });
  }
  return new AppError({
    kind: "internal",
    message: String(e),
    remedy: fallbackRemedy,
    retryable: true,
  });
}

export const HTTP_STATUS_BY_KIND: Record<ErrorKind, number> = {
  "not-configured": 501,
  "provider-error": 502,
  timeout: 504,
  "rate-limited": 429,
  unreachable: 502,
  blocked: 502,
  "invalid-input": 400,
  "not-found": 404,
  conflict: 409,
  "build-failed": 500,
  internal: 500,
};
