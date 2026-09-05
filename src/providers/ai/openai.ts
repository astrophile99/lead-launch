import { appConfig } from "@/config/app";
import { modelSpec, type AICapability } from "@/config/ai";
import { AppError, notConfigured, toAppError } from "@/lib/errors";
import type { AIProvider, AIRequest, AIResponse } from "./types";

/** OpenAI Chat Completions adapter. Same contract as every other AIProvider. */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

type OpenAIResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
};

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly label = "OpenAI";
  readonly isMock = false;

  isConfigured(): boolean {
    return Boolean(appConfig.ai.openai);
  }

  supports(capability: AICapability, model: string): boolean {
    return modelSpec("openai", model)?.supports.includes(capability) ?? false;
  }

  async complete(model: string, request: AIRequest): Promise<AIResponse> {
    const key = appConfig.ai.openai;
    if (!key) {
      throw notConfigured(
        "OpenAI",
        "Add OPENAI_API_KEY to .env, or route this capability elsewhere in the AI Control Center.",
      );
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    const messages: unknown[] = [{ role: "system", content: request.system }];
    request.messages.forEach((m, i) => {
      const isLast = i === request.messages.length - 1;
      if (isLast && request.images?.length && m.role === "user") {
        messages.push({
          role: "user",
          content: [
            ...request.images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
            })),
            { type: "text", text: m.content },
          ],
        });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    });

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: request.temperature ?? 0.4,
          max_completion_tokens: request.maxTokens ?? 4096,
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });

      const payload = (await res.json()) as OpenAIResponse;
      if (!res.ok) {
        throw new AppError({
          kind: res.status === 429 ? "rate-limited" : res.status === 401 ? "not-configured" : "provider-error",
          message: payload.error?.message ?? `OpenAI returned HTTP ${res.status}.`,
          remedy:
            res.status === 401
              ? "OPENAI_API_KEY was rejected. Check the key in .env."
              : "Retry the job, or route this capability to the fallback provider.",
          retryable: res.status === 429 || res.status >= 500,
        });
      }

      const tokensIn = payload.usage?.prompt_tokens ?? null;
      const tokensOut = payload.usage?.completion_tokens ?? null;
      const spec = modelSpec("openai", model);
      const costUsd =
        spec?.usdPerMTokIn != null && spec.usdPerMTokOut != null && tokensIn != null && tokensOut != null
          ? (tokensIn / 1e6) * spec.usdPerMTokIn + (tokensOut / 1e6) * spec.usdPerMTokOut
          : null;

      return {
        text: (payload.choices?.[0]?.message?.content ?? "").trim(),
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
