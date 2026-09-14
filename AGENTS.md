<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Lead → Launch — working notes

Read `README.md` first; it explains the architecture and, more importantly, the
product's one rule.

## The rule

Nothing is presented as real unless it happened. When you add an integration:

1. Define the interface in `src/providers/<concern>/types.ts`
2. Write the real adapter, which throws a structured `AppError` carrying a
   `remedy` when its credential is missing
3. Write a mock that is obviously labelled at every layer above it
4. Register both, and surface the health row in Settings

Never emit a plausible-looking value in place of one you do not have. Prefer a
visible gap, a `skipped` status, or a refusal with instructions.

## Boundaries

- **Mutations** go in `src/app/actions.ts` only. Each one resolves the workspace
  context, validates with zod, and returns `ActionResult` rather than throwing
  across the RSC boundary.
- **Business logic** lives in `src/services/`. UI components must not query the
  database or call providers directly.
- **Every query is workspace-scoped.** Use `getWorkspaceContext()`; do not read
  `process.env` outside `src/config/app.ts`.
- **Errors** are `AppError` with `kind`, `message`, `remedy`, `retryable`. The UI
  renders all four.

## Conventions

- Scores are 0–100 integers and must always ship with the breakdown that
  produced them.
- JSON is stored as TEXT for SQLite/Postgres portability — go through
  `src/lib/json.ts`, never `JSON.parse` a column inline.
- Anything fetched from a third party goes through `assertSafePublicUrl` first.
- Tailwind classes are merged with `cn()` (clsx + tailwind-merge), so component
  defaults can be overridden by callers.

## Channel honesty

Before adding anything that sends a message, check what the platform actually
permits:

- WhatsApp cold contact is template-only, and Meta must have approved the
  template. Free-form text is limited to the 24-hour window after they reply.
- Instagram has no sanctioned cold-DM path at all. Replies only.
- LinkedIn automation breaches their terms.

Where sending is not permitted, the app writes the message and the human sends
it. Do not add a workaround, and do not report a send that did not happen.

Webhooks must verify `X-Hub-Signature-256` against the raw request body — parsed
and re-serialised JSON will never match. With no `META_APP_SECRET`, reject the
payload rather than trusting it.

## Money

Report cost only where a model price is configured in `src/config/ai.ts`.
Unpriced work is counted and surfaced as unpriced; it is never treated as free
and never blocks a job on a budget it cannot measure.

## Manual control

Three operations in this product are irreversible or cost real money. Each one
requires a person, and each one is protected by structure rather than by a
comment asking you to be careful.

### Website builds

`startBuild` in `src/services/website-build.ts` is the only function that
creates a `WebsiteBuild` row, and it takes a required `BuildRequest` with no
default. That is what makes "a build never starts on its own" a property of the
code: there is no argument shape meaning "just build something".

If you are adding a feature and find yourself wanting to call it:

- from discovery, auditing, scoring, a campaign, outreach or a stage change —
  don't. A test asserts those modules cannot even import it.
- because a prospect scored well — don't. A high score is a reason to talk to
  someone, not to spend money on them.
- with a default request so the caller does not have to choose — don't. That is
  the exact hole this design closes.

`buildGateFor(stage)` is a *recommendation*, not an authorisation check. It
returns `requiresOverride` outside a build-ready stage, and the override must
arrive as an explicit `true` from the dialog. Never default it, never infer it,
and never coerce it from a string.

### Sending a message

`sendApproved` in `src/services/outreach-queue.ts` is the only function that
sets `status: "sent"`, and it only does so on a provider response carrying an
id. When adding a channel:

- approval must not transmit. If your provider needs a draft created at approval
  time (as Gmail does), create the draft — do not send it.
- a provider that cannot send returns `status: "manual"` with the reason. It
  never throws to look like a delivery failure, and never returns "sent".
- if the provider returns no id, refuse. We cannot prove it went, so we do not
  say it did.

### Deployment

There is none in the workflow. The adapters exist and the Studio has a tab, but
a build ends at a stored artifact and a ZIP. Do not add a deploy step to the
build path, and do not make "Deploy" a primary action.

## Sales stages

`src/config/pipeline.ts` holds the stages, and they are *sales* stages only.
Website production is not one of them. Adding "building" or "website-ready" back
is what made an automatic build look like ordinary progress the first time; a
test asserts no stage name matches `/build|website|concept/`.

Consequently:

- A build never changes the prospect's stage.
- Generating a brief never changes the stage either — a brief is a document we
  wrote, not something the prospect did.
- An audit advances only a brand-new prospect, and never rewinds someone already
  in a conversation.

Stages written by earlier versions are mapped by `normaliseStage`. Read a stage
from the database through it rather than comparing strings directly.

## Research cost

Research is the recurring expense, so:

- Never fetch because a page rendered. Crawls happen because someone pressed
  Refresh, and `researchWebsite` only re-fetches with `force: true`.
- Layer cheapest first: the business's own site, then OpenStreetMap, then
  Google. `getBusinessDataProvider` returns the first *configured real* provider
  in registry order, and the registry is ordered by price.
- Count every external call with `recordUsage`. A provider whose spend is
  invisible is a provider that will surprise someone.
- Parse before you infer. A regex that finds a phone number costs nothing; a
  model that finds the same phone number costs money every time.
- Every crawler limit in `src/config/app.ts` under `research` is enforced. If
  you add a fetch path, use `crawlSite` or at minimum `assertSafePublicUrl` plus
  a byte cap — and re-validate on every redirect hop, not only the first URL.

### Overpass

Public Overpass instances fail often enough that a single request to a single
host is not a working design. `overpass-api.de` is a DNS round-robin over two
FOSSGIS machines, and an unhealthy one answers *every* query — including a
three-node bounding box — with `504 Dispatcher_Client::...::timeout`. Measured
within the same minute: `lambert` 200 in 1.7s, `gall` 504 in 6.1s.

`overpass-client.ts` therefore retries, backs off, and fails over across the
endpoint list, and `openstreetmap.ts` runs a ladder of progressively more
tolerant queries on top of it. When touching either:

- **Retry a host only when it answered.** A timeout usually means queueing, not
  failure: Overpass grants two concurrent slots and *holds* further requests
  until one frees, so an over-limit client sees a timeout rather than a 429.
  Retrying that host takes another slot and lengthens the queue. A 5xx is a
  real answer, and retrying it re-rolls the round-robin, which is the point.
- **Share the budget across the endpoints still to be tried.** A primary that
  blackholes connections must not spend the whole deadline; it did, once, and
  two healthy servers went untried.
- **Never let a limit silently disable a feature.** A hardcoded 8s escalation
  reserve and a 4s attempt floor each, at one point, turned off the thing they
  were guarding when the configured budget went below them. Reserves are
  fractions of the budget, and the first attempt always runs.
- **Ask the query to prove the place resolved.** `.searchArea out ids;` emits
  the administrative area alongside the businesses, because Overpass builds its
  area index separately from the main database: a server mid-rebuild answers
  200 with zero elements while its sibling serves the same query normally.
  Without the area in the output, that is indistinguishable from "this city has
  no dentists" — a wrong answer, which is worse than an error. Zero areas
  deprioritises that endpoint rather than ending the search.
- **Use worldwide instances only.** The regional servers (Switzerland, Britain
  and Ireland, Virginia, Ethiopia) answer 200 with zero results for anywhere
  outside their region, which reads as an empty result rather than a failure.

## Security boundaries

- **Authorization** goes through `src/lib/authz.ts`. Never write
  `where: { id, workspaceId }` by hand in a new action; use
  `requireProspectAccess` / `requireProjectAccess` / `requireMessageAccess` /
  `requireVersionAccess`, which load the row and prove access in one call.
- **`process.env` is read in `src/config/app.ts` and nowhere else.** A test
  enforces this. Add the variable to the config module and to `.env.example`,
  with a comment saying what happens when it is absent.
- **Secrets never reach a client component.** No `NEXT_PUBLIC_` prefix on
  anything server-side, and provider views are redacted at the source — see
  `redactConnection` in the Gmail provider, which reports *whether* a refresh
  token exists and never the token.
- **OAuth tokens are encrypted** with `src/lib/crypto.ts`. If
  `TOKEN_ENCRYPTION_KEY` is missing, refuse to store the token. Never fall back
  to plaintext; a silent downgrade is worse than a visible failure.
- **Treat external text as data.** Crawled pages, business records and inbound
  messages go into prompts as facts to use, never as instructions to follow. The
  structural protection is that models have no tools: nothing a model returns
  can send, build or deploy.

## Client/server boundary

A client component must never *value*-import from `src/services/` or `src/db/`.
Those pull in Prisma, and through it `better-sqlite3` and `node:fs`, which
breaks the build with "Can't resolve 'fs'" — and the typechecker will not catch
it, only `npm run build` will. A test now catches it too.

`import type` is fine; it is erased. Shared constants belong in `src/config/`,
and shared view types in `src/types/`.

## Layout

Grid and flex items default to `min-width: auto`, so a child with a long
unbreakable run widens its own track past the container. Invisible at 1440px,
horizontal overflow at 375px. `globals.css` sets `min-width: 0` on grid and flex
children inside `main` at zero specificity; a component that genuinely needs an
intrinsic minimum can set one and win.

The top-left logo links to `/` on every page and every breakpoint. It is not a
menu toggle, it does not go back, and it does not change behaviour by route.

## Before you finish

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Then actually open the app and click through what you changed — including at
375px, where most of the layout bugs are.
