import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { Callout, DocsShell, H2, Props } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Your directory",
  description: "Tell Tendkit which user and customer a sender belongs to, and who your agents are.",
  alternates: { canonical: "/docs/directory" },
};

const DIRECTORY = `import type { SupportDirectory } from "@/lib/support/service";
import { and, eq, ilike, inArray, sql } from "drizzle-orm";

export const directory: SupportDirectory = {
  async identify({ kind, value }) {
    // value is normalized: lowercase email, or an E.164 phone number.
    const user =
      kind === "email"
        ? await db.query.users.findFirst({ where: sql\`lower(\${users.email}) = \${value}\` })
        : await db.query.users.findFirst({ where: eq(users.phone, value) });
    if (!user) return null;
    return { customerId: user.accountId, userId: user.id, name: user.name, locale: user.locale };
  },

  searchCustomers: (query) =>
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(ilike(accounts.name, \`%\${query}%\`))
      .limit(10),

  getCustomers: (ids) =>
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(inArray(accounts.id, ids)),

  listAgents: () =>
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true))),
};`;

export default function Directory() {
  return (
    <DocsShell
      href="/docs/directory"
      toc={[
        { id: "the-interface", title: "The interface" },
        { id: "example", title: "Example" },
        { id: "unknown-senders", title: "Unknown senders" },
        { id: "trust", title: "Trust" },
      ]}
    >
      <p>
        Tendkit doesn&apos;t keep its own list of customers or agents. The directory answers those questions from your
        database, which is what lets every ticket sit next to the right account.
      </p>

      <H2 id="the-interface">The interface</H2>
      <Props
        rows={[
          {
            name: "identify",
            type: "(identity) => { customerId, userId?, name?, locale? } | null",
            required: true,
            description: "Called for new senders, and for senders not yet linked to a customer. Return null for strangers.",
          },
          { name: "searchCustomers", type: "(query) => { id, name }[]", required: true, description: "Powers the link-to-customer picker and inbox search." },
          { name: "getCustomers", type: "(ids) => { id, name }[]", required: true, description: "Names for the customers shown in the inbox." },
          { name: "listAgents", type: "() => { id, name, email? }[]", required: true, description: "Who can be assigned. The agent id is what your API passes as agentId. With an email, their own email to the support address counts as your team's." },
          { name: "describeCustomer", type: "(customerId) => { label, value, url? }[]", description: <>A few lines about the account (plan, balance, last order), shown in the ticket&apos;s sidebar and used by <Link href="/docs/ai#account-facts">AI</Link>. Only called for tickets linked to a customer.</> },
          { name: "outreachContact", type: "({ customerId, kind }) => { address, name?, locale? } | null", description: <>Who at a customer should hear about a <Link href="/docs/proactive#signals">signal</Link> of this kind, such as the billing contact for a failing payout or the developer for a failing webhook. Without it, or when it returns null or throws, the message goes to the person at the customer who wrote to you last.</> },
        ]}
      />
      <p>
        <code>locale</code> is optional. When you return it, it&apos;s stored on the contact and passed to{" "}
        <code>acknowledgement</code>, so you can answer in the customer&apos;s language.
      </p>

      <H2 id="example">Example</H2>
      <Code title="lib/support/directory.ts" lang="ts" code={DIRECTORY} />

      <H2 id="unknown-senders">Unknown senders</H2>
      <p>
        Mail from an address <code>identify</code> doesn&apos;t know still opens a ticket, marked as an unknown sender. An
        agent links it to a customer once from the ticket. The link is stored on the contact, so that sender&apos;s
        other unlinked tickets and every future message land on the right account.
      </p>

      <H2 id="trust">Trust</H2>
      <Callout title="Spoofed senders are never linked">
        A message that fails DMARC, or fails both SPF and DKIM, isn&apos;t matched to an account even when the address is
        known, gets no automatic reply, and can only thread into a ticket through the reply address token. Account holders
        are never blocked by a spam mark, since a mark may have come from a spoofed message.
      </Callout>
    </DocsShell>
  );
}
