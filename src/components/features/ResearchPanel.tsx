"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshResearchAction } from "@/app/actions";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  InfoNote,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { relativeTime } from "@/lib/utils";

/**
 * What we know about a business, and when we found it out.
 *
 * The header line is the important part: "Last researched 2 days ago" plus a
 * Refresh button. Nothing here re-fetches on render. Opening this page a
 * hundred times costs nothing, and a crawl only happens because someone asked
 * for one — which is the difference between a research bill you can predict
 * and one you cannot.
 */

export type ResearchRow = {
  id: string;
  source: string;
  url: string | null;
  status: string;
  error: string | null;
  requests: number;
  bytesFetched: number;
  fetchedAt: string;
  stale: boolean;
  data: {
    title: string | null;
    description: string | null;
    headings: string[];
    emails: string[];
    phones: string[];
    socials: { platform: string; url: string }[];
    navigation: string[];
    services: string[];
    addresses: string[];
    hasContactForm: boolean;
    hasBooking: boolean;
    ctas: string[];
    images: number;
    pageCount: number;
    brokenLinks: { url: string; status: number }[];
    skipped: { url: string; reason: string }[];
  } | null;
  pages: { url: string; status: number; bytes: number }[];
};

const SOURCE_LABEL: Record<string, string> = {
  crawl: "The business's own website",
  osm: "OpenStreetMap",
  "google-places": "Google Places",
  pagespeed: "PageSpeed Insights",
};

const STATUS_TONE = {
  ok: "ok",
  partial: "warn",
  failed: "danger",
  blocked: "warn",
} as const;

function Facts({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <p className="label mb-1">{label}</p>
      <ul className="flex flex-wrap gap-1">
        {values.map((v) => (
          <li
            key={v}
            className="text-[11.5px] text-ink-2 bg-surface-2 border border-line rounded-sm px-1.5 py-0.5 max-w-full truncate"
          >
            {v}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResearchPanel({
  prospectId,
  records,
  hasWebsite,
}: {
  prospectId: string;
  records: ResearchRow[];
  hasWebsite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);

  const crawl = records.find((r) => r.source === "crawl") ?? null;

  function refresh() {
    setError(null);
    start(async () => {
      const res = await refreshResearchAction(prospectId);
      if (!res.ok) {
        setError({ message: res.error.message, remedy: res.error.remedy });
        return;
      }
      const d = res.data;
      if (d.status === "failed") {
        toast.warning("The site could not be read", "The reason is recorded below.");
      } else {
        toast.success(
          `Read ${d.pages} page${d.pages === 1 ? "" : "s"} in ${d.requests} request${d.requests === 1 ? "" : "s"}`,
          d.changed
            ? "The site has changed since the last crawl."
            : "Nothing has changed since the last crawl.",
        );
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelHeader
          title="Research"
          hint={
            crawl
              ? `Last researched ${relativeTime(crawl.fetchedAt)} · ${crawl.requests} request${
                  crawl.requests === 1 ? "" : "s"
                } · ${(crawl.bytesFetched / 1024).toFixed(0)}KB`
              : "Nothing has been crawled yet. This costs bandwidth, not API credit."
          }
          actions={
            <div className="flex items-center gap-2">
              {crawl?.stale ? <Badge tone="warn">stale</Badge> : null}
              <Button size="sm" loading={pending} disabled={!hasWebsite} onClick={refresh}>
                {crawl ? "Refresh research" : "Research the site"}
              </Button>
            </div>
          }
        />

        {!hasWebsite ? (
          <div className="p-4">
            <InfoNote>
              There is no website on record, so there is nothing to crawl. That absence is itself the
              strongest thing to lead with in a first message — a business with reviews and no site
              is the clearest opportunity this app can find.
            </InfoNote>
          </div>
        ) : null}

        {error ? (
          <div className="p-4">
            <ErrorState title="Research failed" message={error.message} remedy={error.remedy} />
          </div>
        ) : null}
      </Panel>

      {records.length === 0 ? (
        hasWebsite ? (
          <Panel>
            <EmptyState
              title="Not researched yet"
              body="Reading a business's own website is the cheapest and most accurate source of what they actually sell. It costs bandwidth and nothing else."
              action={
                <Button variant="primary" loading={pending} onClick={refresh}>
                  Research now
                </Button>
              }
            />
          </Panel>
        ) : null
      ) : (
        records.map((r) => (
          <Panel key={r.id}>
            <PanelHeader
              title={SOURCE_LABEL[r.source] ?? r.source}
              hint={r.url ?? undefined}
              actions={
                <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                  {r.status}
                </Badge>
              }
            />

            {r.error ? (
              <div className="px-4 py-3">
                <InfoNote tone="danger">{r.error}</InfoNote>
              </div>
            ) : null}

            {r.data ? (
              <div className="px-4 py-3 flex flex-col gap-3.5">
                {r.data.title ? (
                  <div>
                    <p className="label mb-1">How they describe themselves</p>
                    <p className="text-[12.5px] text-ink">{r.data.title}</p>
                    {r.data.description ? (
                      <p className="text-[12px] text-ink-3 mt-0.5 leading-relaxed">
                        {r.data.description}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <Facts label="Contact addresses found" values={r.data.emails} />
                <Facts label="Phone numbers found" values={r.data.phones} />
                <Facts
                  label="Social profiles"
                  values={r.data.socials.map((s) => `${s.platform}: ${s.url}`)}
                />
                <Facts label="Services mentioned" values={r.data.services.slice(0, 10)} />
                <Facts label="Navigation" values={r.data.navigation} />
                <Facts label="Calls to action" values={r.data.ctas} />
                <Facts label="Addresses" values={r.data.addresses} />

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    ["Pages read", String(r.data.pageCount)],
                    ["Images", String(r.data.images)],
                    ["Contact form", r.data.hasContactForm ? "yes" : "none found"],
                    ["Booking action", r.data.hasBooking ? "yes" : "none found"],
                  ].map(([label, value]) => (
                    <div key={label} className="border border-line rounded-sm px-2.5 py-2">
                      <p className="label">{label}</p>
                      <p className="tabular text-[15px] font-medium text-ink mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>

                {r.data.brokenLinks.length > 0 ? (
                  <div>
                    <p className="label mb-1">Pages that returned an error</p>
                    <ul className="flex flex-col gap-0.5">
                      {r.data.brokenLinks.map((l) => (
                        <li key={l.url} className="text-[11.5px] text-danger">
                          {l.url} — HTTP {l.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {r.data.skipped.length > 0 ? (
                  <div>
                    <p className="label mb-1">Fetched but not parsed</p>
                    <ul className="flex flex-col gap-0.5">
                      {r.data.skipped.map((sk) => (
                        <li key={sk.url} className="text-[11.5px] text-ink-4">
                          {sk.url} — {sk.reason}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-ink-4 mt-1">
                      Skipped is not the same as empty. A page the crawler declined to read tells us
                      nothing about the business.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {r.pages.length > 0 ? (
              <details className="border-t border-line">
                <summary className="px-4 py-2 text-[11.5px] text-ink-3 cursor-pointer hover:text-ink-2">
                  Exactly what was fetched ({r.pages.length})
                </summary>
                <Table>
                  <thead>
                    <tr>
                      <Th>URL</Th>
                      <Th className="text-right">Status</Th>
                      <Th className="text-right">Bytes</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.pages.map((p) => (
                      <tr key={p.url}>
                        <Td className="text-ink-2 font-mono text-[11px] break-all">{p.url}</Td>
                        <Td className="tabular text-right text-ink-3">{p.status}</Td>
                        <Td className="tabular text-right text-ink-3">{p.bytes}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </details>
            ) : null}
          </Panel>
        ))
      )}
    </div>
  );
}
