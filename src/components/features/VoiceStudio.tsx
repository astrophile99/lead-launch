"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { analyseStyleAction, deleteVoiceAction, saveVoiceAction } from "@/app/actions";
import {
  FORMALITIES,
  INTENSITIES,
  LENGTHS,
  PERSONALITIES,
  TONES,
  TONE_HINT,
} from "@/config/outreach";
import { useToast } from "@/components/ui/Toast";
import {
  Badge,
  Button,
  DetailList,
  ErrorState,
  Field,
  InfoNote,
  Input,
  Panel,
  PanelHeader,
  Segmented,
  Textarea,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type VoiceView = {
  id: string;
  name: string;
  isDefault: boolean;
  tone: string;
  length: string;
  salesIntensity: string;
  formality: string;
  personality: string[];
  customInstructions: string | null;
  exampleMessages: string[];
  analysis: {
    avgSentenceWords: number;
    vocabulary: string;
    formality: string;
    salesPressure: string;
    openingStyle: string;
    ctaStyle: string;
    usesEmoji: boolean;
    usesContractions: boolean;
    signaturePhrases: string[];
    avoid: string[];
    summary: string;
  } | null;
  analysedAt: string | null;
};

const BUILTIN: VoiceView = {
  id: "",
  name: "My voice",
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

/**
 * The voice studio.
 *
 * Two halves that do different jobs: the dials on the left are a fast way to
 * set a register, and "Learn my style" on the right derives a fingerprint from
 * writing the user actually produced. The second is far more effective, so it
 * gets equal billing rather than being buried in an advanced section.
 */
export function VoiceStudio({ voices }: { voices: VoiceView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [selectedId, setSelectedId] = useState<string>(voices[0]?.id ?? "");
  const current = voices.find((v) => v.id === selectedId) ?? voices[0] ?? BUILTIN;

  const [draft, setDraft] = useState<VoiceView>(current);
  const [samples, setSamples] = useState(current.exampleMessages.join("\n\n---\n\n"));
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);

  function select(id: string) {
    const next = voices.find((v) => v.id === id) ?? BUILTIN;
    setSelectedId(id);
    setDraft(next);
    setSamples(next.exampleMessages.join("\n\n---\n\n"));
    setError(null);
  }

  const set = <K extends keyof VoiceView>(key: K, value: VoiceView[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function save() {
    setError(null);
    start(async () => {
      const res = await saveVoiceAction({
        id: draft.id || undefined,
        name: draft.name,
        isDefault: draft.isDefault,
        tone: draft.tone,
        length: draft.length,
        salesIntensity: draft.salesIntensity,
        formality: draft.formality,
        personality: draft.personality,
        customInstructions: draft.customInstructions,
        exampleMessages: splitSamples(samples),
      });
      if (!res.ok) {
        setError({ message: res.error.message, remedy: res.error.remedy });
        toast.error("Could not save the voice", res.error.message);
        return;
      }
      setSelectedId(res.data.id);
      toast.success("Voice saved", "It applies to every message generated from now on.");
      router.refresh();
    });
  }

  function learn() {
    setError(null);
    const list = splitSamples(samples);
    if (list.length === 0) {
      setError({
        message: "There is nothing to analyse.",
        remedy: "Paste two or three messages you wrote yourself, separated by a blank line.",
      });
      return;
    }

    start(async () => {
      // The voice has to exist before it can carry a profile.
      let voiceId = draft.id;
      if (!voiceId) {
        const created = await saveVoiceAction({
          id: undefined,
          name: draft.name,
          isDefault: draft.isDefault,
          tone: draft.tone,
          length: draft.length,
          salesIntensity: draft.salesIntensity,
          formality: draft.formality,
          personality: draft.personality,
          customInstructions: draft.customInstructions,
          exampleMessages: list,
        });
        if (!created.ok) {
          setError({ message: created.error.message, remedy: created.error.remedy });
          return;
        }
        voiceId = created.data.id;
        setSelectedId(voiceId);
      }

      const res = await analyseStyleAction(voiceId, list);
      if (!res.ok) {
        setError({ message: res.error.message, remedy: res.error.remedy });
        toast.error("Could not analyse the samples", res.error.message);
        return;
      }
      toast.success(
        res.data.isMock ? "Style profile composed" : "Style profile learned",
        res.data.summary,
      );
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* ------------------------------------------------------------ dials */}
      <Panel>
        <PanelHeader
          title="Voice"
          hint="Applied to every generated message, including rewrites and follow-ups."
          actions={
            <Button variant="primary" size="sm" loading={pending} onClick={save}>
              Save voice
            </Button>
          }
        />

        <div className="px-4 py-3 flex flex-col gap-4">
          {voices.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {voices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => select(v.id)}
                  className={cn(
                    "h-6 px-2 text-[11.5px] rounded-sm border transition-colors",
                    v.id === selectedId
                      ? "bg-accent-soft border-accent-line text-accent"
                      : "border-line text-ink-3 hover:text-ink",
                  )}
                >
                  {v.name}
                  {v.isDefault ? " ·" : ""}
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="v-name">
              <Input
                id="v-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="My voice"
              />
            </Field>
            <Field label="Default" htmlFor="v-default" hint="Used when nothing else is chosen.">
              <label className="flex items-center gap-2 h-8 text-[12.5px] text-ink-2">
                <input
                  id="v-default"
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={draft.isDefault}
                  onChange={(e) => set("isDefault", e.target.checked)}
                />
                Use this voice by default
              </label>
            </Field>
          </div>

          <div>
            <p className="label mb-1.5">Tone</p>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => (
                <button
                  key={t}
                  type="button"
                  title={TONE_HINT[t]}
                  onClick={() => set("tone", t)}
                  className={cn(
                    "h-7 px-2.5 text-[12px] rounded-sm border capitalize transition-colors",
                    draft.tone === t
                      ? "bg-accent-soft border-accent-line text-accent font-medium"
                      : "border-line text-ink-3 hover:text-ink hover:border-line-strong",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-ink-3">
              {TONE_HINT[draft.tone as keyof typeof TONE_HINT]}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="label mb-1.5">Length</p>
              <Segmented
                ariaLabel="Message length"
                size="sm"
                value={draft.length}
                onChange={(v) => set("length", v)}
                options={LENGTHS.map((l) => ({ value: l, label: l }))}
              />
            </div>
            <div>
              <p className="label mb-1.5">Sales intensity</p>
              <Segmented
                ariaLabel="Sales intensity"
                size="sm"
                value={draft.salesIntensity}
                onChange={(v) => set("salesIntensity", v)}
                options={INTENSITIES.map((l) => ({ value: l, label: l }))}
              />
            </div>
            <div>
              <p className="label mb-1.5">Formality</p>
              <Segmented
                ariaLabel="Formality"
                size="sm"
                value={draft.formality}
                onChange={(v) => set("formality", v)}
                options={FORMALITIES.map((l) => ({ value: l, label: l }))}
              />
            </div>
          </div>

          <div>
            <p className="label mb-1.5">Personality</p>
            <div className="flex flex-wrap gap-1.5">
              {PERSONALITIES.map((p) => {
                const on = draft.personality.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      set(
                        "personality",
                        on
                          ? draft.personality.filter((x) => x !== p)
                          : [...draft.personality, p],
                      )
                    }
                    className={cn(
                      "h-6 px-2 text-[11.5px] rounded-sm border capitalize transition-colors",
                      on
                        ? "bg-accent-soft border-accent-line text-accent"
                        : "border-line text-ink-3 hover:text-ink",
                    )}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          <Field
            label="Custom instruction"
            htmlFor="v-custom"
            hint="Written verbatim into the prompt. Say what you never want to see."
          >
            <Textarea
              id="v-custom"
              rows={3}
              value={draft.customInstructions ?? ""}
              onChange={(e) => set("customInstructions", e.target.value)}
              placeholder="Write like me. Simple language. No corporate jargon. Never sound desperate."
            />
          </Field>

          {error ? <ErrorState title="Could not save" message={error.message} remedy={error.remedy} /> : null}

          {draft.id ? (
            <div className="pt-1">
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await deleteVoiceAction(draft.id);
                    if (res.ok) {
                      toast.success("Voice deleted");
                      select("");
                      router.refresh();
                    }
                  })
                }
              >
                Delete this voice
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>

      {/* ---------------------------------------------------- learn my style */}
      <Panel>
        <PanelHeader
          title="Learn my style"
          hint="Paste messages you actually wrote. The profile is derived from them and nothing else."
          actions={
            <Button size="sm" loading={pending} onClick={learn}>
              Analyse
            </Button>
          }
        />

        <div className="px-4 py-3 flex flex-col gap-3">
          <Field
            label="Your own messages"
            htmlFor="v-samples"
            hint="Separate messages with a blank line or a --- divider. Two or three is enough."
          >
            <Textarea
              id="v-samples"
              rows={10}
              value={samples}
              onChange={(e) => setSamples(e.target.value)}
              placeholder={
                "Hi Raj,\n\nSaw the clinic's site loads slowly on mobile and the booking button is below the fold...\n\n---\n\nHi Anita,\n\nQuick one — noticed you're taking bookings over Instagram DMs..."
              }
            />
          </Field>

          {draft.analysis ? (
            <div className="border border-line rounded-md">
              <div className="px-3 py-2 border-b border-line flex items-center gap-2">
                <p className="label">Style profile</p>
                {draft.analysedAt ? (
                  <span className="text-[11px] text-ink-4 ml-auto">
                    {new Date(draft.analysedAt).toLocaleDateString()}
                  </span>
                ) : null}
              </div>
              <div className="px-3 py-2">
                <p className="text-[12.5px] text-ink-2 leading-relaxed mb-2">
                  {draft.analysis.summary}
                </p>
                <DetailList
                  labelWidth="w-32"
                  items={[
                    ["Sentence length", `~${draft.analysis.avgSentenceWords} words`],
                    ["Vocabulary", draft.analysis.vocabulary],
                    ["Formality", draft.analysis.formality],
                    ["Sales pressure", draft.analysis.salesPressure],
                    ["Opens with", draft.analysis.openingStyle],
                    ["Asks like", draft.analysis.ctaStyle],
                    [
                      "Habits",
                      [
                        draft.analysis.usesEmoji ? "uses emoji" : "no emoji",
                        draft.analysis.usesContractions ? "contractions" : "no contractions",
                      ].join(", "),
                    ],
                  ]}
                />
                {draft.analysis.signaturePhrases.length ? (
                  <div className="mt-2">
                    <p className="label mb-1">Sounds like you</p>
                    <div className="flex flex-wrap gap-1">
                      {draft.analysis.signaturePhrases.map((p) => (
                        <Badge key={p} tone="accent">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {draft.analysis.avoid.length ? (
                  <div className="mt-2">
                    <p className="label mb-1">Never write</p>
                    <div className="flex flex-wrap gap-1">
                      {draft.analysis.avoid.map((p) => (
                        <Badge key={p} tone="danger">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <InfoNote>
              No profile yet. Analysing your samples produces a fingerprint — sentence length,
              vocabulary, how you open, how you ask — that constrains every generated message far
              more effectively than the dials alone.
            </InfoNote>
          )}
        </div>
      </Panel>
    </div>
  );
}

/** Splits on a --- divider or a blank line, whichever the user used. */
function splitSamples(raw: string): string[] {
  return raw
    .split(/\n\s*-{3,}\s*\n|\n\s*\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
