"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateRoutingAction } from "@/app/actions";
import {
  CAPABILITY_META,
  MODEL_CATALOG,
  type AICapability,
  type AIProviderId,
} from "@/config/ai";
import { Badge, Button, ErrorState, Select, Table, Td, Th } from "@/components/ui/primitives";

export type RoutingRow = {
  capability: AICapability;
  provider: AIProviderId;
  model: string;
  fallbackProvider: AIProviderId | null;
  fallbackModel: string | null;
  providerConfigured: boolean;
  effectiveProvider: string;
  degradedReason: string | null;
};

const PROVIDERS: AIProviderId[] = ["anthropic", "openai", "gemini", "mock"];

export function RoutingEditor({ rows }: { rows: RoutingRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Record<string, { provider: AIProviderId; model: string }>>(
    Object.fromEntries(rows.map((r) => [r.capability, { provider: r.provider, model: r.model }])),
  );
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function save(row: RoutingRow) {
    const d = draft[row.capability];
    setError(null);
    setSaved(null);
    start(async () => {
      const res = await updateRoutingAction(
        row.capability,
        d.provider,
        d.model,
        row.fallbackProvider,
        row.fallbackModel,
      );
      if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
      else setSaved(row.capability);
      router.refresh();
    });
  }

  return (
    <>
      {error ? (
        <div className="px-4 pt-3">
          <ErrorState title="Could not save routing" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}
      <Table>
        <thead>
          <tr>
            <Th>Capability</Th>
            <Th>Purpose</Th>
            <Th>Provider</Th>
            <Th>Model</Th>
            <Th>Fallback</Th>
            <Th>Effective</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = draft[r.capability];
            const models = MODEL_CATALOG[d.provider] ?? [];
            const changed = d.provider !== r.provider || d.model !== r.model;
            return (
              <tr key={r.capability} className="align-top">
                <Td className="py-2.5">
                  <span className="text-ink font-medium">{CAPABILITY_META[r.capability].label}</span>
                  <span className="block text-[10.5px] text-ink-4">{r.capability}</span>
                </Td>
                <Td className="py-2.5 max-w-64 text-ink-3">{CAPABILITY_META[r.capability].purpose}</Td>
                <Td className="py-2">
                  <Select
                    aria-label={`Provider for ${r.capability}`}
                    className="w-auto"
                    value={d.provider}
                    onChange={(e) => {
                      const provider = e.target.value as AIProviderId;
                      setDraft((s) => ({
                        ...s,
                        [r.capability]: { provider, model: MODEL_CATALOG[provider][0].id },
                      }));
                    }}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td className="py-2">
                  <Select
                    aria-label={`Model for ${r.capability}`}
                    className="w-auto"
                    value={d.model}
                    onChange={(e) =>
                      setDraft((s) => ({
                        ...s,
                        [r.capability]: { ...s[r.capability], model: e.target.value },
                      }))
                    }
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id} disabled={!m.supports.includes(r.capability)}>
                        {m.label} ({m.tier})
                        {m.supports.includes(r.capability) ? "" : " — unsupported"}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td className="py-2.5 text-ink-3">
                  {r.fallbackProvider ? `${r.fallbackProvider} / ${r.fallbackModel}` : "none"}
                </Td>
                <Td className="py-2.5">
                  <Badge tone={r.degradedReason ? "warn" : "ok"} title={r.degradedReason ?? undefined}>
                    {r.effectiveProvider}
                  </Badge>
                  {r.degradedReason ? (
                    <p className="text-[10.5px] text-ink-4 mt-1 max-w-56 leading-snug">
                      {r.degradedReason}
                    </p>
                  ) : null}
                </Td>
                <Td className="py-2 text-right">
                  <Button
                    size="sm"
                    variant={changed ? "primary" : "default"}
                    disabled={pending || !changed}
                    onClick={() => save(r)}
                  >
                    {saved === r.capability && !changed ? "Saved" : "Save"}
                  </Button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
