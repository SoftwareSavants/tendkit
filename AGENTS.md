# Working on Tendkit

Tendkit is an open-source (MIT) customer support kit distributed as a **shadcn registry**: a shared inbox, tickets, a customer portal and channel adapters that people copy into their own apps with the shadcn CLI. There's no hosted service and no npm package. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [PRODUCT.md](PRODUCT.md) (design context) too.

- **Repo:** https://github.com/SoftwareSavants/tendkit (public)
- **Site:** https://tendkit.softwaresavants.dev (landing page, docs, live demo, and the registry at `/r`)
- **In production at:** Moosyl (Postgres) and Moorsyl (Cloudflare D1). Each keeps its own copy; see "Shipping a change to the apps" below.

## Layout

| Path | What |
|---|---|
| `registry/support/` | The engine: `service.ts` (`createSupport`), `store.ts`, `channel.ts`, `types.ts`, `text.ts` (reply trimming, signatures, automated-mail detection), `address.ts` |
| `registry/support/insights.ts`, `postgres/stats.ts`, `d1/stats.ts` | Insights: `insights.ts` holds the model-free and database-free parts (the shapes, the percentile both stores share, the daily series and backlog, the spike detector `usualVolume` and `isSpike`) and says how each number is defined. `stats.ts` holds the aggregate queries behind `support.stats()`, the same file in each dialect apart from four helpers at the top. Nothing is tracked or rolled up: every number is computed from tickets, messages and events through the indexes in `0005_insights.sql` (core, shipped with the store items), and percentiles are ranked in SQL so a distribution comes back as four rows. With AI, `ai.ts` adds `ai.insights()`, `detectSpikes` (run last in `runScheduled`), `listSpikes` and `acknowledgeSpike`; their queries are in the AI stores and their table and index in `0006_insights_ai.sql`. The screen is `support-ui/support-insights.tsx` (hand-rolled SVG charts, `SpikeAlerts` also mounted in the inbox). |
| `registry/support/postgres/`, `registry/support/d1/` | Drizzle schema, migration and store for each database. D1 has no transactions: its store deletes what it created if a later write fails. |
| `registry/support/channels/` | One file per adapter: resend, microsoft365, gmail, smtp (+ `mime.ts`), twilio, whatsapp, telegram, api, plus `crypto.ts` |
| `registry/support/ai.ts`, `ai-store.ts`, `knowledge.ts`, `memory.ts`, `actions.ts`, `autopilot.ts` | Optional AI ("Copilot"): `supportAi()` plugs into `createSupport({ ai })`. Triage, suggested replies, refine, knowledge sync, memory (approved answers, lessons from edited drafts, guidance suggestions, gaps, articles) and actions (`supportAi({ actions })`: lookups run while drafting as AI SDK tools; changes are only ever proposed by the model and run through `ai.runAction` with an agent's id, for the ticket's own customer; `actions.ts` holds the model-free parts: the form built from a schema, the timeout, run states). `ai.ts` is the only file that imports the `ai` package; `service.ts` never does. `memory.ts` holds the model-free parts, including `safeLesson`, the check that keeps one customer's details out of another's draft. Autopilot (`supportAi({ autopilot })`) sends replies on topics the team switched on: `autopilot.ts` holds the model-free parts (`editWeight`, `trackRecord`, `isEligible`, `autopilotBlock`, the guard a reply passes), `ai.ts` plans and sends (`planAutopilot`, `deliver`, `runAutopilot`), and `service.ts` exposes the one unattended send path to it (`sendUnattended`). A topic is only ever switched on by `setAutopilotTopic` with an agent's id, and only when eligible; any failure leaves the draft to a person. Stores and migrations are `postgres/ai-*` and `d1/ai-*` (`0001_ai.sql`, `0002_memory.sql`, `0003_actions.sql`, `0004_autopilot.sql`, `0007_proactive.sql`, `0008_outreach_record.sql`; migrations are generated with `drizzle-kit generate` and `--config drizzle.d1.config.ts`, and 0004 ends with two hand-written backfill statements). Model calls never run inside a store transaction. |
| `registry/support/proactive.ts` | Proactive and self-serve, the model-free and database-free parts, shipped with the core item: what a signal is and when one is left unsent (`signalDecision`, `PROACTIVE_DEFAULTS`), `validKind`, `personalise` for a broadcast's {name} and {company}, and the checks a portal answer passes (`looksLikeInjection`, `revealsInternal`, `handoffNote`, `SELF_SERVE_DEFAULTS`). `service.ts` holds writing first (`startTicket`, `openConversation`, `listChannels`, `listContacts`, `signal`, `portal.ask`, `rateAnswer`, `escalate`) and `channel.ts` the capability behind it (`canStartConversation`, `startBlockedReason`). `ai.ts` does the rest: `signal` and `recipientFor`, `draftOpening`, the Outreach queue (`listOutreach`, `sendOutreach`, `dismissOutreach`, `holdOutreach`), kinds that send on their own (`planOutreach`, `deliverOutreach`, `runProactive`, `getOutreachKinds`, `setOutreachKind`, `flagOutreach`; a kind's record is read through `outreachOutcome` in `autopilot.ts`, hears of an unhappy answer through `noteFollowUp`, and Autopilot's kill switch stops it), incident broadcast (`previewBroadcast`, `draftBroadcast`, `sendBroadcast`, one message per spike and customer by a unique index) and the Ask box (`ask`, answering only for the customer the service passed). Tables and the `self_serve` setting are in `0007_proactive.sql`, and a kind's record after sending (follow-up, flags, pause reason) in `0008_outreach_record.sql` (AI stores). |
| `registry/support-ui/` | The screens: inbox, ticket, composer, link-customer dialog, portal (`support-requests.tsx`), the AI parts (`ai.tsx`, `support-ai-settings.tsx`, `memory.tsx` with the approved-answer and article dialogs and the reply box's "/" picker, `actions.tsx` with the proposed-action cards and the run dialog, `autopilot.tsx` with the readiness view, the held reply, the "Sent by Autopilot" mark and `OutreachMark`, the same flag on a message outreach sent on its own, and `voice.tsx`, the reply box's voice mode; all shown only when the client has `ai`, and each memory part only when the client has its method), the proactive parts (`new-ticket-dialog.tsx` with `NewTicketDialog` and `NewTicketButton`, shown when the client has `startTicket`; `outreach.tsx` with `OutreachQueue`, the inbox's Outreach tab, `OutreachKinds` inside AI settings and `BroadcastDialog` behind a spike's "Message customers"; `support-ask.tsx` with `SupportAsk`, the portal's Ask box, shown when the portal client has `ask` and `list()` says so), `provider.tsx`, `client.ts` (the `SupportClient` contract), `messages/en.json` |
| `registry.json` → `public/r/` | Registry items, built by `pnpm registry:build`. **Commit `public/r`**; CI fails if it's stale. |
| `tests/` | Vitest. The service, AI, memory, actions, autopilot, insights and proactive suites run on PGlite and again on SQLite/D1 (`TENDKIT_STORE=d1`); `ai-helpers.ts` has the scripted model they share. AI tests use the AI SDK's mock model (`ai/test`). Adapters are tested against recorded payloads. |
| `app/(site)/`, `site/` | The website (Next.js static export). `site/docs/nav.ts` drives the docs sidebar, prev/next and ⌘K search; adapter docs pages are generated from `site/docs/channels-data.tsx`. |
| `site/demo-client.ts` | The demo's in-browser backend (agent and portal clients sharing one state). `app/demo-frame/` is the app inside the demo's iframe. |
| `site/wall.tsx` | The home page's wall of working cards. |
| `site/theme*.ts(x)` | Theme presets (color, radius, font, mode) applied to `<html>`; `globals.css` derives every token from `--hue`. |

## Commands

```bash
pnpm install
pnpm typecheck        # strict check (tsconfig.check.json) + server build without DOM (tsconfig.server.json)
pnpm test             # Postgres (PGlite) then D1 (node:sqlite)
pnpm registry:build   # rebuild public/r after any change under registry/ or to registry.json
pnpm build            # the site (static export to out/)
pnpm run deploy:site  # build + wrangler deploy to tendkit.softwaresavants.dev
```

`pnpm deploy` is a pnpm built-in that silently does something else: always use `pnpm run deploy:site`. The site deploys to the Software Savants Cloudflare account (see `wrangler.jsonc`); wrangler is already logged in on the maintainer's machine.

Before calling any change done: `pnpm typecheck`, `pnpm test`, `pnpm registry:build` (commit `public/r`), `pnpm build`. If you changed the site, look at it in light and dark, at 375px, and in a real browser.

## Rules that matter

- **The registry is copied into people's apps.** Keep `registry/` dependency-light, readable and runtime-agnostic: adapters use only `fetch` and WebCrypto (Workers, Node, Bun, Deno). Verify every webhook signature.
- **The screens must work with Radix and Base UI shadcn projects** (shadcn's default is now Base UI, `base-nova`). Use only APIs both share:
  - menu items use `onClick`, never `onSelect`;
  - `SelectValue` gets its label as children;
  - menus that should close on choice are controlled (`open` and `onOpenChange`);
  - no `asChild` inside `registry/support-ui`.
  Run the end-to-end install test (below) after changing the screens.
- **Registry dependencies are full URLs** (`https://tendkit.softwaresavants.dev/r/<item>.json`), so installs work without a `components.json` registry entry.
- **Untrusted input stays untrusted.** Messages with `source: "api"` (the signed API channel, contact forms) or that fail DMARC (or both SPF and DKIM) never link to an account and never get an acknowledgement. Account holders are never blocked by a spam mark.
- **Worldwide examples only.** Site copy, demo data, docs snippets, test fixtures and comments use invented international names: Emma Clarke at Northwind Coffee, Acme, Priya Patel, Daniel Kim, `.test` domains, +1 415 555 01xx numbers, USD. No local or real names.
- **Claims must match the code.** Every option, default and behaviour on the site and in the docs is checked against `registry/`. When behaviour changes, update `site/docs/*`, `site/docs/channels-data.tsx`, `public/llms.txt` and the README.
- **Copy style:** plain, exact, no hype. No em dashes. Every UI element earns its place.
- **Design:** native to shadcn/ui (neutral by default, components as the hero). See PRODUCT.md.

## Testing an install end to end

This is how the Base UI bugs were found:

```bash
npx create-next-app@latest acme --ts --tailwind --app --no-eslint --no-src-dir --import-alias "@/*" --use-pnpm --yes
cd acme && npx shadcn@latest init -d -y --no-monorepo            # Base UI (base-nova)
#  or:   npx shadcn@latest init -t next -b radix -p nova -y --no-monorepo   # Radix (radix-nova)
R=https://tendkit.softwaresavants.dev/r
npx shadcn@latest add $R/support.json $R/support-postgres.json $R/support-ui.json $R/channel-resend.json -y --overwrite
npx next typegen && npx tsc --noEmit && pnpm build
```

Then mount the screens with the demo client (copy `site/demo-client.ts`, changing its import to `@/components/support/client`), and click through: the assignee filter label, "…" → Change customer, the status and assignee menus, and a reply. To exercise the engine itself, run it on PGlite with the copied `lib/support/postgres/0000_init.sql`.

## Shipping a change to the apps

Each app has its own copy, adapted to its stack. Change Tendkit first, test, rebuild the registry, then copy the changed files:

- **Moosyl:** the repo at `~/Desktop/SoftwareSavants/Products/Moosyl/moosyl` (worktrees under `.verun/worktrees/`). Its copies are in `packages/api/src/support/` (core, Postgres store, Resend channel) and `apps/web/components/support/` (Radix). Its wiring lives in `moosyl.ts` and `router/support.ts`. Push straight to `main`.
- **Moorsyl:** the repo at `~/Desktop/SoftwareSavants/Products/Moorsyl/moorsyl`. Its copies are in `packages/api/src/support/` (core, D1 store, Resend channel) and `apps/web/src/components/support/` (Base UI, with square corners and typed-route casts). Its wiring lives in `moorsyl.ts` and `routers/support.ts`. Changes go through a PR to `main`.

Diff a copied file against `registry/` before overwriting it: the apps' UI copies carry small local adaptations.

## Status and open threads

- **shadcn registry directory:** PR shadcn-ui/ui#12646 adds `@tendkit` (from the fork `iabdousd/ui`). Once merged, `npx shadcn add @tendkit/support` works without any configuration.
- **Good first issues #1 to #7:** adapters for Postmark, SES, SendGrid, Mailgun, Slack and Discord, and translations.
- **Not done yet:** buying tendkit.dev; a CI job that runs the end-to-end install test; a launch (Show HN and similar).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
