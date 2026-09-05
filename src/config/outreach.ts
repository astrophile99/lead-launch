/**
 * Client-safe outreach constants.
 *
 * These live in config rather than beside the services that use them because
 * client components need them too, and importing a service would drag Prisma -
 * and through it better-sqlite3 and node:fs - into the browser bundle.
 */

import type { OutreachChannel } from "@/types";

/* -------------------------------------------------------------- channels */

export const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  instagram: "Instagram DM",
  linkedin: "LinkedIn",
  generic: "Generic copy",
};

export const CHANNEL_LIMITS: Record<OutreachChannel, { maxChars: number; note: string }> = {
  email: { maxChars: 1400, note: "Plain text. No images, no tracking pixels." },
  whatsapp: { maxChars: 700, note: "Conversational, short paragraphs, no subject line." },
  instagram: { maxChars: 900, note: "Direct message. No links in the first message." },
  linkedin: { maxChars: 1100, note: "Professional register, no attachments." },
  generic: { maxChars: 1200, note: "Channel-agnostic copy the user will paste somewhere." },
};

export const VARIANTS = [
  "short",
  "normal",
  "detailed",
  "followup1",
  "followup2",
  "final",
] as const;

export const VARIANT_LABEL: Record<(typeof VARIANTS)[number], string> = {
  short: "Short pitch",
  normal: "Normal pitch",
  detailed: "Detailed pitch",
  followup1: "Follow-up 1",
  followup2: "Follow-up 2",
  final: "Final follow-up",
};

/** The full sequence, with the gap suggested between each step. */
export const SEQUENCE: { variant: (typeof VARIANTS)[number]; label: string; waitDays: number }[] = [
  { variant: "normal", label: "First message", waitDays: 0 },
  { variant: "followup1", label: "Follow-up 1", waitDays: 4 },
  { variant: "followup2", label: "Follow-up 2", waitDays: 9 },
  { variant: "final", label: "Final follow-up", waitDays: 16 },
];

/* ------------------------------------------------------------ refinements */

export const REFINEMENTS = [
  "shorten",
  "warmer",
  "more-direct",
  "less-salesy",
  "use-my-voice",
  "regenerate",
] as const;

export type Refinement = (typeof REFINEMENTS)[number];

export const REFINEMENT_LABEL: Record<Refinement, string> = {
  shorten: "Shorten",
  warmer: "Make warmer",
  "more-direct": "Make more direct",
  "less-salesy": "Make less salesy",
  "use-my-voice": "Use my voice",
  regenerate: "Regenerate",
};

export const REFINEMENT_INSTRUCTION: Record<Refinement, string> = {
  shorten:
    "Cut it to roughly two-thirds the length. Remove the least specific sentence first. Keep every concrete observation.",
  warmer:
    "Make it warmer and more human without adding flattery or any claim that is not in the facts. Warmth comes from plainer words, not from compliments.",
  "more-direct":
    "Get to the point in the first sentence. Remove hedging. Ask for the next step plainly.",
  "less-salesy":
    "Remove anything that reads as a pitch. Lead with the observation. Make the ask smaller and easier to decline.",
  "use-my-voice":
    "Rewrite it so it matches the sender's own style profile as closely as possible, keeping every factual claim intact.",
  regenerate:
    "Write a different message from the same facts. Take a different angle from the current draft.",
};

/* ------------------------------------------------------------------ voice */

export const TONES = [
  "professional",
  "friendly",
  "casual",
  "direct",
  "premium",
  "consultative",
  "bold",
] as const;
export type VoiceTone = (typeof TONES)[number];

export const LENGTHS = ["short", "medium", "detailed"] as const;
export type VoiceLength = (typeof LENGTHS)[number];

export const INTENSITIES = ["soft", "balanced", "direct"] as const;
export type VoiceIntensity = (typeof INTENSITIES)[number];

export const FORMALITIES = ["low", "medium", "high"] as const;
export type VoiceFormality = (typeof FORMALITIES)[number];

export const PERSONALITIES = [
  "confident",
  "warm",
  "observant",
  "founder-like",
  "technical",
  "minimal",
] as const;

export const TONE_HINT: Record<VoiceTone, string> = {
  professional: "Measured and competent. Complete sentences, no slang.",
  friendly: "Warm and human, still concise. Reads like a person, not a brand.",
  casual: "Relaxed and plain. Contractions, short sentences.",
  direct: "Gets to the point in the first line. No preamble.",
  premium: "Understated and precise. Confidence without adjectives.",
  consultative: "Advisory. Leads with the observation, not the offer.",
  bold: "Opinionated. States what is wrong plainly.",
};

export const LENGTH_HINT: Record<VoiceLength, string> = {
  short: "under 60 words",
  medium: "70-110 words",
  detailed: "120-180 words",
};
