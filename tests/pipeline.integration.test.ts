import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end integration test.
 *
 * Runs the real services - discovery, de-duplication, audit, scoring, sales
 * angle, brief, build, quality gate, outreach, pipeline - against a temporary
 * SQLite database created by a real Prisma migration. Nothing is stubbed except
 * the external providers, which are the mock implementations the app ships with.
 */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leadlaunch-test-"));
const dbFile = path.join(tmpRoot, "test.db");
const projectsRoot = path.join(tmpRoot, "projects");

process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
process.env.APP_MODE = "demo";
process.env.DEFAULT_WORKSPACE_SLUG = "test-studio";
process.env.PROJECTS_ROOT = projectsRoot;

type Services = {
  prisma: typeof import("@/db/client").prisma;
  createCampaign: typeof import("@/services/discovery").createCampaign;
  runCampaign: typeof import("@/services/discovery").runCampaign;
  auditProspect: typeof import("@/services/audit").auditProspect;
  latestAudit: typeof import("@/services/audit").latestAudit;
  analyseOpportunity: typeof import("@/services/opportunity").analyseOpportunity;
  latestOpportunity: typeof import("@/services/opportunity").latestOpportunity;
  generateBrief: typeof import("@/services/website-brief").generateBrief;
  startBuild: typeof import("@/services/website-projects").startBuild;
  draftOutreach: typeof import("@/services/outreach").draftOutreach;
  approveMessage: typeof import("@/services/outreach").approveMessage;
  sendMessage: typeof import("@/services/outreach").sendMessage;
  optOut: typeof import("@/services/outreach").optOut;
  getOverview: typeof import("@/services/analytics").getOverview;
  getFunnel: typeof import("@/services/analytics").getFunnel;
};

let s: Services;
let workspaceId: string;

beforeAll(async () => {
  // Apply the committed migration SQL directly rather than shelling out to the
  // Prisma CLI: the test then exercises exactly the schema that ships, with no
  // dependency on the CLI being able to run in this environment.
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const migrations = fs
    .readdirSync(migrationsDir)
    .filter((d) => fs.existsSync(path.join(migrationsDir, d, "migration.sql")))
    .sort();
  expect(migrations.length).toBeGreaterThan(0);

  const { default: Database } = await import("better-sqlite3");
  const sqlite = new Database(dbFile);
  for (const migration of migrations) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8"));
  }
  sqlite.close();

  const [db, discovery, audit, opportunity, brief, projects, outreach, analytics] =
    await Promise.all([
      import("@/db/client"),
      import("@/services/discovery"),
      import("@/services/audit"),
      import("@/services/opportunity"),
      import("@/services/website-brief"),
      import("@/services/website-projects"),
      import("@/services/outreach"),
      import("@/services/analytics"),
    ]);

  s = {
    prisma: db.prisma,
    createCampaign: discovery.createCampaign,
    runCampaign: discovery.runCampaign,
    auditProspect: audit.auditProspect,
    latestAudit: audit.latestAudit,
    analyseOpportunity: opportunity.analyseOpportunity,
    latestOpportunity: opportunity.latestOpportunity,
    generateBrief: brief.generateBrief,
    startBuild: projects.startBuild,
    draftOutreach: outreach.draftOutreach,
    approveMessage: outreach.approveMessage,
    sendMessage: outreach.sendMessage,
    optOut: outreach.optOut,
    getOverview: analytics.getOverview,
    getFunnel: analytics.getFunnel,
  };

  const workspace = await s.prisma.workspace.create({
    data: { slug: "test-studio", name: "Test Studio" },
  });
  workspaceId = workspace.id;
  await s.prisma.user.create({
    data: { email: "t@example.com", name: "Tester", workspaceId },
  });
});

afterAll(async () => {
  await s?.prisma.$disconnect();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const QUERY = {
  name: "Test Dentists",
  category: "Dental",
  country: "India",
  city: "Mumbai",
  area: "Bandra",
  targetCount: 8,
  websiteFilter: "any" as const,
  autoAudit: false,
};

describe("discovery", () => {
  let campaignId: string;

  it("records only work that actually happened", async () => {
    const campaign = await s.createCampaign(workspaceId, QUERY);
    campaignId = campaign.id;
    expect(campaign.status).toBe("draft");
    expect(campaign.isMock).toBe(true);

    const progress = await s.runCampaign(workspaceId, campaignId, { autoAudit: false });
    expect(progress.status).toBe("completed");
    expect(progress.discovered).toBe(8);
    expect(progress.audited).toBe(0);

    const prospects = await s.prisma.prospect.count({ where: { workspaceId } });
    expect(prospects).toBe(8);
  });

  it("creates a prospect and an activity entry per business", async () => {
    const activities = await s.prisma.activity.count({
      where: { workspaceId, type: "prospect.discovered" },
    });
    expect(activities).toBeGreaterThanOrEqual(8);
  });

  it("skips businesses it already has and pages on for new ones", async () => {
    // Rerunning the same query is how you top up a list, so the runner pages
    // past what it already holds rather than stopping. The guarantee is that
    // nothing is stored twice, not that a rerun finds nothing.
    const before = await s.prisma.business.count({ where: { workspaceId } });
    const again = await s.createCampaign(workspaceId, QUERY);
    const progress = await s.runCampaign(workspaceId, again.id, { autoAudit: false });

    expect(progress.duplicates).toBeGreaterThanOrEqual(before);
    const after = await s.prisma.business.count({ where: { workspaceId } });
    expect(after).toBe(before + progress.discovered);
  });

  it("never stores the same business twice", async () => {
    const businesses = await s.prisma.business.findMany({
      where: { workspaceId },
      select: { dedupeKey: true },
    });
    expect(new Set(businesses.map((b) => b.dedupeKey)).size).toBe(businesses.length);
  });

  it("refuses an out-of-range target", async () => {
    await expect(s.createCampaign(workspaceId, { ...QUERY, targetCount: 0 })).rejects.toThrow(
      /between 1 and 200/,
    );
  });

  it("marks every discovered record as demo data", async () => {
    const real = await s.prisma.business.count({ where: { workspaceId, isMock: false } });
    expect(real).toBe(0);
  });
});

describe("audit and scoring", () => {
  it("audits every prospect and scores each one", async () => {
    const prospects = await s.prisma.prospect.findMany({ where: { workspaceId } });
    for (const p of prospects) {
      const result = await s.auditProspect(workspaceId, p.id);
      expect(result.status).toBe("complete");
    }

    const scored = await s.prisma.prospect.findMany({
      where: { workspaceId },
      select: { opportunityScore: true, websiteScore: true, contactabilityScore: true, estimatedValue: true },
    });
    for (const p of scored) {
      expect(p.opportunityScore).not.toBeNull();
      expect(p.websiteScore).not.toBeNull();
      expect(p.contactabilityScore).not.toBeNull();
      expect(p.estimatedValue).toBeGreaterThan(0);
      expect(p.opportunityScore!).toBeGreaterThanOrEqual(0);
      expect(p.opportunityScore!).toBeLessThanOrEqual(100);
    }
  });

  it("records findings that explain the score", async () => {
    const audit = await s.prisma.websiteAudit.findFirst({
      where: { prospect: { workspaceId }, status: "complete", url: { not: null } },
      include: { findings: true },
    });
    expect(audit).not.toBeNull();
    expect(audit!.findings.length).toBeGreaterThan(0);
    for (const f of audit!.findings) {
      expect(f.whatIsWrong).toBeTruthy();
      expect(f.whyItMatters).toBeTruthy();
      expect(f.recommendation).toBeTruthy();
      expect(["low", "medium", "high"]).toContain(f.effort);
      expect(["low", "medium", "high"]).toContain(f.impact);
    }
  });

  it("scores a business with no website at zero and says why", async () => {
    const noSite = await s.prisma.prospect.findFirst({
      where: { workspaceId, business: { website: null } },
    });
    if (!noSite) return; // the seeded query may not produce one
    expect(noSite.websiteScore).toBe(0);
    const audit = await s.latestAudit(noSite.id);
    expect(audit!.engine).toBe("no-website");
    expect(audit!.findings.some((f) => /no website/i.test(f.title))).toBe(true);
  });

  it("advances the stage to audited", async () => {
    const stages = await s.prisma.prospect.groupBy({
      by: ["stage"],
      where: { workspaceId },
      _count: { _all: true },
    });
    expect(stages.some((x) => x.stage === "audited")).toBe(true);
  });

  it("creates a suggested next action for every prospect", async () => {
    const withoutTask = await s.prisma.prospect.count({
      where: { workspaceId, tasks: { none: { status: "open" } } },
    });
    expect(withoutTask).toBe(0);
  });
});

describe("AI layer", () => {
  it("records every call as a job, with the mock provider labelled", async () => {
    const p = await s.prisma.prospect.findFirst({
      where: { workspaceId },
      orderBy: { opportunityScore: "desc" },
    });
    const result = await s.analyseOpportunity(workspaceId, p!.id);
    expect(result.isMock).toBe(true);

    const job = await s.prisma.aIJob.findUnique({ where: { id: result.jobId } });
    expect(job!.status).toBe("complete");
    expect(job!.isMock).toBe(true);
    expect(job!.provider).toBe("mock");
    expect(job!.outputJson).toBeTruthy();
  });

  it("grounds the sales angle in facts that exist in the database", async () => {
    const p = await s.prisma.prospect.findFirst({
      where: { workspaceId },
      orderBy: { opportunityScore: "desc" },
      include: { business: true },
    });
    const opportunity = await s.latestOpportunity(p!.id);
    expect(opportunity!.salesAngle).not.toBeNull();
    expect(opportunity!.salesAngle!.whyThisLead).toContain(p!.business.name);
    expect(opportunity!.salesAngle!.groundedIn.length).toBeGreaterThan(0);
  });
});

describe("website studio", () => {
  let projectId: string;

  it("produces a brief that lists what it does not know", async () => {
    const p = await s.prisma.prospect.findFirst({
      where: { workspaceId },
      orderBy: { opportunityScore: "desc" },
    });
    const { project, brief } = await s.generateBrief(workspaceId, p!.id);
    projectId = project.id;
    expect(brief.pages.length).toBeGreaterThan(0);
    expect(brief.requiresClientInput.length).toBeGreaterThan(0);
    expect(brief.generatedBy).toContain("mock");
  });

  it("builds a real project on disk and versions it", async () => {
    const result = await s.startBuild(workspaceId, projectId);
    expect(result.version).toBe(1);
    expect(result.qualityScore).toBeGreaterThan(80);

    const project = await s.prisma.websiteProject.findUnique({ where: { id: projectId } });
    const index = path.join(project!.path, "index.html");
    expect(fs.existsSync(index)).toBe(true);
    const html = fs.readFileSync(index, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('name="viewport"');

    // The version archive exists so a regression can be rolled back.
    expect(fs.existsSync(path.join(project!.path, ".versions", "v1", "index.html"))).toBe(true);
  });

  it("produces a second version rather than overwriting the first", async () => {
    const result = await s.startBuild(workspaceId, projectId);
    expect(result.version).toBe(2);
    const versions = await s.prisma.websiteVersion.count({ where: { projectId } });
    expect(versions).toBe(2);
  });

  it("records a quality report with skipped checks reported honestly", async () => {
    const version = await s.prisma.websiteVersion.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    const report = JSON.parse(version!.reportJson!);
    expect(report.checks.length).toBeGreaterThan(20);
    expect(report.checks.some((c: { status: string }) => c.status === "skipped")).toBe(true);
  });

  it("refuses to build a project that has no brief", async () => {
    const other = await s.prisma.prospect.findFirst({
      where: { workspaceId, projects: { none: {} } },
    });
    const bare = await s.prisma.websiteProject.create({
      data: {
        workspaceId,
        prospectId: other!.id,
        slug: `bare-${Date.now()}`,
        path: path.join(projectsRoot, "bare"),
      },
    });
    await expect(s.startBuild(workspaceId, bare.id)).rejects.toThrow(/brief/i);
  });
});

describe("outreach", () => {
  let messageId: string;
  let prospectId: string;

  it("writes only from recorded observations", async () => {
    const p = await s.prisma.prospect.findFirst({
      where: { workspaceId, business: { website: { not: null } } },
      orderBy: { opportunityScore: "desc" },
    });
    prospectId = p!.id;
    const { message, isMock } = await s.draftOutreach(workspaceId, prospectId, "email", "normal");
    messageId = message.id;
    expect(isMock).toBe(true);
    expect(message.status).toBe("draft");
    const observations = JSON.parse(message.observationsJson ?? "[]");
    expect(observations.length).toBeGreaterThan(0);
  });

  it("will not send a message that has not been approved", async () => {
    await expect(s.sendMessage(workspaceId, messageId)).rejects.toThrow(/approved/i);
  });

  it("will not transmit when no transport is configured", async () => {
    await s.approveMessage(workspaceId, messageId);
    const approved = await s.prisma.outreachMessage.findUnique({ where: { id: messageId } });
    expect(approved!.status).toBe("approved");
    // No RESEND_API_KEY in the test environment, so nothing may be sent.
    await expect(s.sendMessage(workspaceId, messageId)).rejects.toThrow(
      /no email transport is configured/i,
    );
    const after = await s.prisma.outreachMessage.findUnique({ where: { id: messageId } });
    expect(after!.status).toBe("approved");
    expect(after!.sentAt).toBeNull();
  });

  it("withdraws outstanding drafts when a prospect opts out", async () => {
    await s.draftOutreach(workspaceId, prospectId, "whatsapp", "short");
    await s.optOut(workspaceId, prospectId);
    const remaining = await s.prisma.outreachMessage.count({
      where: { prospectId, status: { in: ["draft", "approved"] } },
    });
    expect(remaining).toBe(0);
    const p = await s.prisma.prospect.findUnique({ where: { id: prospectId } });
    expect(p!.stage).toBe("not-interested");
  });

  it("refuses to write about a website nobody has looked at", async () => {
    // A business with a site but no audit yields no grounded observations, so
    // there is nothing honest to say and the draft must be refused. (A business
    // with no site at all is different: its absence is itself an observation.)
    const fresh = await s.prisma.business.create({
      data: {
        workspaceId,
        name: "Unaudited Clinic",
        category: "Dental",
        city: "Mumbai",
        website: "https://unaudited.example/",
        source: "test",
        dedupeKey: `nm:unaudited-${Date.now()}`,
      },
    });
    const p = await s.prisma.prospect.create({
      data: { workspaceId, businessId: fresh.id },
    });
    await expect(s.draftOutreach(workspaceId, p.id, "email", "normal")).rejects.toThrow(
      /observations/i,
    );
  });
});

describe("analytics", () => {
  it("reports counts that match the stored rows", async () => {
    const overview = await s.getOverview(workspaceId);
    const prospects = await s.prisma.prospect.count({ where: { workspaceId } });
    const audits = await s.prisma.websiteAudit.count({
      where: { prospect: { workspaceId }, status: "complete" },
    });

    expect(overview.totalProspects).toBe(prospects);
    expect(overview.websitesAudited).toBe(audits);
    expect(overview.mockProspects).toBe(prospects);
    // Nothing was ever transmitted, so this must be zero.
    expect(overview.outreachSent).toBe(0);
    expect(overview.replies).toBe(0);
  });

  it("builds a funnel that never widens as it descends", async () => {
    const funnel = await s.getFunnel(workspaceId);
    for (let i = 1; i < funnel.length; i++) {
      expect(funnel[i].count).toBeLessThanOrEqual(funnel[i - 1].count);
    }
  });
});

describe("workspace isolation", () => {
  it("does not leak rows between workspaces", async () => {
    const other = await s.prisma.workspace.create({
      data: { slug: `other-${Date.now()}`, name: "Other" },
    });
    const p = await s.prisma.prospect.findFirst({ where: { workspaceId } });

    await expect(s.auditProspect(other.id, p!.id)).rejects.toThrow(/not found/i);
    await expect(s.analyseOpportunity(other.id, p!.id)).rejects.toThrow(/not found/i);
    await expect(s.generateBrief(other.id, p!.id)).rejects.toThrow(/not found/i);
    expect(await s.getOverview(other.id)).toMatchObject({ totalProspects: 0 });
  });
});
