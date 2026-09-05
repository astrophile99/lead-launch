import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import { factsBlock, jsonParser, runAIJob } from "./ai-jobs";

/**
 * Outreach voice.
 *
 * A generated message that does not sound like the person sending it gets
 * deleted, so tone is configuration, not an afterthought. A voice is a set of
 * dials plus - optionally - a style profile derived from messages the user
 * actually wrote.
 */

export const TONES = [
  "professional",
  "friendly",
  "casual",
  "direct",
  "premium",
  "consultative",
  "bold",
] as const;
export type Tone = (typeof TONES)[number];

export const LENGTHS = ["short", "medium", "detailed"] as const;
export type Length = (typeof LENGTHS)[number];

export const INTENSITIES = ["soft", "balanced", "direct"] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const FORMALITIES = ["low", "medium", "high"] as const;
export type Formality = (typeof FORMALITIES)[number];

export const PERSONALITIES = [
  "confident",
  "warm",
  "observant",
  "founder-like",
  "technical",
  "minimal",
] as const;

export const TONE_HINT: Record<Tone, string> = {
  professional: "Measured and competent. Complete sentences, no slang.",
  friendly: "Warm and human, still concise. Reads like a person, not a brand.",
  casual: "Relaxed and plain. Contractions, short sentences.",
  direct: "Gets to the point in the first line. No preamble.",
  premium: "Understated and precise. Confidence without adjectives.",
  consultative: "Advisory. Leads with the observation, not the offer.",
  bold: "Opinionated. States what is wrong plainly.",
};

/** The derived fingerprint of somebody's writing, from "Learn my style". */
export type StyleProfile = {
  avgSentenceWords: number;
  vocabulary: "plain" | "mixed" | "technical";
  formality: Formality;
  salesPressure: "low" | "medium" | "high";
  openingStyle: string;
  ctaStyle: string;
  usesEmoji: boolean;
  usesContractions: boolean;
  signaturePhrases: string[];
  avoid: string[];
  summary: string;
};

export type Voice = {
  id: string;
  name: string;
  isDefault: boolean;
  tone: Tone;
  length: Length;
  salesIntensity: Intensity;
  formality: Formality;
  personality: string[];
  customInstructions: string | null;
  exampleMessages: string[];
  analysis: StyleProfile | null;
  analysedAt: Date | null;
};

export const DEFAULT_VOICE: Omit<Voice, "id"> = {
  name: "Default voice",
  isDefault: true,
  tone: "direct",
  length: "medium",
  salesIntensity: "soft",
  formality: "medium",
  personality: ["observant", "confident"],
  customInstructions:
    "Write like a person who actually looked at their website. Simple language, no corporate jargon. Never sound desperate.",
  exampleMessages: [],
  analysis: null,
  analysedAt: null,
};

type VoiceRow = {
  id: string;
  name: string;
  isDefault: boolean;
  tone: string;
  length: string;
  salesIntensity: string;
  formality: string;
  personalityJson: string;
  customInstructions: string | null;
  exampleMessagesJson: string | null;
  analysisJson: string | null;
  analysedAt: Date | null;
};

function decode(row: VoiceRow): Voice {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    tone: row.tone as Tone,
    length: row.length as Length,
    salesIntensity: row.salesIntensity as Intensity,
    formality: row.formality as Formality,
    personality: fromJson<string[]>(row.personalityJson, []),
    customInstructions: row.customInstructions,
    exampleMessages: fromJson<string[]>(row.exampleMessagesJson, []),
    analysis: fromJson<StyleProfile | null>(row.analysisJson, null),
    analysedAt: row.analysedAt,
  };
}

export async function listVoices(workspaceId: string): Promise<Voice[]> {
  const rows = await prisma.outreachVoice.findMany({
    where: { workspaceId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return rows.map(decode);
}

/** The voice applied to generation. Falls back to a sane built-in default. */
export async function getActiveVoice(workspaceId: string): Promise<Voice> {
  const row =
    (await prisma.outreachVoice.findFirst({ where: { workspaceId, isDefault: true } })) ??
    (await prisma.outreachVoice.findFirst({ where: { workspaceId } }));
  return row ? decode(row) : { id: "builtin", ...DEFAULT_VOICE };
}

export async function saveVoice(
  workspaceId: string,
  input: Omit<Voice, "id" | "analysis" | "analysedAt"> & { id?: string },
): Promise<Voice> {
  const data = {
    name: input.name.trim() || "Untitled voice",
    tone: input.tone,
    length: input.length,
    salesIntensity: input.salesIntensity,
    formality: input.formality,
    personalityJson: toJson(input.personality),
    customInstructions: input.customInstructions?.trim() || null,
    exampleMessagesJson: toJson(input.exampleMessages.filter((m) => m.trim())),
    isDefault: input.isDefault,
  };

  const row = input.id
    ? await prisma.outreachVoice.update({ where: { id: input.id }, data })
    : await prisma.outreachVoice.create({ data: { ...data, workspaceId } });

  // Exactly one default per workspace, or generation has to guess.
  if (input.isDefault) {
    await prisma.outreachVoice.updateMany({
      where: { workspaceId, id: { not: row.id } },
      data: { isDefault: false },
    });
  }

  return decode(row);
}

export async function deleteVoice(workspaceId: string, id: string): Promise<void> {
  const row = await prisma.outreachVoice.findFirst({ where: { id, workspaceId } });
  if (!row) {
    throw new AppError({
      kind: "not-found",
      message: "Voice not found.",
      remedy: "Refresh the voice list.",
    });
  }
  await prisma.outreachVoice.delete({ where: { id } });

  // Never leave the workspace without a default.
  if (row.isDefault) {
    const next = await prisma.outreachVoice.findFirst({ where: { workspaceId } });
    if (next) {
      await prisma.outreachVoice.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }
}

/* ------------------------------------------------------- learn my style */

const ANALYSIS_SYSTEM = `You are analysing how a specific person writes, so their future messages can sound like them.

Read the supplied samples and describe only what is observably true of them. Do not
flatter the writing, do not suggest improvements, and do not invent traits the samples
do not show. If the samples are too short or too few to judge something, choose the
most neutral option rather than guessing.

Return a single JSON object with exactly these keys:
avgSentenceWords (number), vocabulary ("plain"|"mixed"|"technical"),
formality ("low"|"medium"|"high"), salesPressure ("low"|"medium"|"high"),
openingStyle (string: how they typically open), ctaStyle (string: how they typically ask),
usesEmoji (boolean), usesContractions (boolean),
signaturePhrases (string[]: phrases they actually used), avoid (string[]: things absent
from their writing that a generic AI would add), summary (string: two sentences).`;

function validateProfile(v: unknown): StyleProfile {
  const o = v as Record<string, unknown>;
  const str = (k: string, fb: string) =>
    typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim() : fb;
  const arr = (k: string) =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const oneOf = <T extends string>(k: string, allowed: readonly T[], fb: T): T =>
    allowed.includes(o[k] as T) ? (o[k] as T) : fb;

  return {
    avgSentenceWords:
      typeof o.avgSentenceWords === "number" && Number.isFinite(o.avgSentenceWords)
        ? Math.round(o.avgSentenceWords)
        : 14,
    vocabulary: oneOf("vocabulary", ["plain", "mixed", "technical"] as const, "plain"),
    formality: oneOf("formality", FORMALITIES, "medium"),
    salesPressure: oneOf("salesPressure", ["low", "medium", "high"] as const, "low"),
    openingStyle: str("openingStyle", "Not determined from the samples."),
    ctaStyle: str("ctaStyle", "Not determined from the samples."),
    usesEmoji: o.usesEmoji === true,
    usesContractions: o.usesContractions !== false,
    signaturePhrases: arr("signaturePhrases").slice(0, 8),
    avoid: arr("avoid").slice(0, 8),
    summary: str("summary", "Not enough material to summarise."),
  };
}

/** Measurements taken locally, so the model is grounded rather than guessing. */
function measure(samples: string[]) {
  const text = samples.join("\n");
  const sentences = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 1);
  const words = text.split(/\s+/).filter(Boolean);
  return {
    sampleCount: samples.length,
    totalWords: words.length,
    measuredAvgSentenceWords: sentences.length
      ? Math.round(words.length / sentences.length)
      : words.length,
    containsEmoji: /\p{Extended_Pictographic}/u.test(text),
    containsContractions: /\b\w+'(s|t|re|ve|ll|d|m)\b/i.test(text),
    exclamationCount: (text.match(/!/g) ?? []).length,
    questionCount: (text.match(/\?/g) ?? []).length,
  };
}

export async function analyseStyle(
  workspaceId: string,
  voiceId: string,
  samples: string[],
): Promise<{ profile: StyleProfile; isMock: boolean }> {
  const clean = samples.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) {
    throw new AppError({
      kind: "invalid-input",
      message: "Paste at least one message you wrote yourself.",
      remedy: "The profile is derived from your samples; there is nothing to read without them.",
    });
  }

  const stats = measure(clean);
  if (stats.totalWords < 40) {
    throw new AppError({
      kind: "invalid-input",
      message: `Only ${stats.totalWords} words of sample text — too little to characterise a style.`,
      remedy: "Paste two or three real messages, around 60 words or more in total.",
    });
  }

  const outcome = await runAIJob<StyleProfile>({
    workspaceId,
    type: "voice.analyze",
    capability: "analysis",
    entityType: "voice",
    entityId: voiceId,
    inputSummary: { samples: clean.length, words: stats.totalWords },
    request: {
      system: ANALYSIS_SYSTEM,
      json: true,
      maxTokens: 1200,
      messages: [
        {
          role: "user",
          content: `Analyse these messages.\n\n${factsBlock({ samples: clean, measured: stats })}`,
        },
      ],
    },
    parse: jsonParser(validateProfile),
  });

  await prisma.outreachVoice.update({
    where: { id: voiceId },
    data: {
      analysisJson: toJson(outcome.value),
      analysedAt: new Date(),
      exampleMessagesJson: toJson(clean),
    },
  });

  return { profile: outcome.value, isMock: outcome.isMock };
}

/**
 * Renders a voice into instructions for the copywriting prompt. Kept here so
 * every generator - first message, follow-ups, rewrites - speaks identically.
 */
export function voiceInstructions(voice: Voice): string {
  const lines: string[] = [
    `Tone: ${voice.tone}. ${TONE_HINT[voice.tone] ?? ""}`,
    `Length: ${voice.length === "short" ? "under 60 words" : voice.length === "detailed" ? "120-180 words" : "70-110 words"}.`,
    `Sales intensity: ${voice.salesIntensity}. ${
      voice.salesIntensity === "soft"
        ? "Make the ask easy to ignore."
        : voice.salesIntensity === "direct"
          ? "Ask plainly for the next step."
          : "Ask once, clearly, without pushing."
    }`,
    `Formality: ${voice.formality}.`,
  ];

  if (voice.personality.length) lines.push(`Personality: ${voice.personality.join(", ")}.`);
  if (voice.customInstructions) lines.push(`The sender says: "${voice.customInstructions}"`);

  const a = voice.analysis;
  if (a) {
    lines.push(
      `Match this measured style: about ${a.avgSentenceWords} words per sentence, ${a.vocabulary} vocabulary, ${a.formality} formality, ${a.salesPressure} sales pressure.`,
      `They open like this: ${a.openingStyle}`,
      `They ask like this: ${a.ctaStyle}`,
      a.usesEmoji ? "They do use emoji, sparingly." : "They never use emoji.",
      a.usesContractions ? "They use contractions." : "They avoid contractions.",
    );
    if (a.signaturePhrases.length) {
      lines.push(`Phrases that sound like them: ${a.signaturePhrases.join("; ")}.`);
    }
    if (a.avoid.length) lines.push(`Never write: ${a.avoid.join("; ")}.`);
  }

  return lines.join("\n");
}
