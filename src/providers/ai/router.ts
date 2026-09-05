import {
  DEFAULT_ROUTING,
  type AICapability,
  type AIProviderId,
} from "@/config/ai";
import { prisma } from "@/db/client";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { MockAIProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import type { AIProvider } from "./types";

const PROVIDERS: Record<AIProviderId, AIProvider> = {
  anthropic: new AnthropicProvider(),
  openai: new OpenAIProvider(),
  gemini: new GeminiProvider(),
  mock: new MockAIProvider(),
};

export function getAIProvider(id: AIProviderId): AIProvider {
  return PROVIDERS[id] ?? PROVIDERS.mock;
}

export function listAIProviders(): AIProvider[] {
  return Object.values(PROVIDERS);
}

export type Route = {
  provider: AIProvider;
  model: string;
  fallback: { provider: AIProvider; model: string } | null;
  /** True when the configured provider was unavailable and we degraded to mock. */
  degraded: boolean;
  degradedReason: string | null;
};

/**
 * Resolves a capability to a concrete provider + model.
 *
 * Order of preference: the workspace's stored routing, then the compiled
 * default, then the fallback, then the deterministic composer. Degrading to the
 * composer is always reported so the UI can label the output.
 */
export async function resolveRoute(
  workspaceId: string,
  capability: AICapability,
): Promise<Route> {
  const stored = await prisma.aIProviderConfig.findUnique({
    where: { workspaceId_capability: { workspaceId, capability } },
  });

  const primaryId = (stored?.provider ?? DEFAULT_ROUTING[capability].provider) as AIProviderId;
  const primaryModel = stored?.model ?? DEFAULT_ROUTING[capability].model;
  const fallbackId = (stored?.fallbackProvider ??
    DEFAULT_ROUTING[capability].fallback?.provider) as AIProviderId | undefined;
  const fallbackModel =
    stored?.fallbackModel ?? DEFAULT_ROUTING[capability].fallback?.model;

  const enabled = stored?.enabled ?? true;

  const fallback =
    fallbackId && fallbackModel && getAIProvider(fallbackId).isConfigured()
      ? { provider: getAIProvider(fallbackId), model: fallbackModel }
      : null;

  if (!enabled) {
    return {
      provider: PROVIDERS.mock,
      model: "mock-deterministic",
      fallback: null,
      degraded: true,
      degradedReason: `${capability} is disabled in the AI Control Center.`,
    };
  }

  const primary = getAIProvider(primaryId);
  if (primary.isConfigured()) {
    return { provider: primary, model: primaryModel, fallback, degraded: false, degradedReason: null };
  }

  if (fallback) {
    return {
      provider: fallback.provider,
      model: fallback.model,
      fallback: null,
      degraded: false,
      degradedReason: `${primary.label} has no key; using the configured fallback.`,
    };
  }

  return {
    provider: PROVIDERS.mock,
    model: "mock-deterministic",
    fallback: null,
    degraded: true,
    degradedReason: `No API key for ${primary.label} and no usable fallback. Output is composed from stored data, not reasoned.`,
  };
}

export function aiProviderHealth() {
  return listAIProviders().map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    isMock: p.isMock,
    setupHint: p.isMock
      ? "Always available. Composes output from stored facts; performs no inference."
      : `Set ${p.id.toUpperCase()}_API_KEY in .env to enable.`,
  }));
}
