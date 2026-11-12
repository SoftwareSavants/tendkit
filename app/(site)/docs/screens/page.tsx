import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { Callout, DocsShell, H2, Props } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Inbox and tickets",
  description: "Mount the support inbox and ticket screens behind your own API and auth.",
  alternates: { canonical: "/docs/screens" },
};

const API = `// app/api/support/[...path]/route.ts, or your oRPC/tRPC router: anything behind your auth.
import { support } from "@/lib/support";
import { requireAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  const agent = await requireAdmin(request);
  const { action, input } = await request.json();
  const s = support();
  switch (action) {
    case "listTickets":
      return Response.json(
        await s.listTickets(
          {
            status: input.status,
            assigneeId: input.assignee === "me" ? agent.id : input.assignee,
            search: input.search,
            sort: input.status === "open" ? "waiting" : "recent",
            limit: input.pageSize,
            offset: (input.page - 1) * input.pageSize,
          },
          agent.id
        )
      );
    case "getTicket":
      return Response.json(await s.getTicket(input.id, agent.id));
    case "reply":
      return Response.json(await s.reply({ ...input, agentId: agent.id }));
    // …addNote, assign, setStatus, linkCustomer, changeContact, retry, uploadAttachment, attachmentUrl
  }
}`;

const CLIENT = `"use client";

import type { SupportClient } from "@/components/support/client";

const call = (action: string, input?: unknown) =>
  fetch("/api/support", { method: "POST", body: JSON.stringify({ action, input }) }).then((r) => r.json());

export const supportClient: SupportClient = {
  listTickets: (query) => call("listTickets", query),
  counts: () => call("counts"),
  getTicket: (id) => call("getTicket", { id }),
  reply: (input) => call("reply", input),
  addNote: (input) => call("addNote", input),
  assign: (input) => call("assign", input),
  setStatus: (input) => call("setStatus", input),
  linkCustomer: (input) => call("linkCustomer", input),
  changeContact: (input) => call("changeContact", input),
  retry: (input) => call("retry", input),
  upload: ({ ticketId, file }) => uploadFile(ticketId, file),
  attachmentUrl: (input) => call("attachmentUrl", input),
  listAgents: () => call("listAgents"),
  searchCustomers: (query) => call("searchCustomers", { query }),
};`;

const PAGES = `// app/admin/support/layout.tsx
"use client";

import { SupportProvider } from "@/components/support/provider";
import { supportClient } from "./client";

export default function Layout({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  return (
    <SupportProvider
      client={supportClient}
      viewerId={user.id}
      inboxHref="/admin/support"
      ticketHref={(id) => \`/admin/support/\${id}\`}
      customerPanel={(detail) => (detail.customer ? <AccountPanel id={detail.customer.id} /> : null)}
    >
      {children}
    </SupportProvider>
  );
}

// app/admin/support/page.tsx
export default function Page() {
  return <SupportInbox />;
}

// app/admin/support/[id]/page.tsx
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SupportTicket ticketId={id} />;
}`;

export default function Screens() {
  return (
    <DocsShell
      href="/docs/screens"
      toc={[
        { id: "expose-the-api", title: "Expose the API" },
        { id: "implement-the-client", title: "Implement the client" },
        { id: "mount-the-screens", title: "Mount the screens" },
        { id: "provider-props", title: "Provider props" },
        { id: "ai", title: "AI" },
        { id: "translations", title: "Translations" },
      ]}
    >
      <p>
        The screens never talk to the database. They call a <code>SupportClient</code> you implement on top of your own
        API, so your auth decides who&apos;s an agent. TanStack Query must be set up in your app (a{" "}
        <code>QueryClientProvider</code> above the screens).
      </p>

      <H2 id="expose-the-api">Expose the API</H2>
      <p>Any API layer works: route handlers, server actions, oRPC, tRPC. Check the agent, then call the service:</p>
      <Code title="app/api/support/route.ts" lang="ts" code={API} />

      <H2 id="implement-the-client">Implement the client</H2>
      <Code title="app/admin/support/client.ts" lang="ts" code={CLIENT} />
      <p>Dates may arrive as <code>Date</code> objects or ISO strings; the screens accept both.</p>

      <H2 id="mount-the-screens">Mount the screens</H2>
      <Code title="app/admin/support" lang="tsx" code={PAGES} />

      <H2 id="provider-props">Provider props</H2>
      <Props
        rows={[
          { name: "client", type: "SupportClient", required: true, description: "Your implementation, above." },
          { name: "viewerId", type: "string", required: true, description: "The signed-in agent's id, as listAgents returns it." },
          { name: "inboxHref", type: "string", required: true, description: "Where the ticket screen's back link goes." },
          { name: "ticketHref", type: "(id) => string", required: true, description: "The URL of a ticket." },
          { name: "customerPanel", type: "(detail) => ReactNode", description: "Your own component next to every ticket. For a plain list of account details, return them from your directory's describeCustomer instead." },
          { name: "responseTargetMinutes", type: "number", default: "240", description: "How long a customer may wait before the wait turns red. It turns amber at three quarters." },
          { name: "t", type: "(key, values) => string", default: "English", description: "Translations. See below." },
          { name: "locale", type: "string", default: '"en"', description: "For dates and numbers." },
        ]}
      />
      <Callout title="Try the props">
        The <Link href="/demo">demo</Link> lets you change the theme, the response target and the account panel live.
      </Callout>

      <H2 id="ai">AI</H2>
      <p>
        Add an <code>ai</code> object to the client and the screens gain an inbox sorted by urgency with one-line
        summaries, suggested replies with their sources, rewrite controls in the reply box, translation, and the{" "}
        <code>SupportAiSettings</code> screen. Without it, none of that renders. See <Link href="/docs/ai#screens">AI</Link>.
      </p>

      <H2 id="translations">Translations</H2>
      <p>
        Every string lives in <code>components/support/messages/en.json</code>. With next-intl, add that file to your
        messages under a <code>support</code> namespace and pass <code>useTranslations(&quot;support&quot;)</code> as{" "}
        <code>t</code>. Without an i18n library, call <code>createTranslator(messages)</code> with your own copy. The screens
        support right-to-left languages.
      </p>
    </DocsShell>
  );
}
