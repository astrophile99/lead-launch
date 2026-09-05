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
      className={cn("bg-surface border border-line rounded-md shadow-panel", className)}
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
        "flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 border-b border-line",
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

type ButtonVariant = "primary" | "default" | "ghost" | "danger" | "subtle";
type ButtonSize = "xs" | "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 font-medium rounded-sm border whitespace-nowrap " +
  "transition-[background-color,border-color,color,opacity] duration-150 " +
  "disabled:opacity-45 disabled:pointer-events-none select-none";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink border-accent hover:bg-accent-hover hover:border-accent-hover active:bg-accent-active",
  default: "bg-surface-2 text-ink border-line-strong hover:bg-surface-3 hover:border-ink-4",
  subtle: "bg-transparent text-ink-2 border-line hover:bg-surface-2 hover:text-ink",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-2 hover:text-ink",
  danger: "bg-transparent text-danger border-danger-line hover:bg-danger-soft",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  xs: "h-6 px-1.5 text-[11.5px]",
  sm: "h-7 px-2.5 text-[12px]",
  md: "h-8 px-3 text-[12.5px]",
  lg: "h-9 px-4 text-[13px]",
};

export function Button({
  variant = "default",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-3" /> : null}
      {children}
    </button>
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

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "anim-spin inline-block size-3.5 rounded-full border-[1.5px] border-current border-t-transparent opacity-70",
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------- badge */

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  ok: "bg-ok-soft text-ok border-ok-line",
  warn: "bg-warn-soft text-warn border-warn-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  info: "bg-info-soft text-info border-info-line",
};

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-ink-4",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  title,
  dot = false,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 border rounded-sm px-1.5 h-5 text-[11px] font-medium leading-none whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", DOT_TONE[tone])} /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral", live = false }: { tone?: Tone; live?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 rounded-full shrink-0", DOT_TONE[tone], live && "anim-live")}
    />
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

const SCORE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-ink-3",
  accent: "text-accent",
  info: "text-info",
};

export function ScoreBadge({
  score,
  label,
  size = "sm",
}: {
  score: number | null | undefined;
  label?: string;
  size?: "sm" | "lg" | "xl";
}) {
  const tone = scoreTone(score);

  if (size !== "sm") {
    return (
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "tabular font-semibold leading-none tracking-[-0.03em]",
            size === "xl" ? "text-[44px]" : "text-[32px]",
            SCORE_TEXT[tone],
          )}
        >
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

const METER_BG: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  accent: "bg-accent",
  neutral: "bg-ink-4",
};

/** Horizontal meter. Width is the value; nothing animates on first paint. */
export function Meter({
  value,
  max = 100,
  tone = "accent",
  className,
  height = "sm",
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
  height?: "xs" | "sm" | "md";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cn(
        "w-full bg-surface-3 rounded-full overflow-hidden",
        height === "xs" ? "h-1" : height === "md" ? "h-2" : "h-1.5",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", METER_BG[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Determinate job progress with a count, or indeterminate when total is unknown. */
export function Progress({
  done,
  total,
  label,
  tone = "accent",
}: {
  done: number;
  total: number | null;
  label?: string;
  tone?: Tone;
}) {
  const pct = total && total > 0 ? Math.round((done / total) * 100) : null;
  return (
    <div className="flex flex-col gap-1">
      {label || pct != null ? (
        <div className="flex items-baseline gap-2">
          {label ? <span className="text-[12px] text-ink-2">{label}</span> : null}
          <span className="tabular ml-auto text-[11.5px] text-ink-3">
            {total != null ? `${done} / ${total}` : done}
            {pct != null ? ` · ${pct}%` : ""}
          </span>
        </div>
      ) : null}
      <Meter value={pct ?? 0} tone={tone} />
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({
  title,
  body,
  action,
  secondaryAction,
  icon,
  compact = false,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 gap-2",
        compact ? "py-8" : "py-14",
      )}
    >
      {icon ? (
        <div className="mb-1 size-9 grid place-items-center rounded-md bg-surface-2 border border-line text-ink-4">
          {icon}
        </div>
      ) : null}
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="text-[12.5px] text-ink-3 max-w-sm leading-relaxed">{body}</p>
      {action || secondaryAction ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/** Error surface. Always answers: what happened, why, and what to do next. */
export function ErrorState({
  title,
  message,
  remedy,
  action,
  compact = false,
}: {
  title: string;
  message: string;
  remedy?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border border-danger-line bg-danger-soft rounded-md",
        compact ? "px-3 py-2" : "px-4 py-3",
      )}
      role="alert"
    >
      <p className="text-[12.5px] font-semibold text-danger">{title}</p>
      <p className="mt-1 text-[12.5px] text-ink-2 leading-relaxed">{message}</p>
      {remedy ? <p className="mt-1.5 text-[12px] text-ink-3 leading-relaxed">{remedy}</p> : null}
      {action ? <div className="mt-2.5">{action}</div> : null}
    </div>
  );
}

const NOTE_TONE: Record<Tone, string> = {
  info: "border-info-line bg-info-soft",
  warn: "border-warn-line bg-warn-soft",
  danger: "border-danger-line bg-danger-soft",
  ok: "border-ok-line bg-ok-soft",
  accent: "border-accent-line bg-accent-soft",
  neutral: "border-line bg-surface-2",
};

export function InfoNote({ children, tone = "info" }: { children: ReactNode; tone?: Tone }) {
  return (
    <div
      className={cn(
        "border rounded-md px-3 py-2 text-[12px] text-ink-2 leading-relaxed",
        NOTE_TONE[tone],
      )}
    >
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- skeletons */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-3" aria-hidden aria-label="Loading">
      <div className="flex gap-3 pb-2 mb-2 border-b border-line">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-3">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={cn("h-3", c === 0 ? "flex-[2]" : "flex-1")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonTiles({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-6" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-surface border border-line rounded-md px-3.5 py-3">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-6 w-12 mt-2.5" />
          <Skeleton className="h-2.5 w-20 mt-2.5" />
        </div>
      ))}
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
  error,
  htmlFor,
  children,
  className,
  required,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required ? <span className="text-accent ml-0.5">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-[11.5px] text-danger leading-snug">{error}</p>
      ) : hint ? (
        <p className="text-[11.5px] text-ink-3 leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "h-8 w-full bg-surface-2 border border-line-strong rounded-sm px-2 text-[12.5px] text-ink " +
  "placeholder:text-ink-4 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 " +
  "disabled:opacity-50 transition-colors";

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

export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: ComponentPropsWithoutRef<"input"> & { label: ReactNode; hint?: string }) {
  return (
    <label className={cn("flex items-start gap-2 cursor-pointer select-none", className)}>
      <input
        type="checkbox"
        className="mt-0.5 size-3.5 accent-[var(--accent)] shrink-0 cursor-pointer"
        {...rest}
      />
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink-2 leading-snug">{label}</span>
        {hint ? <span className="block text-[11.5px] text-ink-4 leading-snug mt-0.5">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Segmented control — for 2-5 mutually exclusive, immediately-applied choices. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "sm" | "md";
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex bg-surface-2 border border-line rounded-sm p-0.5 gap-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[3px] font-medium transition-colors whitespace-nowrap",
            size === "sm" ? "h-5.5 px-2 text-[11px]" : "h-6.5 px-2.5 text-[12px]",
            value === o.value
              ? "bg-surface-4 text-ink shadow-panel"
              : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  description,
  actions,
  meta,
  breadcrumb,
}: {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start gap-x-6 gap-y-3 pb-4 mb-5 border-b border-line">
      {/* Below `sm` the title takes the full row and the actions drop beneath it;
          sharing the row at 375px squeezed the heading to one word per line. */}
      <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
        {breadcrumb ? <div className="mb-1.5">{breadcrumb}</div> : null}
        <h1 className="text-[19px] sm:text-[21px] font-semibold tracking-[-0.022em] text-ink leading-tight">
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
  trend,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  href?: string;
  trend?: { direction: "up" | "down" | "flat"; text: string };
}) {
  const inner = (
    <>
      <p className="label">{label}</p>
      <p
        className={cn(
          "tabular mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.025em]",
          tone ? SCORE_TEXT[tone] : "text-ink",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-[11.5px] text-ink-3 leading-snug">{sub}</p> : null}
      {trend ? (
        <p
          className={cn(
            "mt-1.5 text-[11.5px] leading-snug",
            trend.direction === "up"
              ? "text-ok"
              : trend.direction === "down"
                ? "text-danger"
                : "text-ink-3",
          )}
        >
          {trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→"} {trend.text}
        </p>
      ) : null}
    </>
  );

  const cls = cn(
    "block bg-surface border border-line rounded-md px-3.5 py-3 shadow-panel",
    href && "hover:border-line-strong hover:bg-surface-2 transition-colors",
  );

  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** A key/value list used across detail screens. Skips rows with no value. */
export function DetailList({
  items,
  className,
  labelWidth = "w-32",
}: {
  items: [string, ReactNode][];
  className?: string;
  labelWidth?: string;
}) {
  return (
    <dl className={cn("text-[12.5px]", className)}>
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-4 py-1.5 border-b border-line last:border-0">
          <dt className={cn("text-ink-3 shrink-0", labelWidth)}>{k}</dt>
          <dd className="text-ink-2 min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
