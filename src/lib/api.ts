import { NextResponse } from "next/server";
import { AppError, HTTP_STATUS_BY_KIND, toAppError } from "@/lib/errors";
import { startJob } from "@/lib/logger";

/**
 * One response shape for every route handler.
 *
 * Success and failure are distinguished by a boolean rather than by status
 * alone, so a client never has to guess. Internal detail - stack traces, SQL,
 * credentials - never crosses this boundary; the caller gets a stable code, a
 * sentence describing what happened, and a sentence describing what to do.
 */

export type ApiSuccess<T> = { success: true; data: T };

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    remedy: string;
    retryable: boolean;
    details?: unknown;
  };
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(error: unknown): NextResponse<ApiFailure> {
  // An AppError was constructed deliberately, so its message is safe to show.
  // Anything else is an unexpected throw whose message may carry internal
  // detail - a database host and port, a filesystem path - so it is logged
  // server-side and replaced with something the caller can act on instead.
  let err: AppError;
  if (error instanceof AppError) {
    err = error;
  } else {
    const raw = toAppError(error);
    startJob("api.unhandled").fail(error);
    err = new AppError({
      kind: raw.kind === "timeout" ? "timeout" : "internal",
      message:
        raw.kind === "timeout"
          ? "The operation took too long and was cancelled."
          : "Something went wrong handling this request.",
      remedy: "Retry. If it persists, check the server logs for the full error.",
      retryable: true,
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: err.kind,
        message: err.message,
        remedy: err.remedy,
        retryable: err.retryable,
        // `detail` is provider-supplied context we chose to surface, never a
        // stack trace and never anything read from the environment.
        ...(err.detail ? { details: err.detail } : {}),
      },
    },
    { status: HTTP_STATUS_BY_KIND[err.kind] },
  );
}

/** Wraps a handler so every thrown error becomes the standard failure shape. */
export function handler<T>(fn: () => Promise<NextResponse<ApiSuccess<T>>>) {
  return async () => {
    try {
      return await fn();
    } catch (e) {
      return fail(e);
    }
  };
}

/** Parses and clamps `page` / `pageSize` from a query string. */
export function paging(url: URL, defaultSize = 50, maxSize = 200) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const requested = Number.parseInt(url.searchParams.get("pageSize") ?? "", 10);
  const pageSize = Math.min(
    maxSize,
    Math.max(1, Number.isFinite(requested) ? requested : defaultSize),
  );
  return { page, pageSize };
}
