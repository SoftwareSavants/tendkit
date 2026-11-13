import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { Callout, DocsShell, H2, Props } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Customer portal",
  description: "Let customers open and follow their support requests inside your app.",
  alternates: { canonical: "/docs/portal" },
};

const API = `const s = support();
const access = { customerId: user.accountId, userId: user.isAccountAdmin ? null : user.id };

// List and read: only this customer's requests (and only their own, with userId).
await s.portal.list({ ...access, readerId: user.id });
await s.portal.get({ ticketId, ...access, readerId: user.id });

// Open a request: becomes a ticket on portalChannelId; replies also go out by email.
await s.portal.create({
  customerId: user.accountId,
  userId: user.id,
  email: user.email,
  name: user.name,
  locale: user.locale,
  subject,
  text,
});

// Reply from the portal.
await s.portal.reply({ ticketId, customerId: user.accountId, userId: user.id, onlyOwn: !user.isAccountAdmin, email: user.email, name: user.name, text });`;

const PAGES = `"use client";

<SupportPortalProvider client={portalClient} listHref="/support" requestHref={(id) => \`/support/\${id}\`}>
  <SupportRequests newRequestOpen={open} onNewRequestOpenChange={setOpen} />
</SupportPortalProvider>

// app/support/[id]/page.tsx
<SupportPortalProvider client={portalClient} listHref="/support" requestHref={(id) => \`/support/\${id}\`}>
  <SupportRequest id={id} />
</SupportPortalProvider>`;

export default function Portal() {
  return (
    <DocsShell
      href="/docs/portal"
      toc={[
        { id: "how-it-works", title: "How it works" },
        { id: "api", title: "API" },
        { id: "screens", title: "Screens" },
        { id: "ask", title: "The Ask box" },
        { id: "access", title: "Who sees what" },
      ]}
    >
      <H2 id="how-it-works">How it works</H2>
      <p>
        Customers see their requests and your replies, and can open new ones, without leaving your app. A request opened in
        the portal is a ticket like any other: it arrives in the inbox, and your replies also go out by email on{" "}
        <code>portalChannelId</code>, so the customer can answer from their mail client too. Internal notes and automatic
        mail are never shown.
      </p>

      <H2 id="api">API</H2>
      <Code title="Your API" lang="ts" code={API} />

      <H2 id="screens">Screens</H2>
      <Code title="app/support" lang="tsx" code={PAGES} />
      <Props
        rows={[
          { name: "client", type: "SupportPortalClient", required: true, description: "list, get, create, reply and attachmentUrl, backed by your API. Optional: ask, rateAnswer and escalate for the Ask box." },
          { name: "listHref", type: "string", required: true, description: "The requests list." },
          { name: "requestHref", type: "(id) => string", required: true, description: "One request." },
          { name: "t / locale", type: "", description: "As for the agent screens." },
        ]}
      />

      <H2 id="ask">The Ask box</H2>
      <p>
        With <Link href="/docs/ai">AI</Link>, <code>SupportRequests</code> can show an Ask box above the requests (
        <code>SupportAsk</code>, in <code>support-ask.tsx</code>). A customer types a question and gets an answer at
        once, written from your docs, your approved answers and their own account, with its sources and a thumbs-up
        or thumbs-down. When it can&apos;t answer, or the customer asks for a person, it offers to send the question to
        your team as a request that carries what was asked and what was already tried.
      </p>
      <p>
        It appears when the portal client has <code>ask</code> and <code>list()</code> returns <code>ask: true</code>,
        which <code>support.portal.list</code> does once your team has switched instant answers on in AI settings. Add{" "}
        <code>ask</code>, <code>rateAnswer</code> and <code>escalate</code> to your client, backed by{" "}
        <code>support.portal.ask</code>, <code>rateAnswer</code> and <code>escalate</code> with the{" "}
        <code>customerId</code> and <code>userId</code> from your session. See{" "}
        <Link href="/docs/proactive#self-serve">Self-serve in the portal</Link> for the wiring, what it answers from
        and what keeps it safe.
      </p>
      <p>
        Tickets your team starts with <Link href="/docs/proactive#start-a-conversation">New ticket</Link> or sends from
        the Outreach queue show in the customer&apos;s portal like any other, as unread.
      </p>

      <H2 id="access">Who sees what</H2>
      <Callout>
        You decide. Pass <code>customerId</code> to scope everything to one customer account, and <code>userId</code> to
        narrow it further to the requests a person opened. Attachment links go through the same check.
      </Callout>
    </DocsShell>
  );
}
