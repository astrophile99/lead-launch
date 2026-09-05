import "dotenv/config";
import { DEFAULT_ROUTING, AI_CAPABILITIES } from "../src/config/ai";
import { appConfig } from "../src/config/app";
import { prisma } from "../src/db/client";
import { createCampaign, runCampaign } from "../src/services/discovery";
import { analyseOpportunity } from "../src/services/opportunity";
import { draftOutreach } from "../src/services/outreach";
import { generateBrief } from "../src/services/website-brief";
import { startBuild } from "../src/services/website-projects";

/**
 * Seeds the default workspace and, in demo mode, runs the *real* pipeline
 * against the mock discovery provider - the same code paths the UI triggers.
 * Nothing here writes fabricated audit results or fake analytics; every row is
 * produced by the services under test.
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

  const workspace = await prisma.workspace.upsert({
    where: { slug },
    create: { slug, name: "Studio" },
    update: {},
  });

  await prisma.user.upsert({
    where: { email: "owner@example.com" },
    create: {
      email: "owner@example.com",
      name: "Studio Owner",
      role: "owner",
      workspaceId: workspace.id,
    },
    update: { workspaceId: workspace.id },
  });

  for (const capability of AI_CAPABILITIES) {
    const route = DEFAULT_ROUTING[capability];
    await prisma.aIProviderConfig.upsert({
      where: { workspaceId_capability: { workspaceId: workspace.id, capability } },
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

  for (const tag of TAGS) {
    await prisma.tag.upsert({
      where: { workspaceId_name: { workspaceId: workspace.id, name: tag.name } },
      create: { workspaceId: workspace.id, name: tag.name, color: tag.color },
      update: {},
    });
  }

  const existing = await prisma.prospect.count({ where: { workspaceId: workspace.id } });
  if (existing > 0) {
    console.log(`Workspace already has ${existing} prospects. Skipping demo campaigns.`);
    return;
  }

  const campaigns = [
    { name: "Mumbai Dentists", category: "Dental", city: "Mumbai", area: "Bandra", count: 14 },
    { name: "Bandra Salons", category: "Salon & Spa", city: "Mumbai", area: "Bandra", count: 8 },
    { name: "Pune Interior Studios", category: "Interior Design", city: "Pune", area: "Koregaon Park", count: 8 },
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
    const progress = await runCampaign(workspace.id, campaign.id, { autoAudit: true });
    console.log(
      `  discovered ${progress.discovered}, duplicates ${progress.duplicates}, audited ${progress.audited}`,
    );
  }

  // Take the three strongest prospects the whole way through, so the demo has
  // real briefs, real builds and real drafts to look at.
  const top = await prisma.prospect.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { opportunityScore: "desc" },
    take: 3,
    include: { business: true },
  });

  for (const p of top) {
    console.log(`Advancing ${p.business.name} (${p.opportunityScore}/100)`);
    try {
      await analyseOpportunity(workspace.id, p.id);
      const { project } = await generateBrief(workspace.id, p.id);
      await startBuild(workspace.id, project.id);
      await draftOutreach(workspace.id, p.id, p.business.email ? "email" : "whatsapp", "normal");
    } catch (e) {
      console.warn(`  skipped a step: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // A couple of prospects further along the pipeline so the board is not empty.
  const others = await prisma.prospect.findMany({
    where: { workspaceId: workspace.id, id: { notIn: top.map((t) => t.id) } },
    orderBy: { opportunityScore: "desc" },
    take: 4,
  });
  const stages = ["contacted", "follow-up", "meeting", "proposal"];
  for (const [i, p] of others.entries()) {
    await prisma.prospect.update({
      where: { id: p.id },
      data: { stage: stages[i % stages.length], lastContactAt: new Date(Date.now() - i * 86_400_000) },
    });
  }

  const counts = await prisma.prospect.count({ where: { workspaceId: workspace.id } });
  console.log(`\nSeed complete: ${counts} prospects in workspace "${workspace.name}".`);
  console.log("All discovery data is mock and is labelled as such throughout the UI.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
