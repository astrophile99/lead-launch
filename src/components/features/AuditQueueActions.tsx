"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { auditManyAction, rescoreAllAction } from "@/app/actions";
import { Button, ErrorState } from "@/components/ui/primitives";

const BATCH = 25;

export function AuditQueueActions({ prospectIds }: { prospectIds: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);

  const batch = prospectIds.slice(0, BATCH);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setNote(null);
              setError(null);
              const res = await rescoreAllAction();
              setNote(res.ok ? `Rescored ${res.data.count} prospects.` : null);
              if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
              router.refresh();
            })
          }
        >
          Rescore all
        </Button>
        <Button
          variant="primary"
          disabled={pending || batch.length === 0}
          title={
            batch.length === 0
              ? "The queue is empty."
              : `Audits the next ${batch.length} in the queue, four at a time.`
          }
          onClick={() =>
            start(async () => {
              setNote(null);
              setError(null);
              const res = await auditManyAction(batch);
              setNote(
                res.ok ? `Completed ${res.data.completed}, failed ${res.data.failed}.` : null,
              );
              if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
              router.refresh();
            })
          }
        >
          {pending ? "Auditing…" : `Audit next ${batch.length}`}
        </Button>
      </div>
      {note ? <p className="text-[11.5px] text-ok">{note}</p> : null}
      {prospectIds.length > BATCH ? (
        <p className="text-[11.5px] text-ink-3">
          {prospectIds.length - BATCH} more will remain in the queue.
        </p>
      ) : null}
      {error ? (
        <div className="w-full max-w-md">
          <ErrorState title="Audit run failed" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}
    </div>
  );
}
