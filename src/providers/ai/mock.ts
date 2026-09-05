import type { AICapability } from "@/config/ai";
import { extractJson } from "@/lib/json";
import type { AIProvider, AIRequest, AIResponse } from "./types";

/**
 * Deterministic composer used when no AI credential is configured.
 *
 * This is explicitly NOT a simulated model. It performs no inference: every
 * agent passes a machine-readable <facts> block alongside its prompt, and this
 * provider rearranges those facts into the shape the caller expects. If a fact
 * is not in the block, it does not appear in the output - nothing is invented.
 *
 * Everything it produces is stamped isMock, and the UI labels it as composed
 * from stored data rather than reasoned about.
 */

export type MockFacts = Record<string, unknown>;

function facts(request: AIRequest): MockFacts {
  const last = request.messages.at(-1)?.content ?? "";
  const block = last.match(/<facts>([\s\S]*?)<\/facts>/);
  if (!block) return {};
  return extractJson<MockFacts>(block[1]) ?? {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Joins fragments mid-sentence, so a capitalised finding title reads correctly. */
function sentenceList(items: string[], max = 3): string {
  const take = items.slice(0, max).map((s) => s.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()));
  if (take.length === 0) return "";
  if (take.length === 1) return take[0];
  return `${take.slice(0, -1).join(", ")} and ${take.at(-1)}`;
}

// --------------------------------------------------------------- composers

function composeAnalysis(f: MockFacts): string {
  const name = str(f.businessName, "This business");
  const rating = num(f.rating);
  const reviews = num(f.reviewCount);
  const website = str(f.website);
  const overall = num(f.websiteScore);
  const findings = list(f.topFindings);
  const labels = list(f.labels);

  const reputationClause =
    rating != null && reviews != null
      ? `${name} holds ${rating} stars across ${reviews} reviews`
      : `${name} has limited public rating data on record`;

  const siteClause = website
    ? overall != null
      ? `its website scores ${overall}/100 in the stored audit`
      : "its website has not been audited yet"
    : "no website is on record";

  return JSON.stringify({
    whyThisLead: `${reputationClause}, and ${siteClause}.`,
    whatToPitch: findings.length
      ? `Lead with the specific gaps already recorded: ${sentenceList(findings)}.`
      : "Run an audit first - there are no recorded findings to pitch against yet.",
    whatNotToSay: [
      "Do not claim their current site is losing them a specific number of customers - that is not measured.",
      "Do not reference competitors unless a verified competitor record exists.",
      rating != null && rating < 4
        ? "Do not open with their reputation; the rating is not a strength here."
        : "Do not open with generic praise - reference the recorded detail instead.",
    ],
    openingLine: website
      ? `I looked at ${website} and noticed ${findings[0] ? findings[0].toLowerCase() : "a few things worth fixing"}.`
      : `I could not find a website for ${name}, only the map listing.`,
    biggestProblem: findings[0] ?? (website ? "Not yet assessed." : "There is no website at all."),
    suggestedSolution: website
      ? "A focused rebuild that fixes the recorded findings and puts the primary action in reach on mobile."
      : "A small, fast site: services, proof, location and one obvious way to get in touch.",
    estimatedScope: str(f.estimatedScope, "To be set once the brief is approved."),
    suggestedPricing: {
      low: num(f.valueLow) ?? 0,
      high: num(f.valueHigh) ?? 0,
      currency: str(f.currency, "INR"),
      rationale: "Derived from the industry value band and review volume in the scoring config.",
    },
    recommendedChannel: str(f.recommendedChannel, "email"),
    groundedIn: [
      ...(rating != null ? [`Rating ${rating} from ${reviews ?? "unknown"} reviews`] : []),
      ...(website ? [`Website on record: ${website}`] : ["No website on record"]),
      ...findings.slice(0, 4),
      ...labels,
    ],
    _composedBy: "deterministic mock composer - no inference performed",
  });
}

function composeCopy(f: MockFacts): string {
  const name = str(f.businessName, "there");
  const contact = str(f.contactName) || name;
  const channel = str(f.channel, "email");
  const variant = str(f.variant, "normal");
  const observations = list(f.observations);
  const sender = str(f.senderName, "");
  const website = str(f.website);

  // Observations are stored as complete sentences; they are being spliced into
  // the middle of one here, so drop the capital and the full stop.
  const midSentence = (text: string) =>
    text.replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/\.\s*$/, "");

  const trade = `${str(f.category, "local").toLowerCase()} businesses`;

  const opener = observations[0]
    ? `I had a look at ${website || "your listing"} and noticed ${midSentence(observations[0])}`
    : `I came across ${name} while looking at ${trade} in ${str(f.area, str(f.city, "the area"))}`;

  const detail =
    observations.length > 1
      ? `\n\nA couple of other things stood out:\n${observations
          .slice(1, 4)
          .map((o) => `• ${o}`)
          .join("\n")}`
      : "";

  const bodies: Record<string, string> = {
    short: `Hi ${contact},\n\n${opener}.\n\nI build sites for ${trade} and could show you what a fix looks like. Worth a short call?\n\n${sender}`,
    normal: `Hi ${contact},\n\n${opener}.${detail}\n\nI work with ${trade} in ${str(f.city, "the area")} on exactly this. I can put together a version of your homepage so you can see the difference rather than take my word for it - no obligation either way.\n\nWould a ten-minute call this week suit?\n\n${sender}`,
    detailed: `Hi ${contact},\n\n${opener}.${detail}\n\nWhy it matters: ${str(f.impactSummary, "each of these sits between someone finding you and getting in touch")}.\n\nWhat I would do: ${str(f.solutionSummary, "rebuild the pages that matter, mobile first, with one obvious next step on every screen")}.\n\nI am happy to build a sample of the homepage first so you can judge it properly. If it is not better than what you have, we stop there.\n\n${sender}`,
    followup1: `Hi ${contact},\n\nFollowing up on my note about ${website || name}. The point that stood out most was ${observations[0] ? midSentence(observations[0]) : "the mobile experience"}.\n\nStill happy to put a sample together if it is useful.\n\n${sender}`,
    followup2: `Hi ${contact},\n\nI expect this is not the priority this month. If it becomes one, the notes I made on ${website || "your listing"} are yours either way - just reply and I will send them over.\n\n${sender}`,
    final: `Hi ${contact},\n\nLast note from me so I am not cluttering your inbox. If a website rebuild comes up later this year, I am around.\n\nAll the best,\n${sender}`,
  };

  // Subjects are truncated on a word boundary, never mid-word.
  const clipWords = (text: string, max: number) =>
    text.length <= max ? text : `${text.slice(0, text.lastIndexOf(" ", max))}…`;

  const subjects: Record<string, string> = {
    short: `Quick note about ${name}'s website`,
    normal: observations[0]
      ? `${name}: ${clipWords(midSentence(observations[0]), 48)}`
      : `A note about ${name}'s website`,
    detailed: `${name} - what I noticed on your site`,
    followup1: `Re: ${name}'s website`,
    followup2: `Re: ${name}'s website`,
    final: `Closing the loop`,
  };

  return JSON.stringify({
    subject: channel === "email" ? (subjects[variant] ?? subjects.normal) : null,
    body: bodies[variant] ?? bodies.normal,
    observations,
    _composedBy: "deterministic mock composer - assembled from stored observations only",
  });
}

function composePlanning(f: MockFacts): string {
  const name = str(f.businessName, "The business");
  const category = str(f.category, "local business");
  const area = str(f.area, str(f.city, "the area"));
  const pages = list(f.corePages);
  const trust = list(f.trustElements);
  const goal = str(f.primaryConversion, "Make an enquiry");
  const services = list(f.services);
  const unknowns = list(f.unknowns);

  return JSON.stringify({
    positioning: `${name}: an established ${category.toLowerCase()} in ${area}, positioned on ${str(f.positioningAngle, "proven local reputation")}.`,
    targetAudience: `People searching for a ${category.toLowerCase()} near ${area}, mostly on a phone, mostly ready to act today.`,
    primaryGoal: goal,
    secondaryGoals: list(f.secondaryConversions),
    brandPersonality: ["Direct", "Competent", "Local", "Unfussy"],
    colorDirection:
      "One confident brand colour used sparingly for actions, on a warm neutral ground. No gradients.",
    typographyDirection:
      "A single well-set family: large, tight headings and comfortable 16-18px body text with generous line height.",
    designStyle:
      "Editorial rather than templated. Real photography of the actual premises, asymmetric section rhythm, restrained motion.",
    pages: (pages.length ? pages : ["Home", "Services", "Contact"]).map((p) => ({
      name: p,
      purpose:
        p === "Home"
          ? "Answer who, what, where and how to book within one screen."
          : p === "Contact"
            ? "Remove every obstacle between intent and contact."
            : `Explain ${p.toLowerCase()} in the customer's language.`,
      sections: p === "Home" ? ["Hero with primary action", "Services", "Proof", "Location", "Contact"] : ["Intro", "Detail", "Next step"],
    })),
    ctaStrategy: `"${goal}" appears in the header, at the end of every section, and as a persistent bar on mobile.`,
    trustElements: trust,
    socialProof: str(f.socialProof, "Review excerpts, quoted verbatim and attributed."),
    contentStrategy: services.length
      ? `Write real copy for: ${sentenceList(services, 5)}. No filler paragraphs.`
      : "Write real service copy - what is done, who it suits, how long it takes.",
    seoStrategy: `Locality plus service in titles and H1s, LocalBusiness structured data, one page per service.`,
    animationDirection: "Motion only where it clarifies: section reveal on scroll, nothing decorative.",
    mobileStrategy: "Designed at 375px first. Tap-to-call in the header at every breakpoint.",
    requiresClientInput: unknowns.length
      ? unknowns
      : ["Current pricing", "Photography of the premises", "Practitioner credentials"],
    generatedBy: "mock:deterministic-composer",
    _composedBy: "deterministic mock composer - industry priors plus stored business data",
  });
}

function composeVision(f: MockFacts): string {
  return JSON.stringify({
    issues: list(f.detectedIssues),
    verdict: list(f.detectedIssues).length === 0 ? "pass" : "needs-work",
    note: "Composed from the automated checks. No image was analysed - configure a vision-capable provider for a real visual review.",
    _composedBy: "deterministic mock composer",
  });
}

function composeGeneric(f: MockFacts, capability: AICapability): string {
  return JSON.stringify({
    capability,
    summary:
      "This output was composed from stored data because no AI provider is configured for this capability.",
    facts: f,
    _composedBy: "deterministic mock composer",
  });
}

export class MockAIProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly label = "Deterministic composer (no AI key)";
  readonly isMock = true;

  isConfigured(): boolean {
    return true;
  }

  supports(): boolean {
    return true;
  }

  async complete(model: string, request: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    const f = facts(request);

    let text: string;
    switch (request.capability) {
      case "analysis":
        text = composeAnalysis(f);
        break;
      case "copywriting":
        text = composeCopy(f);
        break;
      case "websitePlanning":
        text = composePlanning(f);
        break;
      case "vision":
        text = composeVision(f);
        break;
      case "codeGeneration":
      case "codeReview":
        // Deliberately refuses rather than emitting plausible-looking code.
        text = JSON.stringify({
          error: "not-available",
          message:
            "Code generation requires a real AI provider. The Website Studio falls back to its built-in scaffolder, which produces a genuine runnable project without claiming an agent wrote it.",
          _composedBy: "deterministic mock composer",
        });
        break;
      default:
        text = composeGeneric(f, request.capability);
    }

    return {
      text,
      provider: this.id,
      model,
      isMock: true,
      tokensIn: null,
      tokensOut: null,
      costUsd: 0,
      durationMs: Date.now() - started,
    };
  }
}
