import { appConfig } from "@/config/app";
import { modelSpec, type AICapability } from "@/config/ai";
import { AppError, notConfigured, toAppError } from "@/lib/errors";
import type { AIProvider, AIRequest, AIResponse } from "./types";

/**
 * Anthropic Messages API adapter.
 *
 * Called over plain fetch rather than through an SDK so the provider layer has
 * no heavyweight dependency and every adapter has the same shape. Token counts
 * come from the API response, so usage reporting is real; cost is computed only
 * when a price has been configured for the model in src/config/ai.ts.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
  stop_reason?: string;
};

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic (Claude)";
  readonly isMock = false;

  isConfigured(): boolean {
    return Boolean(appConfig.ai.anthropic);
  }

  supports(capability: AICapability, model: string): boolean {
    return modelSpec("anthropic", model)?.supports.includes(capability) ?? false;
  }

  async complete(model: string, request: AIRequest): Promise<AIResponse> {
    const key = appConfig.ai.anthropic;
    if (!key) {
      throw notConfigured(
        "Anthropic",
        "Add ANTHROPIC_API_KEY to .env, or route this capability to another provider in the AI Control Center.",
      );
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    const content: unknown[] = [];
    for (const img of request.images ?? []) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      });
    }

    const messages = request.messages.map((m, i) =>
      i === request.messages.length - 1 && content.length && m.role === "user"
        ? { role: m.role, content: [...content, { type: "text", text: m.content }] }
        : { role: m.role, content: m.content },
    );

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature ?? 0.4,
          system: request.json
            ? `${request.system}\n\nRespond with a single JSON document and nothing else.`
            : request.system,
          messages,
        }),
      });

      const payload = (await res.json()) as AnthropicResponse;

      if (!res.ok) {
        throw new AppError({
          kind:
            res.status === 429
              ? "rate-limited"
              : res.status === 401
                ? "not-configured"
                : "provider-error",
          message: payload.error?.message ?? `Anthropic returned HTTP ${res.status}.`,
          remedy:
            res.status === 429
              ? "Rate limited. The job will retry; lower concurrency in Settings if it persists."
              : res.status === 401
                ? "ANTHROPIC_API_KEY was rejected. Check the key in .env."
                : "Retry the job, or route this capability to the fallback provider.",
          retryable: res.status === 429 || res.status >= 500,
          detail: payload.error?.type,
        });
      }

      const text = (payload.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim();

      const tokensIn = payload.usage?.input_tokens ?? null;
      const tokensOut = payload.usage?.output_tokens ?? null;
      const spec = modelSpec("anthropic", model);
      const costUsd =
        spec?.usdPerMTokIn != null && spec.usdPerMTokOut != null && tokensIn != null && tokensOut != null
          ? (tokensIn / 1e6) * spec.usdPerMTokIn + (tokensOut / 1e6) * spec.usdPerMTokOut
          : null;

      return {
        text,
        provider: this.id,
        model,
        isMock: false,
        tokensIn,
        tokensOut,
        costUsd,
        durationMs: Date.now() - started,
      };
    } catch (e) {
      throw toAppError(e, "Retry, or switch this capability to its fallback provider.");
    } finally {
      clearTimeout(timer);
    }
  }
}
