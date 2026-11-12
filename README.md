# Tendkit

**[Live demo](https://tendkit.softwaresavants.dev/demo) · [Docs](https://tendkit.softwaresavants.dev/docs)**

Customer support you own. Tendkit is a shared inbox, tickets and a customer portal that you copy into your own app, shadcn-style. There's no hosted service and no package to keep upgrading. The code lives in your repo, reads your own database, and looks like the rest of your product because it uses your components.

- **Native.** The ticket screen shows your customer's account (their orders, payments, plan) from your own database, next to the conversation.
- **Every channel through one interface.** Email via Resend, Microsoft 365, Gmail or any SMTP/IMAP mailbox; SMS and WhatsApp via Twilio; WhatsApp Cloud API; Telegram; and a signed API for your own forms. Adapters use plain `fetch` and WebCrypto, so they run on Cloudflare Workers, Node, Bun and Deno.
- **Correct email.** Replies thread in the customer's mail client. Quoted history is trimmed, including Arabic and French. Out-of-office replies and bounces don't reopen tickets. Copies of the same email collapse into one, and a reply address token keeps threading working when headers are lost.
- **Built for real teams.** It covers assignment, internal notes, "waiting" timers against a response target, spam that blocks the sender, unknown senders you link once, read state per agent, and a portal where customers see their requests.
- **AI when you want it.** Optional, with any [AI SDK](https://ai-sdk.dev) model: every message gets a topic, an urgency and a one-line summary, and the ticket opens with a reply written from your docs for an agent to review. Nothing is sent on its own.
- **Multilingual.** English, French and Arabic, right-to-left included.

## What you get

| Item | What it installs |
|---|---|
| `support` | The core: ticket model, threading, auto-reply detection, the service your API calls (`lib/support`) |
| `support-postgres` | Drizzle schema, a starting migration and the store for Postgres |
| `support-d1` | The same for SQLite and Cloudflare D1 (no transactions needed) |
| `support-ai`, `support-ai-postgres`, `support-ai-d1` | Optional AI: the engine (depends only on `ai`), its tables and store |
| `support-ui` | Inbox, ticket, composer and customer-portal screens (`components/support`) |
| `channel-resend`, `channel-microsoft365`, `channel-gmail`, `channel-smtp`, `channel-twilio`, `channel-whatsapp`, `channel-telegram`, `channel-api` | One adapter each |

## Install

Tendkit targets Next.js (App Router), Tailwind 4, shadcn/ui, TanStack Query and Drizzle. Other stacks work by editing the copied code, which is yours.

1. Add the registry to `components.json`:

   ```json
   { "registries": { "@tendkit": "https://tendkit.softwaresavants.dev/r/{name}.json" } }
   ```

2. Add the pieces you need:

   ```bash
   npx shadcn add @tendkit/support @tendkit/support-postgres @tendkit/support-ui @tendkit/channel-resend
   ```

   In a monorepo, install server and UI items where they belong: run with `--cwd packages/api` for the server items and `--cwd apps/web` for `support-ui`. Then fix the few imports that cross packages.

3. Add the schema to your Drizzle schema and generate a migration. `lib/support/postgres/0000_init.sql` is the reference.

4. Wire it up. Create the service once per request:

   ```ts
   import { createSupport } from "@/lib/support/service";
   import { createPostgresStore } from "@/lib/support/postgres/store";
   import { resendChannel } from "@/lib/support/channels/resend";

   export const support = createSupport({
     store: createPostgresStore(db),
     storage, // put / get / signed url: S3, R2, Supabase Storage…
     channels: [resendChannel({ id: "email", apiKey, webhookSecret, address: "support@acme.com", replyAddress: "support@in.acme.com" })],
     directory, // who is this email? which customer? who are the agents?
     notify, // email your team
     acknowledgement: () => ({ text: "Thanks — we've received your message and will reply to this email." }),
     fromName: "Acme Support",
   });
   ```

   - **Webhooks:** route `POST /api/webhooks/support/[channel]` to `support.handleWebhook(channel, request)`.
   - **Scheduled job:** call `support.runScheduled()` every few minutes. It polls mailboxes and renews subscriptions.
   - **API:** expose the agent and portal methods through your own API layer, behind your own auth. Pass them to `<SupportProvider>` / `<SupportPortalProvider>` as a client.

Tendkit runs in production at [Moosyl](https://moosyl.com) (Postgres on Supabase, Next.js on Workers) and [Moorsyl](https://moorsyl.com) (Cloudflare D1, R2 and Hono). In both, customers are organizations, agents are the team's admins, and an oRPC router exposes the service.

## Upgrading

Copied code doesn't update itself. To take a fix:

1. Run `npx shadcn add @tendkit/<item> --diff` to see what changed upstream.
2. Apply what you want.

Keep your own changes out of the engine files (`service.ts`, `text.ts`, `channels/*`) where you can. Put them in your directory, notifier and UI wrappers instead, so diffs stay small.

## Develop

```bash
pnpm install
pnpm typecheck   # browser and server (no DOM) builds
pnpm test        # core on Postgres (PGlite) and SQLite/D1, adapters against recorded provider payloads
pnpm registry:build
```

## Contributing

Adapters, translations and email-trimming fixes are the easiest way in. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT
