import "dotenv/config";

import { DEFAULT_ROUTING, AI_CAPABILITIES } from "../src/config/ai";
import { appConfig } from "../src/config/app";
import { prisma } from "../src/db/client";
import { createCampaign, runCampaign } from "../src/services/discovery";
import { analyseOpportunity } from "../src/services/opportunity";
import { draftOutreach } from "../src/services/outreach";

/**
 * Lead → Launch database seed.
 *
 * Purpose:
 * - Create the default workspace
 * - Create the development/demo owner
 * - Create default AI routing
 * - Create standard tags
 * - Populate demo discovery/prospect data
 * - Populate opportunity data
 * - Populate outreach drafts
 *
 * IMPORTANT:
 * Website generation is NEVER performed by the seed.
 *
 * Website generation is intentionally a manual user action:
 *
 * Prospect
 * → qualified sales stage
 * → Build Website
 * → choose provider/model
 * → confirm
 * → create build job
 *
 * The seed must never bypass that workflow.
 */

const TAGS = [
  { name: "High Value", color: "amber" },
  { name: "Fast Win", color: "emerald" },
  { name: "Needs Follow-up", color: "sky" },
  { name: "Premium", color: "violet" },
  { name: "No Website", color: "rose" },
];

async function main() {
  const slug = appConfig.defaultWorkspaceSlug;

  // ---------------------------------------------------------------------------
  // 1. DEFAULT WORKSPACE
  // ---------------------------------------------------------------------------

  const workspace = await prisma.workspace.upsert({
    where: { slug },
    create: {
      slug,
      name: "Studio",
    },
    update: {},
  });

  console.log(`Workspace ready: ${workspace.name}`);

  // ---------------------------------------------------------------------------
  // 2. DEVELOPMENT OWNER
  // ---------------------------------------------------------------------------

  await prisma.user.upsert({
    where: { email: "owner@example.com" },
    create: {
      email: "owner@example.com",
      name: "Studio Owner",
      role: "owner",
      workspaceId: workspace.id,
    },
    update: {
      workspaceId: workspace.id,
    },
  });

  console.log("Owner user ready.");

  // ---------------------------------------------------------------------------
  // 3. DEFAULT AI ROUTING
  // ---------------------------------------------------------------------------

  for (const capability of AI_CAPABILITIES) {
    const route = DEFAULT_ROUTING[capability];

    await prisma.aIProviderConfig.upsert({
      where: {
        workspaceId_capability: {
          workspaceId: workspace.id,
          capability,
        },
      },
      create: {
        workspaceId: workspace.id,
        capability,
        provider: route.provider,
        model: route.model,
        fallbackProvider: route.fallback?.provider ?? null,
        fallbackModel: route.fallback?.model ?? null,
      },
      update: {},
    });
  }

  console.log("AI routing configuration ready.");

  // ---------------------------------------------------------------------------
  // 4. DEFAULT TAGS
  // ---------------------------------------------------------------------------

  for (const tag of TAGS) {
    await prisma.tag.upsert({
      where: {
        workspaceId_name: {
          workspaceId: workspace.id,
          name: tag.name,
        },
      },
      create: {
        workspaceId: workspace.id,
        name: tag.name,
        color: tag.color,
      },
      update: {},
    });
  }

  console.log("Tags ready.");

  // ---------------------------------------------------------------------------
  // 5. AVOID DUPLICATING DEMO PROSPECTS
  // ---------------------------------------------------------------------------

  const existing = await prisma.prospect.count({
    where: {
      workspaceId: workspace.id,
    },
  });

  if (existing > 0) {
    console.log(
      `Workspace already has ${existing} prospects. Skipping demo campaigns.`,
    );

    const counts = await prisma.prospect.count({
      where: {
        workspaceId: workspace.id,
      },
    });

    console.log(
      `\nSeed complete: ${counts} prospects in workspace "${workspace.name}".`,
    );

    console.log(
      "No website builds were created by the seed. Website generation remains manual.",
    );

    return;
  }

  // ---------------------------------------------------------------------------
  // 6. DEMO DISCOVERY CAMPAIGNS
  // ---------------------------------------------------------------------------

  const campaigns = [
    {
      name: "Mumbai Dentists",
      category: "Dental",
      city: "Mumbai",
      area: "Bandra",
      count: 14,
    },
    {
      name: "Bandra Salons",
      category: "Salon & Spa",
      city: "Mumbai",
      area: "Bandra",
      count: 8,
    },
    {
      name: "Pune Interior Studios",
      category: "Interior Design",
      city: "Pune",
      area: "Koregaon Park",
      count: 8,
    },
  ];

  for (const c of campaigns) {
    const campaign = await createCampaign(workspace.id, {
      name: `${c.name} — demo`,
      category: c.category,
      country: "India",
      city: c.city,
      area: c.area,
      targetCount: c.count,
      websiteFilter: "any",
      autoAudit: true,
    });

    console.log(`Running campaign: ${campaign.name}`);

    const progress = await runCampaign(workspace.id, campaign.id, {
      autoAudit: true,
    });

    console.log(
      `  discovered ${progress.discovered}, duplicates ${progress.duplicates}, audited ${progress.audited}`,
    );
  }

  // ---------------------------------------------------------------------------
  // 7. OPPORTUNITY ANALYSIS + OUTREACH DRAFTS
  // ---------------------------------------------------------------------------

  /**
   * We still move the strongest demo prospects forward in the CRM so that
   * the dashboard demonstrates the sales workflow.
   *
   * IMPORTANT:
   * We do NOT create WebsiteProject / WebsiteBuild records here.
   *
   * The UI can therefore show prospects at:
   * - meeting-completed
   *
   * while still requiring the user to explicitly initiate:
   *
   * Build Website → Provider → Model → Quality → Confirm
   */

  const top = await prisma.prospect.findMany({
    where: {
      workspaceId: workspace.id,
    },
    orderBy: {
      opportunityScore: "desc",
    },
    take: 3,
    include: {
      business: true,
    },
  });

  for (const p of top) {
    console.log(
      `Advancing ${p.business.name} (${p.opportunityScore}/100)`,
    );

    try {
      // Analyse the opportunity.
      await analyseOpportunity(workspace.id, p.id);

      // Move the prospect to a realistic sales stage.
      await prisma.prospect.update({
        where: {
          id: p.id,
        },
        data: {
          stage: "meeting-completed",
          meetingAt: new Date(Date.now() - 86_400_000),
        },
      });

      // Create an outreach draft only.
      //
      // This does NOT send anything.
      // This does NOT build a website.
      await draftOutreach(
        workspace.id,
        p.id,
        p.business.email ? "email" : "whatsapp",
        "normal",
      );

      console.log(
        `  opportunity + outreach draft ready for ${p.business.name}`,
      );
    } catch (e) {
      console.warn(
        `  skipped a step: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 8. ADD OTHER PIPELINE STAGES
  // ---------------------------------------------------------------------------

  const others = await prisma.prospect.findMany({
    where: {
      workspaceId: workspace.id,
      id: {
        notIn: top.map((t) => t.id),
      },
    },
    orderBy: {
      opportunityScore: "desc",
    },
    take: 4,
  });

  const stages = [
    "contacted",
    "responded",
    "meeting-scheduled",
    "proposal",
  ];

  for (const [i, p] of others.entries()) {
    await prisma.prospect.update({
      where: {
        id: p.id,
      },
      data: {
        stage: stages[i % stages.length],
        lastContactAt: new Date(
          Date.now() - i * 86_400_000,
        ),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 9. SUMMARY
  // ---------------------------------------------------------------------------

  const counts = await prisma.prospect.count({
    where: {
      workspaceId: workspace.id,
    },
  });

  const buildCount = await prisma.websiteBuild.count({
    where: {
      project: {
        workspaceId: workspace.id,
      },
    },
  });

  console.log(
    `\nSeed complete: ${counts} prospects in workspace "${workspace.name}".`,
  );

  console.log(
    `Website builds created by seed: ${buildCount}.`,
  );

  console.log(
    "Website generation remains manually controlled and was not triggered by the seed.",
  );

  console.log(
    "All discovery data is mock and is labelled as such throughout the UI.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });