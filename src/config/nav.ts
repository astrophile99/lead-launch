export type NavItem = {
  href: string;
  label: string;
  icon: string;
  group: "work" | "produce" | "measure" | "system";
  description: string;
};

/** Icon names map to lucide-react exports in components/shell/icon.tsx. */
export const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "gauge", group: "work", description: "Today's state of play" },
  { href: "/discover", label: "Discover", icon: "radar", group: "work", description: "Run a discovery campaign" },
  { href: "/prospects", label: "Prospects", icon: "table", group: "work", description: "Every business on file" },
  { href: "/audit", label: "Audit Center", icon: "stethoscope", group: "work", description: "Website audits and findings" },
  { href: "/radar", label: "Opportunity Radar", icon: "target", group: "work", description: "Ranked by potential" },
  { href: "/studio", label: "Website Studio", icon: "layout", group: "produce", description: "Briefs, builds and previews" },
  { href: "/outreach", label: "Outreach", icon: "send", group: "produce", description: "Drafts awaiting approval" },
  { href: "/pipeline", label: "Pipeline", icon: "columns", group: "produce", description: "Deal stages" },
  { href: "/analytics", label: "Analytics", icon: "chart", group: "measure", description: "Funnel and conversion" },
  { href: "/ai", label: "AI Control Center", icon: "cpu", group: "system", description: "Providers, models, jobs" },
  { href: "/settings", label: "Settings", icon: "settings", group: "system", description: "Scoring, providers, workspace" },
];

export const NAV_GROUPS: { id: NavItem["group"]; label: string }[] = [
  { id: "work", label: "Prospecting" },
  { id: "produce", label: "Production" },
  { id: "measure", label: "Measure" },
  { id: "system", label: "System" },
];
