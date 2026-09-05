"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveMessageAction,
  draftSequenceAction,
  markSentManuallyAction,
  recordReplyAction,
  refineMessageAction,
  sendMessageAction,
} from "@/app/actions";
import { REFINEMENTS, REFINEMENT_LABEL } from "@/config/outreach";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, ErrorState, Select } from "@/components/ui/primitives";

type Err = { message: string; remedy: string } | null;

/**
 * Actions on one message.
 *
 * Two rules are visible in the UI rather than only enforced underneath: a
 * message can only be sent after it is approved, and a revision resets that
 * approval — because approval is of specific words, not of an intent.
 */
export function MessageActions({
  messageId,
  status,
  canTransmit,
  transmitReason,
}: {
  messageId: string;
  status: string;
  canTransmit: boolean;
  /** Why this channel can or cannot transmit, shown when it cannot. */
  transmitReason: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<Err>(null);
  const [copied, setCopied] = useState(false);

  function run(
    fn: () => Promise<{ ok: boolean; error?: { message: string; remedy: string } }>,
    success?: string,
  ) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok && res.error) {
        setError({ message: res.error.message, remedy: res.error.remedy });
        toast.error("That did not work", res.error.message);
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 items-end w-full sm:w-auto">
      <div className="flex flex-wrap items-center gap-1.5 justify-end">
        <Button
          size="sm"
          onClick={async () => {
            const el = document.getElementById(`msg-${messageId}`);
            if (el?.textContent) {
              await navigator.clipboard.writeText(el.textContent.trim());
              setCopied(true);
              toast.success("Message copied");
              setTimeout(() => setCopied(false), 1800);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>

        {status === "draft" || status === "approved" ? (
          <Select
            aria-label="Revise this message"
            className="w-auto h-7 text-[12px]"
            value=""
            disabled={pending}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              e.currentTarget.value = "";
              run(async () => {
                const res = await refineMessageAction(messageId, value);
                if (res.ok) {
                  toast.info(
                    REFINEMENT_LABEL[value as (typeof REFINEMENTS)[number]],
                    `${res.data.changed} Approval was reset.`,
                  );
                }
                return res;
              });
            }}
          >
            <option value="">Revise…</option>
            {REFINEMENTS.map((r) => (
              <option key={r} value={r}>
                {REFINEMENT_LABEL[r]}
              </option>
            ))}
          </Select>
        ) : null}

        {status === "draft" ? (
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => run(() => approveMessageAction(messageId), "Message approved")}
          >
            Approve
          </Button>
        ) : null}

        {status === "approved" && canTransmit ? (
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => run(() => sendMessageAction(messageId), "Message sent")}
          >
            Send now
          </Button>
        ) : null}

        {status === "approved" ? (
          <Button
            size="sm"
            disabled={pending}
            title={canTransmit ? "Record that you sent it yourself." : transmitReason}
            onClick={() =>
              run(() => markSentManuallyAction(messageId), "Recorded as sent by hand")
            }
          >
            Mark sent by hand
          </Button>
        ) : null}

        {status === "sent" ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => recordReplyAction(messageId), "Reply recorded")}
          >
            Record a reply
          </Button>
        ) : null}
      </div>

      {status === "approved" && !canTransmit ? (
        <p className="text-[11px] text-ink-4 max-w-md text-right">{transmitReason}</p>
      ) : null}

      {error ? (
        <div className="w-full sm:max-w-md">
          <ErrorState title="Action failed" message={error.message} remedy={error.remedy} compact />
        </div>
      ) : null}
    </div>
  );
}

/** Drafts the whole four-message sequence. Each still needs its own approval. */
export function SequenceButton({
  prospectId,
  channel,
  disabled,
  disabledReason,
}: {
  prospectId: string;
  channel: string;
  disabled: boolean;
  disabledReason: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      loading={pending}
      disabled={disabled || pending}
      title={disabled ? disabledReason : "Drafts the first message plus three follow-ups."}
      onClick={() =>
        start(async () => {
          const res = await draftSequenceAction(prospectId, channel);
          if (!res.ok) {
            toast.error("Could not draft the sequence", res.error.message);
            return;
          }
          toast.success(
            `Drafted ${res.data.created} of 4`,
            res.data.failed
              ? `${res.data.failed} failed. Each draft still needs your approval.`
              : "Each still needs your approval before anything is sent.",
          );
          router.refresh();
        })
      }
    >
      Draft full sequence
    </Button>
  );
}

/** Shows why a channel can or cannot transmit, without pretending either way. */
export function ChannelStatus({
  label,
  status,
  detail,
}: {
  label: string;
  status: "connected" | "not-configured" | "error" | "manual";
  detail: string;
}) {
  return (
    <div className="border border-line rounded-md px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[12.5px] font-medium text-ink">{label}</span>
        <Badge
          tone={
            status === "connected"
              ? "ok"
              : status === "error"
                ? "danger"
                : status === "manual"
                  ? "neutral"
                  : "warn"
          }
          className="ml-auto"
        >
          {status === "connected"
            ? "ready"
            : status === "manual"
              ? "manual"
              : status === "error"
                ? "error"
                : "not connected"}
        </Badge>
      </div>
      <p className="text-[11.5px] text-ink-3 leading-relaxed">{detail}</p>
    </div>
  );
}
