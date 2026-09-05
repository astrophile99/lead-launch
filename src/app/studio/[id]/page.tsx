import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatDateTime, hostOf, relativeTime } from "@/lib/utils";
import { getDeploymentProvider } from "@/providers/deployment";
import { resolveRoute } from "@/providers/ai/router";
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
import { SitePreview } from "@/components/features/SitePreview";
import {
  BriefEditor,
  BuildControls,
  DeployControls,
  RestoreVersionButton,
} from "@/components/features/StudioActions";

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
  const codeRoute = await resolveRoute(workspaceId, "codeGeneration");
  const before = project.prospect.websiteScore;
  const after = latest?.qualityScore ?? null;

  const tabs = [
    { id: "preview", label: "Preview" },
    { id: "brief", label: "Brief" },
    { id: "quality", label: "Quality gate", count: report?.checks.length },
    { id: "versions", label: "Versions", count: project.versions.length },
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
          <BuildControls
            projectId={project.id}
            hasVersions={project.versions.length > 0}
            strategyLabel={
              codeRoute.provider.isMock
                ? "Built-in scaffolder — deterministic, no model involved."
                : `Agent path via ${codeRoute.provider.label} / ${codeRoute.model}.`
            }
          />
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
          <Panel>
            <PanelHeader
              title="Versions"
              hint="Every successful build archives its exact files, so a regression can be rolled back."
            />
            {project.versions.length === 0 ? (
              <EmptyState title="No versions" body="Versions appear after the first successful build." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>Built</Th>
                    <Th>Produced by</Th>
                    <Th className="text-right">Quality</Th>
                    <Th className="text-right">Files</Th>
                    <Th>Changes</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {project.versions.map((v) => (
                    <tr key={v.id} className="hover:bg-surface-2 transition-colors">
                      <Td className="text-ink font-medium">v{v.version}</Td>
                      <Td className="text-ink-3">{formatDateTime(v.createdAt)}</Td>
                      <Td className="text-ink-3">
                        {v.provider === "builtin-scaffold" ? "Built-in scaffolder" : `${v.provider} / ${v.model}`}
                      </Td>
                      <Td className="text-right"><ScoreBadge score={v.qualityScore} /></Td>
                      <Td className="tabular text-right">
                        {fromJson<{ path: string }[]>(v.filesJson, []).length}
                      </Td>
                      <Td className="text-ink-3">{fromJson<string[]>(v.changesJson, []).join("; ")}</Td>
                      <Td className="text-right">
                        <RestoreVersionButton
                          projectId={project.id}
                          versionId={v.id}
                          version={v.version}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
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
                  {b.logText ? (
                    <pre className="px-4 py-3 text-[11.5px] font-mono text-ink-2 overflow-x-auto whitespace-pre leading-relaxed max-h-72">
                      {b.logText}
                    </pre>
                  ) : null}
                </Panel>
              ))
            )}
          </div>
        ) : null}

        {tab === "deploy" ? (
          <div className="flex flex-col gap-5">
            <Panel>
              <PanelHeader title="Deploy" hint="Nothing is reported as deployed unless the provider confirmed it." />
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
