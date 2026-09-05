import type { AICapability, AIProviderId } from "@/config/ai";

export type AIMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AIRequest = {
  capability: AICapability;
  system: string;
  messages: AIMessage[];
  /** Ask the provider for strict JSON. Callers still validate what comes back. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Base64 PNG/JPEG frames for vision capabilities. */
  images?: { mediaType: string; base64: string }[];
};

export type AIResponse = {
  text: string;
  provider: AIProviderId;
  model: string;
  isMock: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  durationMs: number;
};

export interface AIProvider {
  readonly id: AIProviderId;
  readonly label: string;
  readonly isMock: boolean;
  isConfigured(): boolean;
  supports(capability: AICapability, model: string): boolean;
  complete(model: string, request: AIRequest): Promise<AIResponse>;
}
