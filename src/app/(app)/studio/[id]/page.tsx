import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatDateTime, hostOf, relativeTime } from "@/lib/utils";
import { getDeploymentProvider } from "@/providers/deployment";
import type { QualityCheck, QualityReport, WebsiteBrief } from "@/types";
import { QueryTabs } from "@/components/ui/Tabs";
import {
  Badge,
  EmptyState,
  InfoNote,
  Meter,
  Panel,
  PanelHeader,
  PageHeader,
  ScoreBadge,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { BuildTimeline, parseBuildLog } from "@/components/features/BuildTimeline";
import { SitePreview } from "@/components/features/SitePreview";
import {
  BriefEditor,
  DeployControls,
  RestoreVersionButton,
} from "@/components/features/StudioActions";
import { BuildWebsiteButton } from "@/components/features/BuildWizard";
import { VersionList, type VersionRow } from "@/components/features/VersionReview";
import { buildGateFor, normaliseStage } from "@/config/pipeline";

export const dynamic = "force-dynamic";

const CHECK_TONE = { pass: "ok", warn: "warn", fail: "danger", skipped: "neutral" } as const;

const GROUP_LABEL: Record<QualityCheck["group"], string> = {
  build: "Build",
  responsive: "Responsive",
  ux: "UX",
  accessibility: "Accessibility",
  performance: "Performance",
  seo: "SEO",
  visual: "Visual",
};

export default async function StudioProjectPage({
  params,
  searchParams,
}: PageProps<"/studio/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "preview";
  const { workspaceId } = await getWorkspaceContext();

  const project = await prisma.websiteProject.findFirst({
    where: { id, workspaceId },
    include: {
      prospect: { include: { business: true } },
      versions: { orderBy: { version: "desc" } },
      builds: { orderBy: { startedAt: "desc" }, take: 12 },
      deployments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) notFound();

  const brief = fromJson<WebsiteBrief | null>(project.briefJson, null);
  const latest = project.versions[0] ?? null;
  const report = latest ? fromJson<QualityReport | null>(latest.reportJson, null) : null;
  const deployment = getDeploymentProvider();
  const before = project.prospect.websiteScore;
  const after = latest?.qualityScore ?? null;
  const stage = normaliseStage(project.prospect.stage);
  const gate = buildGateFor(stage);

  const versionRows: VersionRow[] = project.versions.map((v) => ({
    id: v.id,
    version: v.version,
    createdAt: v.createdAt.toISOString(),
    provider: v.provider,
    model: v.model,
    strategy: v.strategy,
    quality: v.quality,
    qualityScore: v.qualityScore,
    approval: v.approval,
    approvedAt: v.approvedAt?.toISOString() ?? null,
    reviewNote: v.reviewNote,
    changes: fromJson<string[]>(v.changesJson, []),
    fileCount: fromJson<{ path: string }[]>(v.filesJson, []).length,
    tokensIn: v.tokensIn,
    tokensOut: v.tokensOut,
    costUsd: v.costUsd,
    durationMs: v.durationMs,
    hasReadme: Boolean(v.readmeText),
  }));

  const tabs = [
    { id: "preview", label: "Preview" },
    { id: "brief", label: "Brief" },
    { id: "quality", label: "Quality gate", count: report?.checks.length },
    { id: "versions", label: "Versions", count: project.versions.length },
    { id: "readme", label: "README" },
    { id: "builds", label: "Build log", count: project.builds.length },
    { id: "deploy", label: "Deployment", count: project.deployments.length },
    { id: "handoff", label: "Handoff" },
  ];

  const base = `/studio/${project.id}`;

  return (
    <>
      <PageHeader
        title={project.prospect.business.name}
        description={`Website project · ${project.stack} · ${project.slug}`}
        meta={
          <>
            <Badge tone={project.status === "ready" || project.status === "deployed" ? "ok" : "neutral"}>
              {project.status}
            </Badge>
            <Link
              href={`/prospects/${project.prospectId}`}
              className="text-[12px] text-accent hover:underline underline-offset-2"
            >
              Open prospect
            </Link>
            {latest ? (
              <span className="text-[12px] text-ink-3">
                v{latest.version} built {relativeTime(latest.createdAt)}
              </span>
            ) : null}
          </>
        }
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <BuildWebsiteButton
              projectId={project.id}
              hasVersions={project.versions.length > 0}
            />
            <p className="text-[11px] text-ink-4 text-right max-w-64">
              {gate.requiresOverride
                ? "You will be asked to confirm building outside a meeting stage."
                : "Opens the build dialog. Nothing runs until you confirm."}
            </p>
          </div>
        }
      />

      {before != null || after != null ? (
        <div className="grid gap-2.5 grid-cols-2 md:grid-cols-4 mb-5">
          <Panel className="px-3.5 py-3">
            <p className="label">Before — current site</p>
            <ScoreBadge score={before} size="lg" />
            <p className="mt-1 text-[11.5px] text-ink-3">
              {project.prospect.business.website ? hostOf(project.prospect.business.website) : "no website"}
            </p>
          </Panel>
          <Panel className="px-3.5 py-3">
            <p className="label">After — build quality</p>
            <ScoreBadge score={after} size="lg" />
            <p className="mt-1 text-[11.5px] text-ink-3">Quality gate score</p>
          </Panel>
          <Panel className="px-3.5 py-3">
            <p className="label">Change</p>
            <p className="tabular mt-1.5 text-[26px] font-semibold leading-none text-ok">
              {before != null && after != null ? `+${after - before}` : "—"}
            </p>
            <p className="mt-1.5 text-[11.5px] text-ink-3">Points, on comparable checks</p>
          </Panel>
          <Panel className="px-3.5 py-3">
            <p className="label">Outstanding issues</p>
            <p className="tabular mt-1.5 text-[26px] font-semibold leading-none">
              {report?.remainingIssues.length ?? 0}
            </p>
            <p className="mt-1.5 text-[11.5px] text-ink-3">Failing checks in the latest build</p>
          </Panel>
        </div>
      ) : null}

      <QueryTabs basePath={base} current={tab} tabs={tabs} />

      <div className="mt-5">
        {tab === "preview" ? (
          latest ? (
            <SitePreview
              slug={project.slug}
              compareUrl={project.prospect.business.website}
              title={project.prospect.business.name}
            />
          ) : (
            <Panel>
              <EmptyState
                title="Nothing built yet"
                body="Review the brief, then run a build. The preview loads the real generated files from the project directory."
              />
            </Panel>
          )
        ) : null}

        {tab === "brief" ? (
          brief ? (
            <BriefEditor projectId={project.id} brief={brief} />
          ) : (
            <Panel>
              <EmptyState title="No brief" body="Generate a website concept from the prospect page." />
            </Panel>
          )
        ) : null}

        {tab === "quality" ? (
          <Panel>
            <PanelHeader
              title="Quality gate"
              hint="Static assertions against the generated output. Checks that need a browser are reported as skipped, never as passed."
              actions={<ScoreBadge score={report?.score ?? null} size="lg" />}
            />
            {!report ? (
              <EmptyState title="No report" body="Run a build to produce a quality report." />
            ) : (
              <div className="px-4 py-3">
                {(Object.keys(GROUP_LABEL) as QualityCheck["group"][]).map((group) => {
                  const checks = report.checks.filter((c) => c.group === group);
                  if (!checks.length) return null;
                  const passed = checks.filter((c) => c.status === "pass").length;
                  const scoreable = checks.filter((c) => c.status !== "skipped").length;
                  return (
                    <section key={group} className="py-3 border-b border-line last:border-0">
                      <div className="flex items-baseline gap-2 mb-2">
                        <h3 className="text-[12.5px] font-semibold text-ink">{GROUP_LABEL[group]}</h3>
                        <span className="tabular text-[11.5px] text-ink-3">
                          {passed}/{scoreable}
                        </span>
                        <div className="flex-1 max-w-40">
                          <Meter
                            value={scoreable ? (passed / scoreable) * 100 : 0}
                            tone={passed === scoreable ? "ok" : "warn"}
                          />
                        </div>
                      </div>
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {checks.map((c) => (
                          <li key={c.id} className="flex items-start gap-2 text-[12px] py-0.5">
                            <Badge tone={CHECK_TONE[c.status]}>{c.status}</Badge>
                            <span className="min-w-0">
                              <span className="text-ink">{c.label}</span>
                              <span className="text-ink-3"> — {c.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </Panel>
        ) : null}

        {tab === "versions" ? (
          <div className="flex flex-col gap-4">
            <InfoNote>
              Every build produces a new version and archives its exact files. Nothing overwrites a
              previous version, because iterative AI editing regularly makes a site worse and you
              need the one that was fine.
            </InfoNote>
            <VersionList versions={versionRows} />
            {project.versions.length > 1 ? (
              <Panel>
                <PanelHeader
                  title="Restore into the preview"
                  hint="Copies a stored version back over the working directory so the in-app preview shows it. It does not change which version is approved."
                />
                <div className="px-4 py-3 flex flex-wrap gap-2">
                  {project.versions.map((v) => (
                    <RestoreVersionButton
                      key={v.id}
                      projectId={project.id}
                      versionId={v.id}
                      version={v.version}
                    />
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>
        ) : null}

        {tab === "readme" ? (
          <Panel>
            <PanelHeader
              title={latest ? `README for v${latest.version}` : "README"}
              hint="Written at build time and shipped inside the archive. It names the model, lists what the quality gate could not check, and marks every fact the generator was not given."
              actions={
                latest ? (
                  <a
                    href={`/api/versions/${latest.id}/download`}
                    className="inline-flex items-center h-7 px-2.5 rounded-sm border border-line-strong bg-surface-2 text-[12px] font-medium text-ink hover:bg-surface-3 transition-colors"
                  >
                    Download ZIP
                  </a>
                ) : null
              }
            />
            {latest?.readmeText ? (
              <pre className="px-4 py-3.5 text-[12px] leading-relaxed text-ink-2 whitespace-pre-wrap font-mono overflow-x-auto">
                {latest.readmeText}
              </pre>
            ) : (
              <EmptyState
                title="No README yet"
                body="One is generated with every build. Versions built before artifact storage do not have one."
              />
            )}
          </Panel>
        ) : null}

        {tab === "builds" ? (
          <div className="flex flex-col gap-3">
            {project.builds.length === 0 ? (
              <Panel>
                <EmptyState title="No builds" body="The log records each stage the agent went through." />
              </Panel>
            ) : (
              project.builds.map((b) => (
                <Panel key={b.id}>
                  <PanelHeader
                    title={
                      <span className="flex items-center gap-2">
                        Build {b.id.slice(-6)}
                        <Badge tone={b.status === "complete" ? "ok" : b.status === "failed" ? "danger" : "info"}>
                          {b.status}
                        </Badge>
                      </span>
                    }
                    hint={`${b.provider ?? "unknown"} · started ${formatDateTime(b.startedAt)}${
                      b.completedAt ? ` · finished ${formatDateTime(b.completedAt)}` : ""
                    }`}
                    actions={<ScoreBadge score={b.qualityScore} />}
                  />
                  {b.error ? (
                    <p className="px-4 py-2 text-[12px] text-danger">{b.error}</p>
                  ) : null}
                  <BuildTimeline entries={parseBuildLog(b.logText)} status={b.status} />
                  {b.logText ? (
                    <details className="px-4 pb-3">
                      <summary className="text-[11.5px] text-ink-3 cursor-pointer hover:text-ink-2">
                        Raw log
                      </summary>
                      <pre className="mt-2 text-[11px] font-mono text-ink-3 overflow-x-auto whitespace-pre leading-relaxed max-h-72 bg-surface-2 border border-line rounded-sm p-2">
                        {b.logText}
                      </pre>
                    </details>
                  ) : null}
                </Panel>
              ))
            )}
          </div>
        ) : null}

        {tab === "deploy" ? (
          <div className="flex flex-col gap-5">
            <InfoNote tone="warn">
              <strong className="font-semibold">
                Deployment is deliberately outside this workflow.
              </strong>{" "}
              A build ends at a reviewed, downloadable project — nothing here has been pushed to a
              repository or published anywhere. Deploy by hand once you have read the site, or use
              the adapter below if you would rather this app did it. Either way it is an explicit
              action you take, never a step a build performs.
            </InfoNote>

            <Panel>
              <PanelHeader
                title="Deploy"
                hint="Nothing is reported as deployed unless the provider confirmed it with a URL."
              />
              <DeployControls
                projectId={project.id}
                configured={deployment.isConfigured()}
                providerLabel={deployment.label}
                setupHint={deployment.setupHint}
              />
            </Panel>

            <Panel>
              <PanelHeader title="Deployment history" />
              {project.deployments.length === 0 ? (
                <EmptyState title="Never deployed" body="Deployments appear here with their real status and URL." />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Provider</Th>
                      <Th>Environment</Th>
                      <Th>Status</Th>
                      <Th>URL</Th>
                      <Th>When</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.deployments.map((d) => (
                      <tr key={d.id}>
                        <Td>{d.provider}</Td>
                        <Td>{d.environment}</Td>
                        <Td>
                          <Badge tone={d.status === "ready" ? "ok" : d.status === "failed" ? "danger" : "info"}>
                            {d.status}
                          </Badge>
                          {d.error ? <span className="ml-2 text-[11.5px] text-danger">{d.error}</span> : null}
                        </Td>
                        <Td>
                          {d.productionUrl ?? d.previewUrl ? (
                            <a
                              href={(d.productionUrl ?? d.previewUrl)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              {d.productionUrl ?? d.previewUrl}
                            </a>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td className="text-ink-3">{relativeTime(d.createdAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          </div>
        ) : null}

        {tab === "handoff" ? (
          <Panel>
            <PanelHeader title="Client handoff report" hint="Assembled from what actually exists." />
            {!latest || !brief ? (
              <EmptyState title="Not ready" body="A handoff report needs a brief and at least one successful build." />
            ) : (
              <div className="px-4 py-4 grid gap-4 lg:grid-cols-2 text-[12.5px] leading-relaxed">
                <div>
                  <p className="label mb-0.5">Project</p>
                  <p className="text-ink-2">
                    {project.prospect.business.name} — {project.slug} (v{latest.version})
                  </p>
                </div>
                <div>
                  <p className="label mb-0.5">Technology</p>
                  <p className="text-ink-2">
                    Static HTML and CSS, no client framework, no build step required to host.
                  </p>
                </div>
                <div>
                  <p className="label mb-0.5">Pages</p>
                  <p className="text-ink-2">{brief.pages.map((p) => p.name).join(", ")}</p>
                </div>
                <div>
                  <p className="label mb-0.5">SEO</p>
                  <p className="text-ink-2">
                    Title, meta description, canonical, Open Graph, LocalBusiness structured data,
                    robots.txt and sitemap.xml.
                  </p>
                </div>
                <div>
                  <p className="label mb-0.5">Accessibility</p>
                  <p className="text-ink-2">
                    Semantic landmarks, labelled form fields, visible focus states, motion gated
                    behind prefers-reduced-motion.
                  </p>
                </div>
                <div>
                  <p className="label mb-0.5">Quality score</p>
                  <p className="text-ink-2">{latest.qualityScore}/100 from the build quality gate.</p>
                </div>
                <div className="lg:col-span-2">
                  <p className="label mb-1">Outstanding items</p>
                  {report?.remainingIssues.length ? (
                    <ul className="text-ink-2 flex flex-col gap-0.5">
                      {report.remainingIssues.map((r) => (
                        <li key={r}>· {r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-ink-2">No failing checks in the latest build.</p>
                  )}
                </div>
                <div className="lg:col-span-2">
                  <InfoNote tone="warn">
                    <strong className="font-semibold">Requires the client before launch:</strong>{" "}
                    {brief.requiresClientInput.join("; ") || "nothing outstanding"}. These appear as
                    highlighted placeholders on the generated pages — no substitute content was
                    invented for them.
                  </InfoNote>
                </div>
                <div className="lg:col-span-2">
                  <p className="label mb-0.5">Source</p>
                  <p className="font-mono text-[11.5px] text-ink-3">{project.path}</p>
                </div>
              </div>
            )}
          </Panel>
        ) : null}
      </div>
    </>
  );
}
