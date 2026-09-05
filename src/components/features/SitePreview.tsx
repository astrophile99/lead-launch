"use client";

import { useRef, useState } from "react";
import { Button, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const DEVICES = [
  { id: "mobile", label: "Mobile", width: 375 },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "laptop", label: "Laptop", width: 1024 },
  { id: "desktop", label: "Desktop", width: 1440 },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

/**
 * Embedded preview of the generated project. The iframe loads the real files
 * from disk through the preview route; it is sandboxed because the content is
 * generated markup.
 */
export function SitePreview({
  slug,
  compareUrl,
  title,
}: {
  slug: string;
  compareUrl?: string | null;
  title: string;
}) {
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [compare, setCompare] = useState(false);
  const [nonce, setNonce] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  const width = DEVICES.find((d) => d.id === device)!.width;
  const src = `/api/projects/${slug}/preview/index.html?v=${nonce}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Preview width"
          className="inline-flex border border-line rounded-[3px] overflow-hidden"
        >
          {DEVICES.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={device === d.id}
              onClick={() => setDevice(d.id)}
              className={cn(
                "h-7 px-2.5 text-[11.5px] border-r border-line last:border-r-0 transition-colors",
                device === d.id ? "bg-surface-3 text-ink font-medium" : "text-ink-3 hover:bg-surface-2",
              )}
            >
              {d.label}
              <span className="tabular text-ink-4 ml-1">{d.width}</span>
            </button>
          ))}
        </div>

        <Button size="sm" onClick={() => setNonce((n) => n + 1)}>
          Refresh
        </Button>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="h-6.5 px-2 inline-flex items-center text-[12px] rounded-[3px] border border-line-strong text-ink hover:bg-surface-2 transition-colors"
        >
          Open in new tab
        </a>

        {compareUrl ? (
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2 ml-auto select-none">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />
            Compare with the current site
          </label>
        ) : null}
      </div>

      <div className={cn("grid gap-3", compare && compareUrl ? "lg:grid-cols-2" : "")}>
        {compare && compareUrl ? (
          <figure className="flex flex-col gap-1.5 min-w-0">
            <figcaption className="flex items-center gap-2 text-[11.5px] text-ink-3">
              <Badge tone="danger">Current site</Badge>
              <span className="truncate">{compareUrl}</span>
            </figcaption>
            <div className="border border-line rounded-[3px] bg-surface-2 overflow-hidden">
              <iframe
                title="Current website"
                src={compareUrl}
                sandbox=""
                referrerPolicy="no-referrer"
                className="w-full h-[34rem] bg-white"
              />
            </div>
            <p className="text-[11px] text-ink-4">
              Loaded directly from the live site. Many sites refuse to be framed and will appear
              blank — that is the site&apos;s header policy, not a failure here.
            </p>
          </figure>
        ) : null}

        <figure className="flex flex-col gap-1.5 min-w-0">
          {compare && compareUrl ? (
            <figcaption className="flex items-center gap-2 text-[11.5px] text-ink-3">
              <Badge tone="ok">Generated</Badge>
              <span className="truncate">{title}</span>
            </figcaption>
          ) : null}
          <div className="border border-line rounded-[3px] bg-surface-2 overflow-x-auto">
            <div className="mx-auto transition-[width] duration-300" style={{ width: Math.min(width, 1440) }}>
              <iframe
                ref={frame}
                key={`${device}-${nonce}`}
                title={`Generated website preview — ${device}`}
                src={src}
                sandbox="allow-same-origin"
                className="w-full h-[34rem] bg-white block"
                style={{ width }}
              />
            </div>
          </div>
        </figure>
      </div>
    </div>
  );
}
