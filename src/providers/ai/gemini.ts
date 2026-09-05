import { appConfig } from "@/config/app";
import { modelSpec, type AICapability } from "@/config/ai";
import { AppError, notConfigured, toAppError } from "@/lib/errors";
import type { AIProvider, AIRequest, AIResponse } from "./types";

/** Google Gemini (generateContent) adapter. */

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
};

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly label = "Google Gemini";
  readonly isMock = false;

  isConfigured(): boolean {
    return Boolean(appConfig.ai.gemini);
  }

  supports(capability: AICapability, model: string): boolean {
    return modelSpec("gemini", model)?.supports.includes(capability) ?? false;
  }

  async complete(model: string, request: AIRequest): Promise<AIResponse> {
    const key = appConfig.ai.gemini;
    if (!key) {
      throw notConfigured(
        "Gemini",
        "Add GEMINI_API_KEY to .env, or route this capability elsewhere in the AI Control Center.",
      );
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);

    const parts: unknown[] = [];
    for (const img of request.images ?? []) {
      parts.push({ inline_data: { mime_type: img.mediaType, data: img.base64 } });
    }

    const contents = request.messages.map((m, i) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts:
        i === request.messages.length - 1 && parts.length
          ? [...parts, { text: m.content }]
          : [{ text: m.content }],
    }));

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: request.system }] },
            generationConfig: {
              temperature: request.temperature ?? 0.4,
              maxOutputTokens: request.maxTokens ?? 4096,
              ...(request.json ? { responseMimeType: "application/json" } : {}),
            },
          }),
        },
      );

      const payload = (await res.json()) as GeminiResponse;
      if (!res.ok) {
        throw new AppError({
          kind: res.status === 429 ? "rate-limited" : res.status === 403 ? "not-configured" : "provider-error",
          message: payload.error?.message ?? `Gemini returned HTTP ${res.status}.`,
          remedy:
            res.status === 403
              ? "GEMINI_API_KEY was rejected. Check the key and that the Generative Language API is enabled."
              : "Retry the job, or route this capability to the fallback provider.",
          retryable: res.status === 429 || res.status >= 500,
          detail: payload.error?.status,
        });
      }

      const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();

      const tokensIn = payload.usageMetadata?.promptTokenCount ?? null;
      const tokensOut = payload.usageMetadata?.candidatesTokenCount ?? null;
      const spec = modelSpec("gemini", model);
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
