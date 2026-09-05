import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { auditProviderHealth } from "@/providers/audit";
import { aiProviderHealth } from "@/providers/ai/router";
import { businessDataHealth } from "@/providers/business-data";
import { deploymentProviderHealth } from "@/providers/deployment";
import { outreachProviderHealth } from "@/providers/outreach";
import { getSettings } from "@/services/settings";
import {
  ScoringWeightsForm,
  TagManager,
  WorkspacePreferencesForm,
} from "@/components/features/SettingsForm";
import {
  Badge,
  InfoNote,
  MockBadge,
  Panel,
  PanelHeader,
  PageHeader,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

type Health = {
  id: string;
  label: string;
  configured: boolean;
  isMock: boolean;
  setupHint: string;
};

function ProviderGroup({ title, hint, items }: { title: string; hint: string; items: Health[] }) {
  return (
    <Panel>
      <PanelHeader title={title} hint={hint} />
      <ul>
        {items.map((p) => (
          <li key={p.id} className="px-4 py-3 border-b border-line last:border-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[12.5px] font-medium text-ink">{p.label}</span>
              {p.isMock ? <MockBadge what="mock" /> : null}
              <Badge tone={p.configured ? "ok" : "neutral"} className="ml-auto">
                {p.configured ? "configured" : "not configured"}
              </Badge>
            </div>
            <p className="text-[11.5px] text-ink-3 leading-relaxed">{p.setupHint}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default async function SettingsPage() {
  const ctx = await getWorkspaceContext();
  const settings = await getSettings(ctx.workspaceId);
  const tags = await prisma.tag.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Provider status is read from environment variables. Nothing here stores a credential — keys never leave the server."
        meta={
          <>
            <Badge tone="neutral">Workspace: {ctx.workspaceName}</Badge>
            <Badge tone={appConfig.mode === "demo" ? "warn" : "ok"}>
              APP_MODE={appConfig.mode}
            </Badge>
            <Badge tone="neutral">Role: {ctx.role}</Badge>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <ScoringWeightsForm weights={settings.scoringWeights} />
          <WorkspacePreferencesForm
            costMode={settings.costMode}
            senderName={settings.senderName}
            senderRole={settings.senderRole}
            maxQaIterations={settings.maxQaIterations}
          />
          <TagManager tags={tags} />
        </div>

        <div className="flex flex-col gap-5">
          <ProviderGroup
            title="AI providers"
            hint="Routing per capability lives in the AI Control Center."
            items={aiProviderHealth()}
          />
          <ProviderGroup
            title="Business data"
            hint="Powers discovery and, when available, competitor lookups."
            items={businessDataHealth()}
          />
          <ProviderGroup
            title="Audit engines"
            hint="Selected per URL at audit time."
            items={auditProviderHealth()}
          />
          <ProviderGroup
            title="Deployment"
            hint="Generated sites are on disk regardless; these push them somewhere."
            items={deploymentProviderHealth()}
          />
          <ProviderGroup
            title="Outreach transports"
            hint="Channels without a sanctioned API stay manual by design."
            items={outreachProviderHealth()}
          />

          <Panel>
            <PanelHeader title="Data" hint="Where things live." />
            <dl className="px-4 py-3 text-[12px]">
              {[
                ["Database", process.env.DATABASE_URL?.startsWith("postgres") ? "PostgreSQL" : "SQLite (dev.db)"],
                ["Projects root", appConfig.studio.projectsRoot],
                ["Audit timeout", `${appConfig.audit.fetchTimeoutMs} ms`],
                ["Outreach rate limit", `${appConfig.outreach.rateLimitPerHour} per hour`],
                ["Max QA iterations", String(appConfig.studio.maxQaIterations)],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4 py-1.5 border-b border-line last:border-0">
                  <dt className="text-ink-3 w-40 shrink-0">{k}</dt>
                  <dd className="text-ink-2 font-mono text-[11.5px]">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <InfoNote>
            <strong className="font-semibold">Moving to PostgreSQL.</strong> Change{" "}
            <code>provider</code> to <code>&quot;postgresql&quot;</code> in{" "}
            <code>prisma/schema.prisma</code>, point <code>DATABASE_URL</code> at the cluster,
            install <code>@prisma/adapter-pg</code> and register it in <code>src/db/client.ts</code>,
            then run <code>npm run db:migrate</code>. The schema avoids Postgres-only types precisely
            so nothing else has to change.
          </InfoNote>
        </div>
      </div>
    </>
  );
}
