"use client";

import { useState, useTransition } from "react";
import { testIntegrationAction } from "@/app/actions";
import type { IntegrationGroup, IntegrationItem } from "@/services/integrations";
import { useToast } from "@/components/ui/Toast";
import { NavIcon } from "@/components/shell/icon";
import { Badge, Button, Panel, PanelHeader, type Tone } from "@/components/ui/primitives";
import { cn, relativeTime } from "@/lib/utils";

const STATUS_TONE: Record<IntegrationItem["status"], Tone> = {
  connected: "ok",
  "not-configured": "neutral",
  error: "danger",
  mock: "warn",
  manual: "neutral",
};

const STATUS_LABEL: Record<IntegrationItem["status"], string> = {
  connected: "Connected",
  "not-configured": "Not connected",
  error: "Error",
  mock: "Demo",
  manual: "Manual",
};

/**
 * One integration group.
 *
 * Test results are shown verbatim from the provider. A green badge here means a
 * credential is present; only a passing test proves it works, so the two are
 * reported separately rather than conflated.
 */
export function IntegrationGroupCard({ group }: { group: IntegrationGroup }) {
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <NavIcon name={group.icon} className="size-3.5 text-ink-4" />
            {group.label}
          </span>
        }
        hint={group.description}
        actions={
          <Badge tone={group.ready ? "ok" : "neutral"}>{group.ready ? "ready" : "not set up"}</Badge>
        }
      />
      <ul>
        {group.items.map((item) => (
          <IntegrationRow key={item.id} item={item} />
        ))}
      </ul>
    </Panel>
  );
}

function IntegrationRow({ item }: { item: IntegrationItem }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  return (
    <li className="px-4 py-3 border-b border-line last:border-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] font-medium text-ink">{item.label}</span>
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            {item.lastCheckedAt ? (
              <span className="text-[11px] text-ink-4">
                checked {relativeTime(item.lastCheckedAt)}
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-[11.5px] text-ink-3 leading-relaxed">{item.detail}</p>

          {item.status !== "connected" && item.setupHint !== item.detail ? (
            <p className="mt-1 text-[11.5px] text-ink-4 leading-relaxed">{item.setupHint}</p>
          ) : null}

          {item.envVars.length ? (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {item.envVars.map((v) => (
                <code
                  key={v}
                  className="text-[10.5px] font-mono text-ink-3 bg-surface-2 border border-line rounded-sm px-1 py-0.5"
                >
                  {v}
                </code>
              ))}
            </p>
          ) : null}

          {result ? (
            <p
              className={cn(
                "mt-2 text-[11.5px] leading-relaxed border rounded-sm px-2 py-1.5",
                result.ok
                  ? "text-ok border-ok-line bg-ok-soft"
                  : "text-danger border-danger-line bg-danger-soft",
              )}
            >
              {result.ok ? "✓ " : "✗ "}
              {result.detail}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {item.docsUrl ? (
            <a
              href={item.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-7 px-2.5 inline-flex items-center text-[12px] rounded-sm border border-line text-ink-3 hover:text-ink hover:border-line-strong transition-colors"
            >
              Docs ↗
            </a>
          ) : null}
          {item.testable ? (
            <Button
              size="sm"
              loading={pending}
              onClick={() =>
                start(async () => {
                  setResult(null);
                  const res = await testIntegrationAction(item.id);
                  if (!res.ok) {
                    setResult({ ok: false, detail: res.error.message });
                    toast.error(`${item.label} test failed`, res.error.message);
                    return;
                  }
                  setResult(res.data);
                  if (res.data.ok) toast.success(`${item.label} is working`, res.data.detail);
                  else toast.warning(`${item.label} is not working`, res.data.detail);
                })
              }
            >
              Test
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
