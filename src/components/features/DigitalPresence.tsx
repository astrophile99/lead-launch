import { NavIcon } from "@/components/shell/icon";
import { Badge, InfoNote, Panel, PanelHeader, type Tone } from "@/components/ui/primitives";
import { cn, hostOf } from "@/lib/utils";

/**
 * Digital presence.
 *
 * Three states, not two. "Missing" is a claim — it says we looked and found
 * nothing — and the discovery provider does not return every field, so
 * anything it never reports is "unknown" instead. Google Places, for example,
 * exposes no email address at all; calling that "missing" would be a lie about
 * the business rather than a fact about our data.
 */

export type PresenceState = "available" | "missing" | "unknown";

export type PresenceChannel = {
  id: string;
  label: string;
  icon: string;
  state: PresenceState;
  value: string | null;
  href: string | null;
  note: string;
};

const STATE_TONE: Record<PresenceState, Tone> = {
  available: "ok",
  missing: "danger",
  unknown: "neutral",
};

const STATE_LABEL: Record<PresenceState, string> = {
  available: "Available",
  missing: "Missing",
  unknown: "Not checked",
};

export function buildPresence(business: {
  website: string | null;
  googleUrl: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  email: string | null;
  phone: string | null;
  source: string;
}): PresenceChannel[] {
  // Which fields a provider can actually populate, so "unknown" is accurate.
  const providerReturnsEmail = business.source !== "google-places";
  const providerReturnsSocial = business.source !== "google-places";

  const channel = (
    id: string,
    label: string,
    icon: string,
    value: string | null,
    opts: { href?: string | null; checkable: boolean; note: string },
  ): PresenceChannel => ({
    id,
    label,
    icon,
    state: value ? "available" : opts.checkable ? "missing" : "unknown",
    value,
    href: value ? (opts.href ?? value) : null,
    note: opts.note,
  });

  return [
    channel("website", "Website", "globe", business.website, {
      checkable: true,
      note: business.website
        ? `Live at ${hostOf(business.website)}`
        : "No website was returned by the discovery provider.",
    }),
    channel("google", "Google listing", "search", business.googleUrl, {
      checkable: true,
      note: business.googleUrl
        ? "Found via the map listing."
        : "No map listing on record.",
    }),
    channel("phone", "Phone", "phone", business.phone, {
      href: business.phone ? `tel:${business.phone.replace(/[^\d+]/g, "")}` : null,
      checkable: true,
      note: business.phone ? "Direct line on record." : "No number returned.",
    }),
    channel("email", "Email", "email", business.email, {
      href: business.email ? `mailto:${business.email}` : null,
      checkable: providerReturnsEmail,
      note: business.email
        ? "Direct address on record."
        : providerReturnsEmail
          ? "No address found."
          : "Google Places does not expose email addresses, so this was never checked.",
    }),
    channel("instagram", "Instagram", "instagram", business.instagram, {
      checkable: providerReturnsSocial,
      note: business.instagram
        ? "Profile on record."
        : providerReturnsSocial
          ? "No profile found."
          : "Not returned by this discovery provider.",
    }),
    channel("facebook", "Facebook", "facebook", business.facebook, {
      checkable: providerReturnsSocial,
      note: business.facebook
        ? "Page on record."
        : providerReturnsSocial
          ? "No page found."
          : "Not returned by this discovery provider.",
    }),
    channel("linkedin", "LinkedIn", "linkedin", business.linkedin, {
      checkable: providerReturnsSocial,
      note: business.linkedin
        ? "Company page on record."
        : providerReturnsSocial
          ? "No company page found."
          : "Not returned by this discovery provider.",
    }),
  ];
}

export function DigitalPresenceGrid({ channels }: { channels: PresenceChannel[] }) {
  const unknown = channels.filter((c) => c.state === "unknown").length;

  return (
    <Panel>
      <PanelHeader
        title="Channels"
        hint="Only what is actually on record. Nothing is called missing unless it was genuinely checked."
        actions={
          <Badge tone="neutral">
            {channels.filter((c) => c.state === "available").length} of {channels.length}
          </Badge>
        }
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-3">
        {channels.map((c) => (
          <div
            key={c.id}
            className="px-3.5 py-3 border-b border-r border-line last:border-r-0 sm:[&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(3n)]:border-r-0"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <NavIcon
                name={c.icon}
                className={cn(
                  "size-3.5 shrink-0",
                  c.state === "available"
                    ? "text-ok"
                    : c.state === "missing"
                      ? "text-danger"
                      : "text-ink-4",
                )}
              />
              <span className="text-[12.5px] font-medium text-ink">{c.label}</span>
              <Badge tone={STATE_TONE[c.state]} className="ml-auto">
                {STATE_LABEL[c.state]}
              </Badge>
            </div>

            {c.value ? (
              c.href ? (
                <a
                  href={c.href}
                  target={c.href.startsWith("http") ? "_blank" : undefined}
                  rel="noopener noreferrer"
                  className="text-[11.5px] text-accent hover:underline underline-offset-2 break-all block"
                >
                  {c.value}
                </a>
              ) : (
                <p className="text-[11.5px] text-ink-2 break-all">{c.value}</p>
              )
            ) : null}

            <p className="mt-0.5 text-[11px] text-ink-4 leading-snug">{c.note}</p>
          </div>
        ))}
      </div>

      {unknown > 0 ? (
        <div className="p-3.5 border-t border-line">
          <InfoNote>
            {unknown} channel{unknown === 1 ? " is" : "s are"} marked{" "}
            <strong className="font-semibold">not checked</strong> rather than missing: the
            discovery provider that produced this record does not return those fields, so their
            absence here says nothing about the business.
          </InfoNote>
        </div>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------------------------------- competitors */

export type CompetitorRow = {
  id: string;
  name: string;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  websiteScore: number | null;
  verified: boolean;
};

export function CompetitorCompare({
  prospect,
  competitors,
}: {
  prospect: {
    name: string;
    rating: number | null;
    reviewCount: number | null;
    websiteScore: number | null;
    hasWebsite: boolean;
  };
  competitors: CompetitorRow[];
}) {
  if (competitors.length === 0) {
    return (
      <Panel>
        <PanelHeader title="Competitor intelligence" />
        <div className="p-4">
          <InfoNote>
            <strong className="font-semibold">No competitor data has been collected.</strong>{" "}
            Competitor discovery needs a business-data provider that can search by category and
            locality — set <code>GOOGLE_PLACES_API_KEY</code> or <code>SERPAPI_API_KEY</code> and
            re-run discovery. An empty list here means nothing was verified; it does not mean this
            business has no competitors, and the app will not invent any to fill the space.
          </InfoNote>
        </div>
      </Panel>
    );
  }

  const verified = competitors.filter((c) => c.verified);
  const rows: { label: string; self: string; values: (string | number | null)[] }[] = [
    {
      label: "Rating",
      self: prospect.rating != null ? `${prospect.rating}★` : "—",
      values: competitors.map((c) => (c.rating != null ? `${c.rating}★` : null)),
    },
    {
      label: "Reviews",
      self: prospect.reviewCount?.toLocaleString() ?? "—",
      values: competitors.map((c) => c.reviewCount?.toLocaleString() ?? null),
    },
    {
      label: "Website score",
      self: prospect.hasWebsite ? (prospect.websiteScore?.toString() ?? "not audited") : "no website",
      values: competitors.map((c) => c.websiteScore?.toString() ?? null),
    },
    {
      label: "Website",
      self: prospect.hasWebsite ? "yes" : "none",
      values: competitors.map((c) => (c.website ? hostOf(c.website) : "none")),
    },
  ];

  const better = verified.filter(
    (c) => (c.websiteScore ?? 0) > (prospect.websiteScore ?? 0),
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelHeader
          title="Side by side"
          hint={`${verified.length} of ${competitors.length} competitor records are verified. Only verified rows are used in briefs or messages.`}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className="text-left px-3 h-9 border-b border-line bg-surface-2 text-[10.5px] uppercase tracking-[0.07em] text-ink-3 font-semibold">
                  Metric
                </th>
                <th className="text-left px-3 h-9 border-b border-line bg-accent-soft text-[11.5px] text-accent font-semibold whitespace-nowrap">
                  {prospect.name}
                </th>
                {competitors.map((c) => (
                  <th
                    key={c.id}
                    className="text-left px-3 h-9 border-b border-line bg-surface-2 text-[11.5px] text-ink-2 font-medium whitespace-nowrap"
                  >
                    {c.name}
                    {!c.verified ? (
                      <span className="ml-1.5 align-middle">
                        <Badge tone="warn">unverified</Badge>
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="px-3 h-9 border-b border-line text-ink-3">{r.label}</td>
                  <td className="px-3 h-9 border-b border-line text-ink font-medium bg-accent-soft/40">
                    {r.self}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={competitors[i].id} className="px-3 h-9 border-b border-line text-ink-2">
                      {v ?? <span className="text-ink-4">unknown</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Competitive gap" />
          <div className="px-4 py-3 text-[12.5px] text-ink-2 leading-relaxed">
            {verified.length === 0 ? (
              <p className="text-ink-3">
                Nothing is verified, so no gap can be stated. Unverified rows are shown above for
                context only.
              </p>
            ) : better > 0 ? (
              <p>
                {better} of {verified.length} verified competitor
                {verified.length === 1 ? "" : "s"} score higher on their website than{" "}
                {prospect.name}
                {prospect.websiteScore != null ? ` (${prospect.websiteScore}/100)` : ""}. That gap is
                the argument: the reputation is already there, the site is what is behind.
              </p>
            ) : (
              <p>
                No verified competitor scores higher on their website. The pitch here is not
                &ldquo;you are behind&rdquo; — it is a specific conversion or reputation
                opportunity, which the audit findings will name.
              </p>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="What a new website could do differently" />
          <ul className="px-4 py-3 flex flex-col gap-1.5 text-[12.5px] text-ink-2">
            {[
              "Publish what the competitors leave implicit: price ranges, wait times, who actually does the work.",
              "Make the primary action reachable in one tap on a phone, which most local sites still do not.",
              "Put the review volume on the page rather than leaving it on the map listing.",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-accent shrink-0">·</span>
                {line}
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-[11.5px] text-ink-4 leading-snug">
            These are directions for the brief, not claims about the competitors above.
          </p>
        </Panel>
      </div>
    </div>
  );
}
