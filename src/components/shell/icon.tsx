import {
  Gauge,
  Radar,
  Table2,
  Stethoscope,
  Target,
  LayoutTemplate,
  Send,
  Columns3,
  ChartNoAxesColumn,
  Cpu,
  Settings2,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  gauge: Gauge,
  radar: Radar,
  table: Table2,
  stethoscope: Stethoscope,
  target: Target,
  layout: LayoutTemplate,
  send: Send,
  columns: Columns3,
  chart: ChartNoAxesColumn,
  cpu: Cpu,
  settings: Settings2,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Cmp = MAP[name] ?? Gauge;
  return <Cmp className={className} strokeWidth={1.75} aria-hidden />;
}
