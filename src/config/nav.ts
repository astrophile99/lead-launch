export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the mobile bottom bar. */
  shortLabel?: string;
  icon: string;
  group: "work" | "produce" | "measure" | "system";
  description: string;
  /** Which live counter, if any, is shown as a badge. */
  badge?: "drafts" | "tasks" | "unaudited" | "projects";
};

/** Icon names map to lucide-react exports in components/shell/icon.tsx. */
export const NAV: NavItem[] = [
  {
    href: "/",
    label: "Overview",
    shortLabel: "Home",
    icon: "gauge",
    group: "work",
    description: "Today's state of play",
  },
  {
    href: "/discover",
    label: "Discover",
    icon: "radar",
    group: "work",
    description: "Run a discovery campaign",
  },
  {
    href: "/prospects",
    label: "Prospects",
    shortLabel: "Leads",
    icon: "table",
    group: "work",
    description: "Every business on file",
  },
  {
    href: "/audit",
    label: "Audit Center",
    shortLabel: "Audit",
    icon: "stethoscope",
    group: "work",
    description: "Website audits and findings",
    badge: "unaudited",
  },
  {
    href: "/radar",
    label: "Opportunity Radar",
    shortLabel: "Radar",
    icon: "target",
    group: "work",
    description: "Ranked by potential",
  },
  {
    href: "/studio",
    label: "Website Studio",
    shortLabel: "Studio",
    icon: "layout",
    group: "produce",
    description: "Briefs, builds and previews",
    badge: "projects",
  },
  {
    href: "/outreach",
    label: "Outreach",
    icon: "send",
    group: "produce",
    description: "Drafts awaiting approval",
    badge: "drafts",
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    icon: "columns",
    group: "produce",
    description: "Deal stages",
    badge: "tasks",
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: "chart",
    group: "measure",
    description: "Funnel and conversion",
  },
  {
    href: "/ai",
    label: "AI Control Center",
    shortLabel: "AI",
    icon: "cpu",
    group: "system",
    description: "Providers, models, jobs and spend",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "settings",
    group: "system",
    description: "Integrations, scoring, workspace",
  },
];

export const NAV_GROUPS: { id: NavItem["group"]; label: string }[] = [
  { id: "work", label: "Prospecting" },
  { id: "produce", label: "Production" },
  { id: "measure", label: "Measure" },
];

/**
 * The mobile bottom bar. Four destinations plus More: any more than that and
 * the targets stop being comfortably tappable on a 375px screen.
 */
export const MOBILE_PRIMARY: string[] = ["/", "/prospects", "/studio", "/pipeline"];

/** Everything reachable only from the mobile "More" sheet. */
export const MOBILE_MORE: string[] = [
  "/discover",
  "/audit",
  "/radar",
  "/outreach",
  "/analytics",
  "/ai",
  "/settings",
];
