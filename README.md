# Lead → Launch

An internal operating system for a web studio: find local businesses, audit their
digital presence, score the opportunity, generate a website, and run the outreach
and pipeline that turn one into a project.

    DISCOVER → ENRICH → AUDIT → SCORE → QUALIFY → ANALYZE → PLAN
      → BUILD → QA → DEPLOY → OUTREACH → FOLLOW UP → PIPELINE → WON

## The one rule

**Nothing is presented as real unless it happened.** Every integration sits
behind a provider interface with a labelled mock fallback, every score ships
with the breakdown that produced it, every AI call is a persisted job, and
anything the system does not know is rendered as a visible gap rather than
filled in.

Concretely:

- Demo businesses are labelled *Demo data* everywhere they appear and live on
  RFC 2606 reserved hostnames, so nothing can accidentally hit a real site.
- With no AI key, the router falls through to a **deterministic composer** that
  rearranges facts already in the database. It performs no inference, refuses to
  generate code, and its output is labelled *composed, not written by a model*.
- Digital presence has three states, not two. "Missing" is a claim that we
  looked; a field the discovery provider never returns is *not checked*.
- The build quality gate reports rendered visual checks as **skipped**, never as
  passed, because it ships without a headless browser.
- Deployment reports failure and setup instructions rather than a fake URL.
- Cost is only shown where a model price is configured. Unpriced jobs are
  counted and called out rather than silently treated as free.
- Generated websites mark unknown facts as `[client to confirm]` instead of
  inventing testimonials, awards or statistics.

## Getting started

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000>. Everything works with no API keys at all — the
seed runs three real campaigns through the real pipeline against the mock
provider.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit + integration suites (Vitest) |
| `npm run db:migrate` | Create/apply Prisma migrations |
| `npm run db:seed` | Seed the workspace and demo campaigns |
| `npm run db:reset` | Recreate the local SQLite file from migrations |
| `npm run db:refresh` | Reset then seed |
| `npm run db:studio` | Prisma Studio |

## Architecture

```
src/
  app/
    (app)/      Application routes, wrapped in the shell
    (auth)/     Sign-in, sign-up, password reset — no shell
    api/        REST surface + Meta webhooks
    actions.ts  The only mutation surface
  components/   ui/ primitives, shell/ chrome, features/ screen-specific
  config/       Scoring, pipeline, AI routing, industries, nav, outreach
  db/           Prisma client + the workspace (auth) boundary
  providers/    ai · business-data · audit · messaging · deployment
  services/     Discovery, audit, scoring, opportunity, outreach, voice,
                costs, integrations, jobs, prospects, website-projects
  agents/       website-builder (generator + quality gate)
  lib/          utils, json, errors, logger, safe-url, api, meta-webhook
```

**Providers are interchangeable.** Each concern defines an interface, a registry
that picks an implementation from configuration, and a mock. Nothing outside
`providers/` knows which vendor is in play.

**Capabilities, not vendors.** AI calls declare a capability (`analysis`,
`copywriting`, `codeGeneration`, …). The router resolves capability → provider →
model from per-workspace configuration, with a fallback chain ending at the
composer. Claude is the default for anything a client will see.

**Everything is workspace-scoped.** Every table hangs off `Workspace` and every
query goes through `getWorkspaceContext()`. Replacing that one function with a
session lookup is the whole change required to become multi-user.

**One page at a time.** Prospect filtering, sorting and paging execute in the
database. The browser never holds the whole list.

## How the audit works

One real HTTP request per site. The response is parsed into ~60 observed signals
(`AuditSignals`), and a separate pure function turns those into scores and
findings. That split is deliberate: extraction records only what was seen,
interpretation is unit-tested against fixtures, and every point deducted has a
finding attached saying what is wrong, why it matters, how hard it is to fix and
what to do.

Set `PAGESPEED_API_KEY` to add real Lighthouse scores. Demo businesses route to
a mock auditor that synthesises a representative *document* and parses it with
the same extractor — the scoring path is identical, only the HTML differs.

## Outreach

Messages are generated only from observations recorded in an audit, in the
workspace's own **voice** — tone dials plus, optionally, a style profile derived
from messages the user actually wrote ("Learn my style").

Safety is structural, not advisory:

- No bulk send exists anywhere in the codebase.
- Every message requires an explicit human approval; revising a draft **resets**
  that approval, because approval is of specific words.
- Opt-outs are checked when a draft is written and again before it sends, and
  match on the normalised identifier so re-discovery cannot undo one.
- The hourly rate limit is enforced in the service layer, not the UI.

### Channel reality

| Channel | Status | Why |
| --- | --- | --- |
| Email | Full send via Resend | A sanctioned transactional API exists |
| WhatsApp | Send via Meta Cloud API, **template-only for cold contact** | Meta forbids free-form messages to someone who has not messaged you |
| Instagram | **Replies only** | No sanctioned API exists for cold DMs |
| LinkedIn | Manual | Automation breaches their terms |

The app writes the message in every case; where it cannot legitimately send, it
says so and you send it yourself. There is no workaround path in this codebase.

Webhooks verify `X-Hub-Signature-256` against the raw body and **reject the
payload** when `META_APP_SECRET` is absent — an unverified webhook lets anyone
who learns the URL write fabricated replies into the CRM.

## Cost and budget

Token counts come from provider responses and are real. Money is computed only
where a per-million-token price is configured in `src/config/ai.ts` — the app
ships with those blank, because a guessed price is worse than none. The AI
Control Center reports spend for today, this week and this month, split by
provider and by task, plus unit economics per prospect, audit, website and
message. Budgets warn at 50% and 80% and can refuse new jobs at 100%; unpriced
models never block work.

## Database

SQLite by default so the app runs with zero setup. The schema avoids
Postgres-only features specifically so the move is small:

1. Set `provider = "postgresql"` in `prisma/schema.prisma`
2. Point `DATABASE_URL` at the cluster
3. `npm i @prisma/adapter-pg` and register it in `src/db/client.ts`
4. `npm run db:migrate`

No application code changes.

## Testing

- `tests/unit.test.ts` — identity and de-duplication, the SSRF guard, signal
  extraction, audit interpretation, scoring, the next-action engine, both mock
  providers, the generator and the quality gate.
- `tests/phase2.test.ts` — cost estimation and budget thresholds, opt-out
  normalisation, voice rendering, webhook signature rejection, digital-presence
  three-state logic, filter parsing, and the API envelope (including that a raw
  error never reaches the caller).
- `tests/pipeline.integration.test.ts` — the real services end to end against a
  temporary SQLite database built from the committed migrations.

## Known limits

Stated rather than hidden behind a spinner:

- **Authentication is not wired up.** Every screen exists and validates, and the
  data model is ready, but sign-in cannot work until Supabase is configured.
  Until then anyone who can reach the server has owner access — do not expose it
  publicly.
- **Visual QA is not wired up.** The loop is designed for and the quality gate
  declares its checks, but capturing screenshots needs a headless browser this
  app does not bundle. Those checks report `skipped`.
- **Competitor intelligence needs a data provider.** With no key the tab says so
  and shows nothing rather than inventing competitors.
- **Generated sites live on local disk.** Fine for development, wrong for a
  serverless deployment. Configure `GITHUB_TOKEN` and `STORAGE_PROVIDER` before
  relying on a build surviving a restart.
- **Campaigns run synchronously** in the request. A background worker is the
  right answer above a few hundred prospects per run.
- **Model prices are unset**, so cost estimates read "not priced".
- **The Netlify adapter is incomplete** and says so. Vercel works.
