import type { AICapability } from "@/config/ai";
import { prisma } from "@/db/client";
import { AppError, toAppError } from "@/lib/errors";
import { extractJson, toJson } from "@/lib/json";
import { startJob } from "@/lib/logger";
import { resolveRoute } from "@/providers/ai/router";
import type { AIRequest } from "@/providers/ai/types";

/**
 * Every AI call is a persisted job.
 *
 * Nothing calls a provider directly: `runAIJob` records the request before the
 * call, the resolved provider/model, real token usage, duration and either the
 * output or the structured error. That row is what the AI Control Center and
 * the per-prospect activity feed read, so the UI never has to guess whether
 * something actually ran.
 */

export type RunJobOptions<T> = {
  workspaceId: string;
  type: string;
  capability: AICapability;
  entityType?: string;
  entityId?: string;
  /** Human-facing summary of the input, stored for the job detail view. */
  inputSummary: Record<string, unknown>;
  request: Omit<AIRequest, "capability">;
  /** Validates and shapes the raw model output. Throw to fail the job. */
  parse: (raw: string) => T;
  /** Attempts (including the first). */
  maxAttempts?: number;
};

export type JobOutcome<T> = {
  jobId: string;
  value: T;
  provider: string;
  model: string;
  isMock: boolean;
  degradedReason: string | null;
};

export async function runAIJob<T>(opts: RunJobOptions<T>): Promise<JobOutcome<T>> {
  const route = await resolveRoute(opts.workspaceId, opts.capability);
  const log = startJob(`ai.${opts.type}`, {
    capability: opts.capability,
    provider: route.provider.id,
    model: route.model,
    entityId: opts.entityId ?? null,
  });

  const job = await prisma.aIJob.create({
    data: {
      workspaceId: opts.workspaceId,
      type: opts.type,
      capability: opts.capability,
      status: "running",
      provider: route.provider.id,
      model: route.model,
      isMock: route.provider.isMock,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
      inputJson: toJson(opts.inputSummary),
      startedAt: new Date(),
      attempts: 0,
    },
  });

  const maxAttempts = opts.maxAttempts ?? 2;
  const candidates = [
    { provider: route.provider, model: route.model },
    ...(route.fallback ? [route.fallback] : []),
  ];

  let lastError: AppError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = candidates[Math.min(attempt, candidates.length - 1)];
    try {
      const res = await candidate.provider.complete(candidate.model, {
        ...opts.request,
        capability: opts.capability,
      });

      const value = opts.parse(res.text);

      await prisma.aIJob.update({
        where: { id: job.id },
        data: {
          status: "complete",
          provider: res.provider,
          model: res.model,
          isMock: res.isMock,
          attempts: attempt + 1,
          outputJson: toJson(value),
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          costUsd: res.costUsd,
          durationMs: res.durationMs,
          completedAt: new Date(),
        },
      });

      log.done({ attempts: attempt + 1, tokensOut: res.tokensOut ?? 0 });

      return {
        jobId: job.id,
        value,
        provider: res.provider,
        model: res.model,
        isMock: res.isMock,
        degradedReason: route.degradedReason,
      };
    } catch (e) {
      lastError = toAppError(e);
      log.warn("attempt-failed", { attempt: attempt + 1, error: lastError.message });
      if (!lastError.retryable && attempt + 1 >= candidates.length) break;
    }
  }

  const durationMs = log.fail(lastError ?? new Error("unknown"));
  await prisma.aIJob.update({
    where: { id: job.id },
    data: {
      status: "failed",
      attempts: maxAttempts,
      error: toJson(lastError?.toJSON() ?? { message: "unknown failure" }),
      durationMs,
      completedAt: new Date(),
    },
  });

  throw (
    lastError ??
    new AppError({
      kind: "internal",
      message: "The AI job failed without an error.",
      remedy: "Retry the job.",
      retryable: true,
    })
  );
}

/** Standard JSON parser for job outputs, with a useful failure message. */
export function jsonParser<T>(validate: (v: unknown) => T): (raw: string) => T {
  return (raw: string) => {
    const parsed = extractJson<unknown>(raw);
    if (parsed == null) {
      throw new AppError({
        kind: "provider-error",
        message: "The model did not return parseable JSON.",
        remedy: "Retry the job. If it repeats, switch this capability to a different model.",
        retryable: true,
        detail: raw.slice(0, 300),
      });
    }
    return validate(parsed);
  };
}

/** Wraps the grounding facts the mock composer reads and real models benefit from. */
export function factsBlock(facts: Record<string, unknown>): string {
  return `<facts>\n${JSON.stringify(facts, null, 2)}\n</facts>`;
}
