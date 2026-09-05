# Lead → Launch

An internal operating system for a web studio: find local businesses, audit their
digital presence, score the opportunity, generate a website, and run the outreach
and pipeline that turn one into a project.

    DISCOVER → ENRICH → AUDIT → SCORE → QUALIFY → ANALYZE → BUILD → REVIEW → DEPLOY → OUTREACH → TRACK

## The one rule

**Nothing is presented as real unless it happened.** Every integration is behind a
provider interface with a labelled mock fallback, every score is reported with the
breakdown that produced it, every AI call is a persisted job, and anything the
system does not know is rendered as a visible gap rather than filled in.

Concretely:

- Demo businesses are labelled *Demo data* everywhere they appear, and live on
  RFC 2606 reserved hostnames so nothing can accidentally hit a real site.
- With no AI key configured, the router falls through to a **deterministic
  composer** that rearranges facts already in the database. It performs no
  inference, refuses to generate code, and its output is labelled *composed, not
  written by a model*.
- The build quality gate reports rendered visual checks as **skipped**, never as
  passed, because they need a browser it does not ship with.
- Deployment reports failure and setup instructions rather than a fake URL.
- Generated websites mark unknown facts as `[client to confirm]` in yellow
  instead of inventing testimonials, awards or statistics.

## Getting started

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000>. Everything works with no API keys at all — the seed
runs three real campaigns through the real pipeline against the mock provider.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit + integration suites (Vitest) |
| `npm run db:migrate` | Create/apply Prisma migrations |
| `npm run db:seed` | Seed the workspace and demo campaigns |
| `npm run db:reset` | Recreate the local SQLite file from migrations |
| `npm run db:refresh` | Reset then seed |
| `npm run db:studio` | Prisma Studio |

## Architecture

```
src/
  app/          Routes (App Router) + actions.ts, the only mutation surface
  components/   ui/ primitives, shell/ chrome, features/ screen-specific
  config/       Scoring weights, pipeline stages, AI routing, industries, nav
  db/           Prisma client + the workspace (auth) boundary
  providers/    ai · business-data · audit · deployment · outreach
  services/     Business logic: discovery, audit, scoring, opportunity,
                outreach, website-projects, analytics, ai-jobs, tasks
  agents/       website-builder (generator + quality gate)
  lib/          utils, json, errors, logger, safe-url
  types/        Shared contracts
```

**Providers are interchangeable.** Each concern defines an interface, a registry
that picks an implementation from configuration, and a mock. Nothing outside
`providers/` knows which vendor is in play.

**Capabilities, not vendors.** AI calls declare a capability (`analysis`,
`copywriting`, `codeGeneration`, …). The router resolves capability → provider →
model from per-workspace configuration, with a fallback chain ending at the
composer. Claude is the default for anything a client will see; cheaper providers
handle bulk research and classification. All of it is editable in the AI Control
Center.

**Everything is workspace-scoped.** Every table hangs off `Workspace` and every
query goes through `getWorkspaceContext()`. Replacing that one function with a
session lookup is the whole change required to become multi-user — no query has
to be rewritten.

## How the audit works

One real HTTP request per site. The response is parsed into ~60 observed signals
(`AuditSignals`), and a separate pure function turns those into scores and
findings. That split is deliberate: extraction records only what was seen,
interpretation is unit-tested against fixtures, and every point deducted has a
finding attached that says what is wrong, why it matters, how hard it is to fix
and what to do.

Set `PAGESPEED_API_KEY` to add real Lighthouse scores; the built-in extractor
still supplies the UX and conversion signals Lighthouse does not model.

Demo businesses cannot be fetched, so they route to a mock auditor that
synthesises a representative *document* per archetype and parses it with the same
extractor. The scoring path is identical; only the source of the HTML differs.

## Opportunity scoring

Seven weighted factors, each producing a 0–100 value with a one-line
justification. The weights are per-workspace configuration, the breakdown is
stored alongside the score, and the UI renders it next to the number — so a claim
of "87/100" can be checked line by line.

## Website Studio

Each prospect gets an isolated project directory under `PROJECTS_ROOT`. Builds
are versioned; every successful build archives its exact bytes so a regression can
be rolled back, not merely described. The preview iframe serves the real files
from disk.

With no `codeGeneration` provider configured, the built-in scaffolder produces the
site: a genuine, runnable, deployable static project generated deterministically —
labelled as such, never as model output. Configure an AI provider and the same
`BuildAgentInput`/`BuildAgentResult` contract runs the agent path instead,
starting from the scaffold rather than an empty directory.

## Outreach safety

- No bulk send exists anywhere in the codebase.
- Every message requires an explicit human approval before it can be sent.
- Drafts are generated only from observations recorded in an audit; a prospect
  with a website and no audit is refused.
- Channels with no sanctioned API for cold contact (WhatsApp, Instagram,
  LinkedIn) are manual by design — the app produces copy, you send it.
- The hourly rate limit is enforced in the service layer, not the UI.
- Opting a prospect out withdraws their outstanding drafts.

## Database

SQLite by default so the app runs with zero setup. The schema avoids
Postgres-only features specifically so the move is small:

1. Set `provider = "postgresql"` in `prisma/schema.prisma`
2. Point `DATABASE_URL` at the cluster
3. `npm i @prisma/adapter-pg` and register it in `src/db/client.ts`
4. `npm run db:migrate`

No application code changes.

## Testing

- `tests/unit.test.ts` — pure logic: identity and de-duplication, the SSRF guard,
  signal extraction against fixtures, audit interpretation, scoring, the next
  action engine, both mock providers, the generator and the quality gate.
- `tests/pipeline.integration.test.ts` — the real services end to end against a
  temporary SQLite database created from the committed migrations: discovery,
  de-duplication, audit, scoring, sales angle, brief, build, versioning,
  outreach approval gates, analytics consistency and workspace isolation.

## Known limits

These are stated rather than hidden behind a spinner:

- **Visual QA is not wired up.** The loop is designed for and the quality gate
  declares its checks, but capturing screenshots needs a headless browser this
  app does not bundle. Those checks report `skipped`.
- **Competitor intelligence needs a data provider.** With no key, the tab says so
  and shows nothing rather than inventing competitors.
- **The Netlify adapter is incomplete** (its digest handshake is unimplemented)
  and says so instead of failing obscurely. Vercel works.
- **Campaigns run synchronously** in the request. A background worker is the
  right answer above a few hundred prospects per run.
- **Model prices are unset** in `src/config/ai.ts`, so cost estimates read "not
  priced" rather than showing an invented figure. Fill them in from your
  provider's pricing page and cost tracking starts working.
