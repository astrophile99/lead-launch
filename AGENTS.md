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

## Client/server boundary

A client component must never import from `src/services/` or `src/db/`. Those
pull in Prisma, and through it `better-sqlite3` and `node:fs`, which breaks the
build with "Can't resolve 'fs'" — and the typechecker will not catch it, only
`npm run build` will. Shared constants belong in `src/config/`.

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

## Before you finish

```bash
npm run typecheck && npm test && npm run build
```

Then actually open the app and click through what you changed.
