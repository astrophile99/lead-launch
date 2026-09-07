# Lead → Launch

A private client-acquisition operating system for a web developer: find local
businesses, understand them cheaply, decide who is worth the time, contact them
from your own accounts, and — once you have actually spoken to someone — build
them a website you review by hand.

    DISCOVER → RESEARCH → AUDIT → SCORE → OUTREACH → FOLLOW UP → MEETING
      → BUILD (manual) → REVIEW → DOWNLOAD → REVISE → DEPLOY (outside this app)

## The two rules

**1. Nothing is presented as real unless it happened.** Every integration sits
behind a provider interface with a labelled fallback, every score ships with the
breakdown that produced it, every AI call is a persisted job, and anything the
system does not know renders as a visible gap rather than a plausible value.

**2. Nothing irreversible happens without you.** Websites are never generated
automatically. Messages are never sent automatically. Nothing is deployed at
all. The app is a workbench, not an agent with your credit card.

Concretely:

- **Website generation is manually triggered and never happens during
  discovery, auditing, scoring, campaign runs, outreach, or a stage change.**
  `startBuild` requires an explicit request carrying a provider, a model, a
  quality mode and — outside a build-ready stage — a deliberate override. There
  is no default request, so no caller can start a build by omission. Tests
  assert that nine service modules cannot even import it.
- **Outreach is human-approved.** AI writes drafts; an external message is never
  sent because a model produced one. Approve and Send are separate actions,
  editing an approved message withdraws its approval, and a message is only
  marked sent when the provider returns an id.
- **Nothing is deployed.** The build ends at a downloadable ZIP with a README.
  No GitHub repository is created, no commit is pushed, no host is contacted.
- Demo businesses are labelled *Demo data* and live on RFC 2606 reserved
  hostnames, so nothing can accidentally hit a real site.
- With no AI key the router falls through to a **deterministic composer** that
  rearranges facts already in the database. It performs no inference, refuses to
  generate code, and its output is labelled *composed, not written by a model*.
- Digital presence has three states. "Missing" is a claim that we looked; a
  field the discovery provider never returns is *not checked*.
- The build quality gate reports rendered visual checks as **skipped**, never as
  passed, because it ships without a headless browser.
- Cost is shown only where a model price is configured. Unpriced work is counted
  and called out rather than treated as free.

## Getting started

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000>. Everything works with no API keys at all — the
seed runs three real campaigns through the real pipeline against the free and
mock providers.

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
    api/        REST surface, OAuth callbacks, downloads, Meta webhooks
    actions.ts  The only mutation surface
  components/   ui/ primitives, shell/ chrome, features/ screen-specific
  config/       Scoring, pipeline, AI routing, build modes, industries, nav
  db/           Prisma client + the workspace boundary
  lib/          authz, crypto, oauth, rate-limit, zip, safe-url, api, errors
  providers/    ai · business-data · audit · messaging · storage ·
                website-builder · deployment
  services/     discovery, research, crawler, audit, scoring, opportunity,
                outreach, outreach-queue, voice, costs, website-build,
                website-package, command-center, integrations, jobs
  agents/       website-builder (generator, quality gate, file plumbing)
```

**Providers are interchangeable.** Each concern defines an interface, a registry
that picks an implementation from configuration, and a labelled fallback.
Nothing outside `providers/` knows which vendor is in play.

**Capabilities, not vendors.** AI calls declare a capability (`analysis`,
`copywriting`, `codeGeneration`, …). The router resolves capability → provider →
model from per-workspace configuration, with a fallback chain ending at the
composer. The build dialog can pin a specific model for one build.

**Everything is workspace-scoped**, and the scope always comes from the session
rather than from the client. See `src/lib/authz.ts`.

**One page at a time.** Prospect filtering, sorting and paging execute in the
database. The browser never holds the whole list.

## Research: cheap first, cached always

Research is the recurring cost in this product, so it is layered cheapest first
and nothing is fetched twice without being asked:

1. **The business's own website.** Free apart from bandwidth, and the most
   accurate source of what a business actually sells.
2. **OpenStreetMap via Overpass.** Free, open, no key. The default discovery
   provider. It carries no ratings or review counts, and says so rather than
   reporting zeros. ODbL attribution is carried on every result.
3. **Google Places.** Billed per request past the free allowance, so it is the
   fallback rather than the default, and every call is counted. Settings →
   Research shows how much of the monthly allowance is left.

The crawler is deliberately small, and every limit is enforced rather than
suggested: a fixed priority-path list, a hard page and byte budget, a real
timeout, per-host throttling, robots.txt, content-type checks, and a bounded
redirect chain where **every hop is re-validated against the SSRF guard**.
Bodies are read in chunks and abandoned past the cap, because `Content-Length`
is a claim rather than a guarantee.

Extraction is deterministic. Phone numbers, emails, socials, headings,
navigation, JSON-LD and CTAs are parsed; a model is only paid for on questions
parsing cannot answer. Every result is cached with a content hash, so *Refresh
research* can report whether anything actually changed.

## How the audit works

One real HTTP request per site. The response is parsed into ~60 observed signals
(`AuditSignals`), and a separate pure function turns those into scores and
findings. That split is deliberate: extraction records only what was seen,
interpretation is unit-tested against fixtures, and every point deducted has a
finding attached saying what is wrong, why it matters, how hard it is to fix and
what to do.

Set `PAGESPEED_API_KEY` to add real Lighthouse scores.

## The website builder

Two implementations behind one interface, and the difference is visible
everywhere the output is shown:

| | Scaffold | AI agent |
| --- | --- | --- |
| Calls a model | No | Yes |
| Can invent a fact | No | Refused by prompt and marked `[CLIENT TO CONFIRM]` |
| Can exceed its template | No | Yes |
| Cost | Free | Real |

The agent is a genuine loop: it plans a file manifest, writes each file, runs the
deterministic quality gate over what it wrote, reads the failures, and rewrites
only the files those failures name — for as many rounds as the quality mode
allows. It cannot write outside an allow-list of extensions, and nothing it
produces is ever executed.

An earlier version of this code accepted `strategy: "agent"` and then ran the
deterministic generator anyway. **The strategy a build actually ran is now
recorded separately from the one that was requested**, and if the agent could not
run, the version row, the build row, the toast and the generated README all say
scaffold.

### Build modes

Not three labels for the same thing. Each changes iteration count, whether a
separate code-review pass runs, the quality-gate threshold and the token
ceiling — asserted by test.

| Mode | Iterations | Code review | Gate |
| --- | --- | --- | --- |
| Fast | 1 | no | 60 |
| Balanced | 2 | yes | 75 |
| Premium | 4 | yes | 85 |

### What a build produces

Every file is stored as a `WebsiteArtifact` row, so a build survives the machine
that made it. A README is generated alongside naming the model, the strategy,
what the gate could not check, and every fact the generator was not given.
Download is a real ZIP; the writer refuses any entry name that would be
dangerous to extract (traversal, absolute paths, drive letters, control
characters, Windows device names).

Versions are never overwritten, and a fresh version is a **draft** until a
person marks it approved. A passing gate is not a review.

## Outreach

One queue for Gmail, WhatsApp and Instagram, with one state machine:

    draft → (edit) → approved → sending → sent
                              ↘ failed

Enforced in the service rather than the UI:

- Editing an approved message returns it to draft, because approval is of
  specific words.
- Approving transmits nothing. There is no setting, hidden or otherwise, that
  makes an approved message go out on its own.
- `sent` means a provider returned an id. Anything else is `failed` or stays
  approved with the reason recorded.
- Opt-outs are checked when a draft is written **and** again before it sends,
  matched on the normalised identifier so re-discovery cannot undo one.
- Bulk *generation* is allowed. Bulk *sending* sends only messages already
  approved individually, and repeats the exact count back before doing it.

### Channel reality

| Channel | Status | Why |
| --- | --- | --- |
| Gmail | Full send via the Gmail API | OAuth 2.0, real Gmail drafts |
| Email (Resend) | Full send | Fallback when no Gmail account is connected |
| WhatsApp | Send via Meta Cloud API, **template-only for cold contact** | Meta forbids free-form messages to someone who has not messaged you |
| Instagram | **Replies only** | No sanctioned API exists for cold DMs |
| LinkedIn | Manual | Automation breaches their terms |

Where sending is not permitted, the app writes the message and says so. There is
no workaround path in this codebase.

### Gmail

Connected through Google OAuth 2.0 with PKCE. **There is no Gmail password field
anywhere in this application and there never will be** — Google does not permit
password access, and an app that asks for one is either phishing or about to be
blocked.

The app requests exactly one scope: `gmail.compose` (create, update and send
drafts). It does **not** request `gmail.readonly`, `gmail.modify` or
`mail.google.com`. Reading a mailbox is a different order of access, and this
product does not need it. If inbound reply tracking is added later it will ask
for the extra scope as a separate, explained step.

Drafts are real Gmail drafts, so an approved message sits in your own Drafts
folder and can be inspected or deleted from Gmail itself; sending sends *that*
draft rather than composing a fresh message from the same row.

Tokens are encrypted at rest with AES-256-GCM. **Without `TOKEN_ENCRYPTION_KEY`
the app refuses to store a token at all** rather than falling back to plaintext.

## Security

- **Authorization is centralised** in `src/lib/authz.ts`. A workspace id is
  always derived from the session and never accepted from a client; record
  helpers load a row and prove access in the same call, so there is no version
  of the code that reads a record without having checked. A record in another
  workspace reports `not-found`, not `forbidden`, so ids cannot be enumerated.
- **SSRF**: every fetched URL — including every redirect hop — goes through
  `assertSafePublicUrl` before a socket opens. Loopback, RFC1918, link-local,
  CGNAT, cloud metadata, `.local`/`.internal`, embedded credentials and
  non-http(s) schemes are all refused.
- **Webhooks** verify `X-Hub-Signature-256` against the raw body, are idempotent
  on the provider's own event id, reject replays outside the messaging window,
  rate-limit before doing any work, and cap the payload size. With no
  `META_APP_SECRET` they reject rather than trust.
- **Archives** refuse dangerous entry names, so a ZIP from this app cannot be a
  zip-slip vector even for a careless extractor.
- **Secrets** are read in exactly one module (`src/config/app.ts`, asserted by
  test) and no server secret may ever carry a `NEXT_PUBLIC_` prefix.
- **Prompt injection**: crawled pages, business records and inbound messages
  reach models as data. No model output can send a message, start a build or
  deploy anything — each of those requires a human action, and the model has no
  tool that could take one.
- **Rate limiting** is in-process and honest about it: it stops a runaway loop
  and casual abuse on a single instance, and must be swapped for Redis the
  moment this runs more than one replica. That is a change confined to
  `src/lib/rate-limit.ts`.

## Cost and budget

Token counts come from provider responses and are real. Money is computed only
where a per-million-token price is configured in `src/config/ai.ts` — the app
ships with those blank, because a guessed price is worse than none. The AI
Control Center reports spend for today, this week and this month, split by
provider and by task, plus unit economics per prospect, audit, website and
message. Budgets warn at 50% and 80% and can refuse new jobs at 100%; unpriced
models never block work. External provider calls are counted separately in
Settings → Research.

## Storage

Generated sites must outlive the machine that built them. The local filesystem
is a build scratch directory — correct for development and wrong on a serverless
host, where it is discarded between deploys. The durable record is the
`WebsiteArtifact` rows plus the storage provider. Settings → Storage says which
you are on and whether it is durable.

## Database

SQLite by default so the app runs with zero setup. The schema avoids
Postgres-only features specifically so the move is small:

1. Set `provider = "postgresql"` in `prisma/schema.prisma`
2. Point `DATABASE_URL` at the cluster
3. `npm i @prisma/adapter-pg` and register it in `src/db/client.ts`
4. `npm run db:migrate`

No application code changes.

## Supabase migration plan

The next phase, deliberately not started here:

1. **Auth** — replace `requireAuth()` in `src/lib/authz.ts` with a Supabase
   session lookup. That one function is the seam; everything downstream of it
   (membership, role, per-record ownership) is real already.
2. **Database** — switch the Prisma provider and adapter as above.
3. **Storage** — set `STORAGE_PROVIDER=supabase` with a bucket. The adapter is
   written against the real REST API and refuses honestly until then.
4. **RLS** — every table already hangs off `Workspace`, so the policies are
   mechanical.
5. **Realtime** — optional, for live build progress.

## Testing

- `tests/unit.test.ts` — identity and de-duplication, the SSRF guard, signal
  extraction, audit interpretation, scoring, the next-action engine, both mock
  providers, the generator and the quality gate.
- `tests/phase2.test.ts` — cost estimation and budget thresholds, opt-out
  normalisation, voice rendering, webhook signature rejection, digital-presence
  three-state logic, filter parsing, and the API envelope.
- `tests/phase3.test.ts` — the manual-build guarantee, the stage gate, build
  modes actually differing, archive path safety, SSRF, crawler limits, robots
  parsing, deterministic extraction, the outreach state machine, Gmail scope and
  MIME safety, webhook replay, and secret handling.
- `tests/pipeline.integration.test.ts` — the real services end to end against a
  temporary SQLite database built from the committed migrations, including the
  full draft → edit → approve → send regression for three channels and proof
  that a campaign run and a stage change produce zero builds.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

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
- **Generated sites live on local disk by default.** Configure
  `STORAGE_PROVIDER=supabase` before relying on a build surviving a restart.
- **Campaigns and builds run synchronously** in the request. A background worker
  is the right answer above a few hundred prospects per run.
- **Model prices are unset**, so cost estimates read "not priced".
- **Rate limiting is per-process** and does not survive a restart.
- **Deployment adapters exist but are not part of the workflow.** This release
  stops at a downloadable project on purpose.
