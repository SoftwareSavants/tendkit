import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell, H2 } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Introduction",
  description: "Tendkit is an open-source customer support inbox you copy into your own app with the shadcn CLI.",
  alternates: { canonical: "/docs" },
};

const ITEMS = [
  ["support", "The engine: tickets, threading, automatic-mail detection, notifications and the service your API calls."],
  ["support-postgres", "Drizzle schema, migration and store for Postgres."],
  ["support-d1", "The same for SQLite and Cloudflare D1, without transactions."],
  ["support-ai-*", "Optional AI: triage, summaries and suggested replies, with any AI SDK model."],
  ["support-ui", "The inbox, ticket, composer, customer linking and customer portal screens."],
  ["channel-*", "One adapter per provider: Resend, Microsoft 365, Gmail, SMTP/IMAP, Twilio, WhatsApp, Telegram and a signed API."],
];

export default function Introduction() {
  return (
    <DocsShell
      href="/docs"
      toc={[
        { id: "what-you-get", title: "What you get" },
        { id: "how-it-works", title: "How it works" },
        { id: "principles", title: "Principles" },
        { id: "requirements", title: "Requirements" },
        { id: "in-production", title: "In production" },
      ]}
    >
      <p>
        Tendkit is a customer support inbox you own. Customer emails, WhatsApp, SMS and Telegram messages become tickets
        that your team answers inside your own app, right next to the customer&apos;s account. There&apos;s no hosted
        service and no package to upgrade: the shadcn CLI copies the code into your repo, where it reads your database and
        renders with your components.
      </p>

      <H2 id="what-you-get">What you get</H2>
      <p>Tendkit is a shadcn registry. Add the items you need:</p>
      <div className="my-6 overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <tbody className="divide-y">
            {ITEMS.map(([name, what]) => (
              <tr key={name} className="align-top">
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <code className="font-mono text-[0.85em] font-medium">{name}</code>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="how-it-works">How it works</H2>
      <ul>
        <li>
          <strong>Channels</strong> translate a provider&apos;s webhooks and API into events: a message came in, a reply
          was delivered. Each one is a single file using only <code>fetch</code> and WebCrypto.
        </li>
        <li>
          <strong>The service</strong> (<code>createSupport</code>) turns events into tickets: it threads replies, detects
          out-of-office mail, links senders to your customers, sends acknowledgements and notifies your team.
        </li>
        <li>
          <strong>Your directory</strong> is the only product-specific part: it says which user and customer an address
          belongs to, and who your agents are.
        </li>
        <li>
          <strong>The screens</strong> talk to the service through your own API, behind your own auth. They take a{" "}
          <code>customerPanel</code> so every ticket shows your data next to the conversation.
        </li>
      </ul>

      <H2 id="principles">Principles</H2>
      <ul>
        <li>
          <strong>Yours.</strong> The code lives in your repo and your data in your database. Change anything.
        </li>
        <li>
          <strong>Runs anywhere.</strong> The engine and adapters run on Cloudflare Workers, Node, Bun and Deno.
        </li>
        <li>
          <strong>Correct email.</strong> Replies thread in the customer&apos;s mail client, quoted history and signatures
          are trimmed, and automatic mail never reopens a ticket. See <Link href="/docs/email">Email setup</Link>.
        </li>
        <li>
          <strong>Safe by default.</strong> Webhooks are verified, spoofed senders aren&apos;t linked to accounts, and HTML
          email renders sanitized in a sandboxed frame.
        </li>
      </ul>

      <H2 id="requirements">Requirements</H2>
      <p>
        Next.js with the App Router, Tailwind CSS 4, shadcn/ui, TanStack Query and Drizzle ORM with Postgres or
        SQLite/D1. Other stacks work by editing the copied code: the engine has no framework code at all.
      </p>

      <H2 id="in-production">In production</H2>
      <p>
        Tendkit runs at <a href="https://moosyl.com">Moosyl</a> (Postgres on Supabase, Next.js on Cloudflare Workers) and{" "}
        <a href="https://moorsyl.com">Moorsyl</a> (Cloudflare D1, R2 and Hono). Next:{" "}
        <Link href="/docs/installation">install it</Link>.
      </p>
    </DocsShell>
  );
}
