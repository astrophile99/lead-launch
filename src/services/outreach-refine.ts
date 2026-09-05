import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import {
  REFINEMENT_INSTRUCTION,
  REFINEMENT_LABEL,
  type Refinement,
} from "@/config/outreach";
import { factsBlock, jsonParser, runAIJob } from "./ai-jobs";
import { logActivity } from "./activity";
import { getActiveVoice, voiceInstructions } from "./voice";

/**
 * Rewriting an existing draft.
 *
 * A rewrite is still bound by the same rule as the original: it may only use
 * observations already recorded against the prospect. "Make it warmer" must not
 * become licence to invent a compliment about a business nobody looked at, so
 * the grounded observation list is passed in again and the model is told it is
 * the only permitted source of specifics.
 */

const SYSTEM = `You are revising a message a freelance web developer will send to a local business.

Absolute rules, unchanged by the revision requested:
- Every specific claim must appear in the <facts> block. Never introduce a new observation,
  metric, competitor, compliment or credential.
- If the revision would require a fact you do not have, make the message shorter instead.
- Do not use "I hope this finds you well", "reach out", "circle back", "unlock", "leverage",
  or "in today's digital landscape".

Return a single JSON object: { "subject": string|null, "body": string, "changed": string }
where "changed" is one short sentence describing what you actually altered.`;

export type RefineResult = {
  subject: string | null;
  body: string;
  changed: string;
  isMock: boolean;
};

export async function refineMessage(
  workspaceId: string,
  messageId: string,
  refinement: Refinement,
): Promise<RefineResult> {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId } },
    include: { prospect: { include: { business: true } } },
  });

  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "Message not found.",
      remedy: "Refresh the outreach list.",
    });
  }
  if (message.status === "sent" || message.status === "replied") {
    throw new AppError({
      kind: "conflict",
      message: "This message has already been sent.",
      remedy: "Draft a follow-up instead of editing a sent message.",
    });
  }

  const voice = await getActiveVoice(workspaceId);
  const observations = fromJson<string[]>(message.observationsJson, []);

  const outcome = await runAIJob<{ subject: string | null; body: string; changed: string }>({
    workspaceId,
    type: "outreach.refine",
    capability: "copywriting",
    entityType: "prospect",
    entityId: message.prospectId,
    inputSummary: { messageId, refinement, channel: message.channel },
    request: {
      system: `${SYSTEM}\n\n--- How this sender writes ---\n${voiceInstructions(voice)}`,
      json: true,
      temperature: refinement === "regenerate" ? 0.8 : 0.5,
      maxTokens: 1200,
      messages: [
        {
          role: "user",
          content: `${REFINEMENT_INSTRUCTION[refinement]}\n\n${factsBlock({
            businessName: message.prospect.business.name,
            category: message.prospect.business.category,
            city: message.prospect.business.city,
            website: message.prospect.business.website,
            channel: message.channel,
            variant: message.variant,
            currentSubject: message.subject,
            currentBody: message.body,
            observations,
            refinement,
          })}`,
        },
      ],
    },
    parse: jsonParser((v) => {
      const o = v as Record<string, unknown>;
      const body = typeof o.body === "string" ? o.body.trim() : "";
      if (!body) {
        throw new AppError({
          kind: "provider-error",
          message: "The model returned an empty message body.",
          remedy: "Retry, or route copywriting to a different model.",
          retryable: true,
        });
      }
      return {
        subject:
          typeof o.subject === "string" && o.subject.trim() ? o.subject.trim() : message.subject,
        body,
        changed: typeof o.changed === "string" ? o.changed.trim() : "Rewritten.",
      };
    }),
  });

  // A revision returns the message to draft: approval applies to specific words.
  await prisma.outreachMessage.update({
    where: { id: messageId },
    data: {
      subject: outcome.value.subject,
      body: outcome.value.body,
      status: "draft",
      approvedAt: null,
      provider: outcome.provider,
      model: outcome.model,
      voiceId: voice.id === "builtin" ? null : voice.id,
      observationsJson: toJson(observations),
    },
  });

  await prisma.outreachEvent.create({
    data: {
      messageId,
      type: "created",
      detail: `Revised (${REFINEMENT_LABEL[refinement]}): ${outcome.value.changed}`,
    },
  });

  await logActivity({
    workspaceId,
    prospectId: message.prospectId,
    type: "outreach.drafted",
    message: `Message revised — ${REFINEMENT_LABEL[refinement].toLowerCase()}. Approval was reset.`,
    meta: { messageId, refinement },
  });

  return { ...outcome.value, isMock: outcome.isMock };
}
