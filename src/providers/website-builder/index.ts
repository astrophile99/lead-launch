import type { AIProviderId } from "@/config/ai";
import type { BuildStrategy } from "@/config/build";
import { AgentBuilder } from "./agent";
import { ScaffoldBuilder } from "./scaffold";
import type { WebsiteBuilder } from "./types";

/**
 * Builder selection.
 *
 * The operator asks for a strategy; this returns the builder that will actually
 * run, together with whether that is what was asked for. The caller records
 * both, so a build that fell back to the scaffold is labelled a scaffold build
 * everywhere afterwards — in the version row, in the timeline, on the download
 * screen and in the README.
 */

export type BuilderSelection = {
  builder: WebsiteBuilder;
  requested: BuildStrategy;
  ran: BuildStrategy;
  /** Set when `ran` differs from `requested`. */
  fallbackReason: string | null;
};

export async function selectBuilder(
  workspaceId: string,
  requested: BuildStrategy,
  choice: { provider: AIProviderId; model: string },
): Promise<BuilderSelection> {
  if (requested === "scaffold") {
    return {
      builder: new ScaffoldBuilder(),
      requested,
      ran: "scaffold",
      fallbackReason: null,
    };
  }

  const agent = new AgentBuilder(choice);
  const availability = await agent.availability();
  void workspaceId;
  if (availability.available) {
    return { builder: agent, requested, ran: "agent", fallbackReason: null };
  }

  return {
    builder: new ScaffoldBuilder(),
    requested,
    ran: "scaffold",
    fallbackReason: availability.reason,
  };
}

export { AgentBuilder, ScaffoldBuilder };
export type * from "./types";
