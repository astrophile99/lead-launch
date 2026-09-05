"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveMessageAction,
  markSentManuallyAction,
  recordReplyAction,
  sendMessageAction,
} from "@/app/actions";
import { Button, ErrorState } from "@/components/ui/primitives";

export function MessageActions({
  messageId,
  status,
  channel,
  canTransmit,
}: {
  messageId: string;
  status: string;
  channel: string;
  canTransmit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string; remedy: string } }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError({ message: res.error.message, remedy: res.error.remedy });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 items-end">
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <Button
          size="sm"
          onClick={async () => {
            const el = document.getElementById(`msg-${messageId}`);
            if (el?.textContent) {
              await navigator.clipboard.writeText(el.textContent);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>

        {status === "draft" ? (
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => run(() => approveMessageAction(messageId))}
          >
            Approve
          </Button>
        ) : null}

        {status === "approved" && canTransmit ? (
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => run(() => sendMessageAction(messageId))}
          >
            Send now
          </Button>
        ) : null}

        {status === "approved" ? (
          <Button
            size="sm"
            disabled={pending}
            title={
              canTransmit
                ? "Record that you sent it yourself."
                : `${channel} has no sanctioned automated transport — send it from your own account, then mark it here.`
            }
            onClick={() => run(() => markSentManuallyAction(messageId))}
          >
            Mark sent by hand
          </Button>
        ) : null}

        {status === "sent" ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => recordReplyAction(messageId))}>
            Record a reply
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="w-full max-w-md">
          <ErrorState title="Action failed" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}
    </div>
  );
}
