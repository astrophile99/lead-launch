import Link from "next/link";
import type { JobView } from "@/services/jobs";
import { Badge, EmptyState, Meter, StatusDot, type Tone } from "@/components/ui/primitives";
import { cn, relativeTime } from "@/lib/utils";

const STATUS_TONE: Record<JobView["status"], Tone> = {
  queued: "neutral",
  running: "info",
  completed: "ok",
  failed: "danger",
  cancelled: "warn",
};

const KIND_LABEL: Record<JobView["kind"], string> = {
  discovery: "Discovery",
  audit: "Audit",
  ai: "AI",
  build: "Build",
  deployment: "Deploy",
  outreach: "Outreach",
};

function duration(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/**
 * The unified job feed. Progress bars appear only where the operation actually
 * reports progress — a single-step job shows none rather than a fake one.
 */
export function JobList({ jobs, emptyBody }: { jobs: JobView[]; emptyBody?: string }) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No jobs yet"
        body={
          emptyBody ??
          "Discovery runs, audits, AI calls, builds and deployments all appear here as they happen."
        }
        compact
      />
    );
  }

  return (
    <ul>
      {jobs.map((job) => {
        const body = (
          <div className="px-4 py-2.5 flex items-start gap-3">
            <span className="mt-1.5">
              <StatusDot tone={STATUS_TONE[job.status]} live={job.status === "running"} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12.5px] text-ink font-medium truncate">{job.title}</span>
                <Badge tone="neutral">{KIND_LABEL[job.kind]}</Badge>
                {job.isMock ? <Badge tone="warn">demo</Badge> : null}
              </div>

              <p
                className={cn(
                  "text-[11.5px] leading-snug mt-0.5",
                  job.error ? "text-danger" : "text-ink-3",
                )}
              >
                {job.error ? job.error.message : job.detail}
              </p>
              {job.error?.remedy ? (
                <p className="text-[11px] text-ink-4 leading-snug mt-0.5">{job.error.remedy}</p>
              ) : null}

              {job.progress && job.progress.total ? (
                <div className="mt-1.5 max-w-56">
                  <Meter
                    value={job.progress.done}
                    max={job.progress.total}
                    height="xs"
                    tone={job.status === "failed" ? "danger" : "accent"}
                  />
                </div>
              ) : null}
            </div>

            <div className="text-right shrink-0">
              <p className="text-[11px] text-ink-4">{relativeTime(job.startedAt)}</p>
              {job.durationMs != null ? (
                <p className="tabular text-[11px] text-ink-4">{duration(job.durationMs)}</p>
              ) : null}
            </div>
          </div>
        );

        return (
          <li key={job.id} className="border-b border-line last:border-0">
            {job.href ? (
              <Link href={job.href} className="block hover:bg-surface-2 transition-colors">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
