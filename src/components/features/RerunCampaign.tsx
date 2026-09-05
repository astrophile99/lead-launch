"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { rerunCampaignAction } from "@/app/actions";
import { Button } from "@/components/ui/primitives";

export function RerunCampaign({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {note ? <span className="text-[11.5px] text-ink-3">{note}</span> : null}
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setNote(null);
            const res = await rerunCampaignAction(campaignId, true);
            setNote(
              res.ok
                ? `Found ${res.data.discovered} new, skipped ${res.data.duplicates} duplicates.`
                : res.error.message,
            );
            router.refresh();
          })
        }
      >
        {pending ? "Running…" : "Run again"}
      </Button>
    </div>
  );
}
