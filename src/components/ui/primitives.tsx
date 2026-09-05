import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ surface */

export function Panel({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={cn(
        "bg-surface border border-line rounded-[3px] shadow-panel",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  hint,
  actions,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-start gap-4 px-4 py-3 border-b border-line",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {hint ? <p className="mt-0.5 text-[12px] text-ink-3 leading-snug">{hint}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </header>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("label", className)}>{children}</p>;
}

/* ------------------------------------------------------------------ button */

type ButtonVariant = "primary" | "default" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 font-medium rounded-[3px] border whitespace-nowrap " +
  "transition-[background-color,border-color,color] duration-150 " +
  "disabled:opacity-45 disabled:pointer-events-none select-none";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink border-accent hover:bg-accent-hover hover:border-accent-hover",
  default:
    "bg-surface text-ink border-line-strong hover:bg-surface-2 hover:border-ink-4",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink",
  danger: "bg-transparent text-danger border-line-strong hover:bg-danger-soft hover:border-danger",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-6.5 px-2 text-[12px]",
  md: "h-8 px-3 text-[12.5px]",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  ...rest
}: ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...rest}
    />
  );
}

export function LinkButton({
  variant = "default",
  size = "md",
  className,
  ...rest
}: ComponentPropsWithoutRef<"a"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <a
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------- badge */

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent border-accent/25",
  ok: "bg-ok-soft text-ok border-ok/25",
  warn: "bg-warn-soft text-warn border-warn/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  info: "bg-info-soft text-info border-info/25",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  title,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 border rounded-[2px] px-1.5 h-5 text-[11px] font-medium leading-none whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Labels demo data everywhere it appears. Deliberately hard to miss. */
export function MockBadge({ what = "Demo data" }: { what?: string }) {
  return (
    <Badge tone="warn" title="Generated locally. No external service was called.">
      {what}
    </Badge>
  );
}

/* ------------------------------------------------------------------ scores */

export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "neutral";
  if (score >= 75) return "ok";
  if (score >= 50) return "warn";
  return "danger";
}

export function ScoreBadge({
  score,
  label,
  size = "sm",
}: {
  score: number | null | undefined;
  label?: string;
  size?: "sm" | "lg";
}) {
  const tone = scoreTone(score);
  if (size === "lg") {
    const color =
      tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-ink-3";
    return (
      <div className="flex items-baseline gap-1.5">
        <span className={cn("tabular text-[34px] font-semibold leading-none tracking-[-0.03em]", color)}>
          {score ?? "—"}
        </span>
        <span className="text-[12px] text-ink-3">/ 100</span>
        {label ? <span className="ml-1 text-[12px] text-ink-3">{label}</span> : null}
      </div>
    );
  }
  return (
    <Badge tone={tone}>
      <span className="tabular">{score ?? "—"}</span>
      {label ? <span className="text-ink-3 font-normal">{label}</span> : null}
    </Badge>
  );
}

/** Horizontal meter. Width is the value; there is no animation on load. */
export function Meter({
  value,
  max = 100,
  tone,
  className,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bg =
    tone === "ok"
      ? "bg-ok"
      : tone === "warn"
        ? "bg-warn"
        : tone === "danger"
          ? "bg-danger"
          : tone === "info"
            ? "bg-info"
            : "bg-accent";
  return (
    <div className={cn("h-1.5 w-full bg-surface-3 rounded-[1px] overflow-hidden", className)}>
      <div className={cn("h-full transition-[width] duration-500 ease-out", bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14 gap-2">
      {icon ? <div className="text-ink-4 mb-1">{icon}</div> : null}
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="text-[12.5px] text-ink-3 max-w-sm leading-relaxed">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Error surface. Always answers: what happened, why, and what to do next. */
export function ErrorState({
  title,
  message,
  remedy,
  action,
}: {
  title: string;
  message: string;
  remedy?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-danger/30 bg-danger-soft rounded-[3px] px-4 py-3">
      <p className="text-[12.5px] font-semibold text-danger">{title}</p>
      <p className="mt-1 text-[12.5px] text-ink-2 leading-relaxed">{message}</p>
      {remedy ? <p className="mt-1.5 text-[12px] text-ink-3 leading-relaxed">{remedy}</p> : null}
      {action ? <div className="mt-2.5">{action}</div> : null}
    </div>
  );
}

export function InfoNote({ children, tone = "info" }: { children: ReactNode; tone?: Tone }) {
  const cls =
    tone === "warn"
      ? "border-warn/30 bg-warn-soft"
      : tone === "danger"
        ? "border-danger/30 bg-danger-soft"
        : tone === "ok"
          ? "border-ok/30 bg-ok-soft"
          : "border-info/30 bg-info-soft";
  return (
    <div className={cn("border rounded-[3px] px-3 py-2 text-[12px] text-ink-2 leading-relaxed", cls)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- table */

export function Table({ className, ...rest }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[12.5px]", className)} {...rest} />
    </div>
  );
}

export function Th({ className, ...rest }: ComponentPropsWithoutRef<"th">) {
  return (
    <th
      className={cn(
        "text-left font-semibold text-[10.5px] tracking-[0.07em] uppercase text-ink-3",
        "px-3 h-8 border-b border-line bg-surface-2 whitespace-nowrap",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: ComponentPropsWithoutRef<"td">) {
  return (
    <td
      className={cn("px-3 h-9 border-b border-line align-middle text-ink-2", className)}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------- forms */

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11.5px] text-ink-3 leading-snug">{hint}</p> : null}
    </div>
  );
}

const CONTROL =
  "h-8 w-full bg-surface border border-line-strong rounded-[3px] px-2 text-[12.5px] text-ink " +
  "placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 " +
  "disabled:opacity-50";

export function Input({ className, ...rest }: ComponentPropsWithoutRef<"input">) {
  return <input className={cn(CONTROL, className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentPropsWithoutRef<"select">) {
  return <select className={cn(CONTROL, "pr-6", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentPropsWithoutRef<"textarea">) {
  return (
    <textarea
      className={cn(CONTROL, "h-auto py-1.5 leading-relaxed resize-y min-h-20", className)}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start gap-x-6 gap-y-3 pb-4 mb-5 border-b border-line">
      {/* Below `sm` the title takes the full row and the actions drop beneath it;
          sharing the row at 375px squeezed the heading to one word per line. */}
      <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-ink leading-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-[12.5px] text-ink-3 max-w-2xl leading-relaxed">{description}</p>
        ) : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      ) : null}
    </header>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const color =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";
  const inner = (
    <>
      <p className="label">{label}</p>
      <p className={cn("tabular mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.025em]", color)}>
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-ink-3 leading-snug">{sub}</p> : null}
    </>
  );
  const cls =
    "block bg-surface border border-line rounded-[3px] px-3.5 py-3 shadow-panel " +
    (href ? "hover:border-line-strong transition-colors" : "");
  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
