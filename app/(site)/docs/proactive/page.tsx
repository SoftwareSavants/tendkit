import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { Callout, DocsShell, H2, H3, Props } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Proactive and self-serve",
  description:
    "Write to a customer before they ask, tell every customer an incident affects on one approval, and let the portal answer questions from your docs and the customer's own account.",
  alternates: { canonical: "/docs/proactive" },
};

const START = `// In your agent API. The signed-in agent is who writes.
const { ticket, message } = await support().startTicket({
  to: { address: "emma@northwind.test", name: "Emma Clarke" }, // or { contactId }
  cc: [{ address: "priya@northwind.test" }],
  subject: "About your payout schedule",
  text: "Hi Emma, we noticed your payout schedule changed.",
  agentId: agent.id,
});`;

const START_API = `case "startTicket": {
  // Never take agentId from the request body.
  const { ticket } = await s.startTicket({ ...input, agentId: agent.id });
  return Response.json({ ticketId: ticket.id });
}
case "listChannels":
  return Response.json(await s.listChannels());
case "listContacts":
  return Response.json(await s.listContacts(input)); // { customerId?, search? }
case "uploadForNewTicket": {
  // file: the File from your multipart upload
  return Response.json(
    await s.uploadAttachment({
      ticketId: null, // a file for a conversation that doesn't exist yet
      filename: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      uploadedBy: agent.id,
    })
  );
}

// With AI:
case "ai.draftOpening":
  return Response.json(await s.ai.draftOpening(input)); // { intent, customerId?, contactId?, channelId? }`;

const SIGNAL = `// Wherever your product notices it: a job, a webhook handler, a nightly check.
const result = await support().signal({
  customerId: "cus_northwind",
  kind: "payouts_failing",
  title: "Payouts have failed 3 times since Monday",
  facts: [
    { label: "Failed payouts", value: "3 since Monday" },
    { label: "Bank's reason", value: "Account closed", url: "https://acme.test/admin/payouts?customer=cus_northwind" },
  ],
  dedupeKey: "payouts_failing:cus_northwind:2026-11-09",
  // to: { address: "priya@northwind.test", name: "Priya Patel" },
});

// { status: "proposed", outreachId }
// { status: "duplicate", outreachId }
// { status: "suppressed", reason }`;

const OPTIONS = `supportAi({
  model,
  store,
  knowledge: [docs],
  // Every value is optional. These are the defaults.
  proactive: {
    dedupeHours: 168,        // a customer hears about one kind once in 7 days
    maxPerCustomerPerDay: 2, // across kinds
    maxPerHour: 60,          // signals turned into proposals, across customers
    minDrafts: 10,           // decided proposals a kind needs before it can send on its own
    minRate: 0.9,            // share of them sent as drafted or lightly edited
    windowDays: 90,          // how far back a kind's track record looks
    holdMinutes: 10,         // how long a message that sends on its own waits first
    maxAutoPerHour: 20,      // messages nobody read first, across kinds
    // autoSend: false,                              // removes the per-kind switch
    // signature: ({ language }) => "Acme Support",  // what an unattended message signs with
  },
  selfServe: { maxPerHour: 20, maxQuestions: 8, quietHours: 24 },
});`;

const OUTREACH_API = `case "ai.listOutreach":
  return Response.json(await s.ai.listOutreach(input)); // { sent?: boolean }
case "ai.sendOutreach":
  // The signed-in agent is the approval. Never take actorId from the request body.
  return Response.json(await s.ai.sendOutreach({ ...input, actorId: agent.id }));
case "ai.dismissOutreach":
  return Response.json(await s.ai.dismissOutreach({ ...input, actorId: agent.id }));
case "ai.holdOutreach":
  return Response.json(await s.ai.holdOutreach({ ...input, actorId: agent.id }));
case "ai.flagOutreach":
  return Response.json(await s.ai.flagOutreach({ ...input, actorId: agent.id })); // { id, note? }
case "ai.getOutreachKinds":
  return Response.json(await s.ai.getOutreachKinds());
case "ai.setOutreachKind":
  return Response.json(await s.ai.setOutreachKind({ ...input, actorId: agent.id }));`;

const BROADCAST = `const s = support();

// Who it would go to. Nothing is sent.
const preview = await s.ai.previewBroadcast({ spikeId });
// { topic, channel, recipients: [{ customer, contact, ticket }], skipped: { unlinked, alreadyMessaged, unreachable } }

// Optional: a draft from one line.
const draft = await s.ai.draftBroadcast({ spikeId, intent: "Card payments are slow to confirm. Nothing is lost. We'll write again when it's fixed." });

// One approval. Each customer gets their own ticket.
const result = await s.ai.sendBroadcast({
  spikeId,
  subject: "Card payments are delayed",
  text: "Hi {name},\n\nCard payments for {company} have been slow to confirm since 09:40 UTC. No payment is lost. We are working on it and will write again when it is fixed.",
  actorId: agent.id,
});
// { recipients: 34, sent: 20, queued: 14, failed: 0 }`;

const BROADCAST_API = `case "ai.previewBroadcast":
  return Response.json(await s.ai.previewBroadcast(input)); // { spikeId }
case "ai.draftBroadcast":
  return Response.json(await s.ai.draftBroadcast(input)); // { spikeId, intent }
case "ai.sendBroadcast":
  // The signed-in agent is the approval. Never take actorId from the request body.
  return Response.json(await s.ai.sendBroadcast({ ...input, actorId: agent.id }));`;

const ASK_API = `// Your portal API. Who is asking comes from your session, never from the request.
const s = support();
const who = { customerId: user.accountId, userId: user.id };

switch (action) {
  case "list":
    // Now also returns ask: true when your team switched instant answers on.
    return Response.json(await s.portal.list({ ...who, readerId: user.id }));
  case "ask":
    return Response.json(await s.portal.ask({ ...who, question: input.question, sessionId: input.sessionId }));
  case "rateAnswer":
    return Response.json(await s.portal.rateAnswer({ ...who, sessionId: input.sessionId, helpful: input.helpful }));
  case "escalate":
    return Response.json(
      await s.portal.escalate({ ...who, email: user.email, name: user.name, locale: user.locale, sessionId: input.sessionId, text: input.text })
    );
}`;

const ASK_CLIENT = `export const portalClient: SupportPortalClient = {
  // …list, get, create, reply, attachmentUrl
  ask: (input) => call("ask", input),
  rateAnswer: (input) => call("rateAnswer", input),
  escalate: (input) => call("escalate", input),
};`;

const ASK_RESULT = `type AskResult =
  | { sessionId: string; kind: "answer"; text: string; sources: SuggestionSource[] }
  | { sessionId: string | null; kind: "handoff"; reason: "cannot_answer" | "asked_for_human" | "blocked" | "limit" };`;

const PORTAL_LOOKUP = `supportAction({
  name: "last_invoice",
  title: "Look up last invoice",
  description: "The customer's most recent invoice and whether it's paid.",
  input: z.object({}),
  approval: "never",
  portal: true, // the Ask box may run it, for the signed-in customer only
  // In the portal there is no ticket yet: ticket and contact are null.
  run: async ({ customer }) => {
    const invoice = await billing.lastInvoice(customer.id);
    if (!invoice) return { ok: true, summary: "No invoices yet." };
    return { ok: true, summary: \`Invoice \${invoice.number} for \${invoice.total}, \${invoice.status}\` };
  },
}),`;

const CLIENT = `export const supportClient: SupportClient = {
  // …
  startTicket: (input) => call("startTicket", input),
  listChannels: () => call("listChannels"),
  listContacts: (input) => call("listContacts", input),
  uploadForNewTicket: ({ file }) => uploadFile(null, file),
  ai: {
    // …
    draftOpening: (input) => call("ai.draftOpening", input),
    listOutreach: (input) => call("ai.listOutreach", input),
    sendOutreach: (input) => call("ai.sendOutreach", input),
    dismissOutreach: (input) => call("ai.dismissOutreach", input),
    holdOutreach: (input) => call("ai.holdOutreach", input),
    flagOutreach: (input) => call("ai.flagOutreach", input),
    getOutreachKinds: () => call("ai.getOutreachKinds"),
    setOutreachKind: (input) => call("ai.setOutreachKind", input),
    previewBroadcast: (input) => call("ai.previewBroadcast", input),
    draftBroadcast: (input) => call("ai.draftBroadcast", input),
    sendBroadcast: (input) => call("ai.sendBroadcast", input),
  },
};`;

const RULES: { result: string; when: React.ReactNode }[] = [
  {
    result: "duplicate",
    when: (
      <>
        The same <code>dedupeKey</code> was reported before, or a proposal of this kind already waits for this customer.
        Comes with that proposal&apos;s <code>outreachId</code> when there is one.
      </>
    ),
  },
  {
    result: "recently_contacted",
    when: (
      <>
        The customer got a message of this kind within <code>dedupeHours</code>.
      </>
    ),
  },
  {
    result: "awaiting_reply",
    when: (
      <>
        The last message of this kind went out within four times <code>dedupeHours</code>, its ticket is still Waiting
        and the customer hasn&apos;t written back.
      </>
    ),
  },
  {
    result: "dismissed",
    when: (
      <>
        An agent dismissed a proposal of this kind for this customer within <code>dedupeHours</code>.
      </>
    ),
  },
  {
    result: "customer_limit",
    when: (
      <>
        The customer already has <code>maxPerCustomerPerDay</code> proposals or messages from signals in the last 24
        hours, across kinds. Dismissed ones don&apos;t count.
      </>
    ),
  },
  {
    result: "rate_limited",
    when: (
      <>
        <code>maxPerHour</code> signals became proposals in the last hour, across customers. A runaway job in your
        product stops here.
      </>
    ),
  },
  {
    result: "no_contact",
    when: (
      <>
        Nobody at the customer has an address on a channel that can write first, or the address named belongs to
        another customer&apos;s person or to someone blocked.
      </>
    ),
  },
  {
    result: "unavailable",
    when: (
      <>
        AI isn&apos;t configured, <code>proactive</code> is <code>false</code>, or <code>0007_proactive.sql</code>{" "}
        isn&apos;t applied.
      </>
    ),
  },
];

export default function Proactive() {
  return (
    <DocsShell
      href="/docs/proactive"
      toc={[
        { id: "start-a-conversation", title: "Start a conversation" },
        { id: "signals", title: "Signals and the Outreach queue" },
        { id: "sending-on-its-own", title: "Sending on its own" },
        { id: "broadcast", title: "Incident broadcast" },
        { id: "self-serve", title: "Self-serve in the portal" },
        { id: "deflection", title: "Deflection in Insights" },
        { id: "store", title: "Store and migration" },
        { id: "screens", title: "Screens and client methods" },
      ]}
    >
      <p>
        The best ticket is the one a customer never has to write. Your product already knows when a payout fails, a
        webhook keeps erroring or a document is about to expire. Tendkit turns that into a message your team sends
        first, and when an incident hits many customers at once, one approval tells each of them.
      </p>
      <p>
        For the questions customers do have, the portal can answer at once: from your docs, your approved answers and
        the asking customer&apos;s own account. When it can&apos;t answer, it hands the conversation to your team as a
        ticket instead of guessing. Starting a conversation works without AI; everything else on this page needs{" "}
        <Link href="/docs/ai">AI</Link> and the <code>0007_proactive.sql</code> migration.
      </p>

      <H2 id="start-a-conversation">Start a conversation</H2>
      <p>
        <code>support.startTicket</code> opens a ticket by writing to the customer, instead of waiting for them to
        write. It returns the ticket and the message.
      </p>
      <Code title="Your API" lang="ts" code={START} />
      <ul>
        <li>
          The ticket opens as Waiting on customer, assigned to the agent, with a <code>ticket_started</code> event on
          the timeline. No <code>ticket.created</code> notification and no acknowledgement go out: your team wrote it.
        </li>
        <li>
          The message takes the same path as a reply: the agent&apos;s signature on email, the Reply-To token, delivery
          tracking. The customer&apos;s answer threads into the ticket by its headers or by the token, and reopens it
          like any other reply.
        </li>
        <li>
          <code>to</code> is someone the inbox already knows (<code>{"{ contactId }"}</code>) or an address. A new
          address is matched to an account through your <Link href="/docs/directory">directory</Link>;{" "}
          <code>customerId</code> files a person who isn&apos;t linked yet under that customer. A person who belongs to
          another customer is refused. A ticket linked to a customer shows in that customer&apos;s{" "}
          <Link href="/docs/portal">portal</Link>.
        </li>
        <li>
          <code>channelId</code> defaults to <code>portalChannelId</code> when it can write first, then your first
          email channel, then the first channel that can. Channels with a subject need one. <code>cc</code> is for
          email, up to 20 addresses.
        </li>
        <li>
          Attachments are uploaded first with <code>uploadAttachment({"{ ticketId: null, … }"})</code> and passed as{" "}
          <code>attachmentIds</code>. Only the agent who uploaded a file can send it.
        </li>
        <li>
          When the channel doesn&apos;t take the message, the ticket stays with the failed message, ready to retry.
        </li>
      </ul>
      <H3>Which channels can write first</H3>
      <p>
        A channel says so with the capability <code>canStartConversation</code>. <code>support.listChannels()</code>{" "}
        returns every channel with <code>startBlockedReason</code> (<code>null</code>, <code>&quot;needs_template&quot;</code>{" "}
        or <code>&quot;not_supported&quot;</code>) and <code>default: true</code> on the one a new conversation uses.
      </p>
      <div className="my-6 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">Channel</th>
              <th className="px-3 py-2 text-start font-medium">Writes first</th>
              <th className="px-3 py-2 text-start font-medium">Why not</th>
            </tr>
          </thead>
          <tbody className="divide-y align-top">
            <tr>
              <td className="px-3 py-2.5">Email (Resend, Microsoft 365, Gmail, SMTP)</td>
              <td className="px-3 py-2.5 text-muted-foreground">Yes</td>
              <td className="px-3 py-2.5 text-muted-foreground" />
            </tr>
            <tr>
              <td className="px-3 py-2.5">SMS (Twilio)</td>
              <td className="px-3 py-2.5 text-muted-foreground">Yes</td>
              <td className="px-3 py-2.5 text-muted-foreground" />
            </tr>
            <tr>
              <td className="px-3 py-2.5">WhatsApp (Twilio, Cloud API)</td>
              <td className="px-3 py-2.5 text-muted-foreground">No</td>
              <td className="px-3 py-2.5 text-muted-foreground">
                <code>needs_template</code>: outside the 24-hour window WhatsApp only accepts an approved template,
                which the adapters don&apos;t send.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2.5">Telegram</td>
              <td className="px-3 py-2.5 text-muted-foreground">No</td>
              <td className="px-3 py-2.5 text-muted-foreground">
                <code>not_supported</code>: a bot can only write to people who wrote to it.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2.5">Signed API</td>
              <td className="px-3 py-2.5 text-muted-foreground">No</td>
              <td className="px-3 py-2.5 text-muted-foreground">
                <code>not_supported</code>: it only receives.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <code>support.listContacts({"{ customerId?, search?, limit? }"})</code> finds who to write to: a customer&apos;s
        people, or the people whose name or address matches a search, most recently updated first, each with their
        identities and customer. Blocked people are left out, and it returns nothing without a customer or a search.
      </p>
      <p>
        With AI, <code>support.ai.draftOpening({"{ intent, customerId?, contactId?, channelId? }"})</code> writes the
        first message from one line of intent, such as &quot;tell them their payouts are failing&quot;. It uses the
        customer&apos;s account facts, your knowledge and your approved answers, writes in the customer&apos;s language
        when it is known, and returns <code>{"{ subject, text, sources }"}</code> for the agent to read and send. It
        sends nothing, and throws with the reason when there isn&apos;t enough to write from.
      </p>
      <Code title="app/api/support/route.ts" lang="ts" code={START_API} />

      <H2 id="signals">Signals and the Outreach queue</H2>
      <p>
        A signal is something your product noticed about one customer that they should hear before they ask. Report it
        with <code>support.signal</code>:
      </p>
      <Code title="Your product" lang="ts" code={SIGNAL} />
      <Props
        rows={[
          { name: "customerId", type: "string", required: true, description: "The customer it is about, as your directory knows them." },
          { name: "kind", type: "string", required: true, description: 'What happened, as a stable name such as "payouts_failing": a lowercase letter, then lowercase letters, digits and underscores, up to 60 characters. Signals of one kind are deduplicated together and share a track record. "incident" is reserved.' },
          { name: "title", type: "string", required: true, description: "One line for your team, up to 200 characters." },
          { name: "facts", type: "{ label, value, url? }[]", description: "What you know, up to 20. With the account facts, they are the only details the message may state." },
          { name: "dedupeKey", type: "string", description: "The same key reported twice does nothing the second time." },
          { name: "to", type: "{ address, name?, locale? }", description: "Who to write to, when your product knows better than the defaults below." },
        ]}
      />
      <p>Each signal that passes the rules becomes a proposal in the inbox&apos;s Outreach queue:</p>
      <ul>
        <li>
          <strong>The right contact.</strong> The address in <code>to</code>, else the one your directory&apos;s{" "}
          <Link href="/docs/directory">
            <code>outreachContact</code>
          </Link>{" "}
          names for this kind, else the person at the customer who wrote to you last. It goes out on the channel a new
          conversation uses by default.
        </li>
        <li>
          <strong>Their language.</strong> The contact&apos;s <code>locale</code>, else the <code>locale</code> you
          passed, else the language of the customer&apos;s recent tickets.
        </li>
        <li>
          <strong>A draft with sources.</strong> Written from the signal&apos;s facts, the customer&apos;s account
          facts, your knowledge and your approved answers, and nothing else. With <code>defer</code> it is drafted
          right away, otherwise on the next <code>runScheduled</code>. When the facts don&apos;t hold enough to say
          something accurate, or drafting fails three times, the proposal still shows what happened and an agent writes
          the message.
        </li>
      </ul>
      <p>
        An agent then sends it as drafted or edited, or dismisses it. Sending opens a ticket through{" "}
        <code>startTicket</code>, from that agent and assigned to them. Two agents sending the same proposal send it
        once. Dismissing keeps the customer from being proposed the same kind again for <code>dedupeHours</code>.
      </p>
      <H3>When a signal is left unsent</H3>
      <p>
        <code>signal</code> never throws for these: it answers with what happened, checked in this order.
      </p>
      <div className="my-6 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start font-medium">Result</th>
              <th className="px-3 py-2 text-start font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y align-top">
            {RULES.map((rule) => (
              <tr key={rule.result}>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <code className="font-mono text-[0.85em] font-medium text-foreground">{rule.result}</code>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{rule.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Every result but <code>duplicate</code> comes back as <code>{"{ status: \"suppressed\", reason }"}</code>.
        Suppressed signals are still recorded in <code>support_signals</code> with the reason.
      </p>
      <H3>Options</H3>
      <Code title="lib/support/index.ts" lang="ts" code={OPTIONS} />
      <Props
        rows={[
          { name: "dedupeHours", type: "number", default: "168", description: "Hours during which a customer isn't written to about the same kind again." },
          { name: "maxPerCustomerPerDay", type: "number", default: "2", description: "Messages one customer may get from signals in any 24 hours, across kinds." },
          { name: "maxPerHour", type: "number", default: "60", description: "Signals turned into proposals in any hour, across customers. The rest are recorded and left unsent." },
          { name: "minDrafts", type: "number", default: "10", description: "Decided proposals a kind needs before it can be switched to send on its own." },
          { name: "minRate", type: "number", default: "0.9", description: "The share of those that must have gone out as drafted or lightly edited, 0 to 1." },
          { name: "windowDays", type: "number", default: "90", description: "Days of history a kind's track record looks at." },
          { name: "holdMinutes", type: "number", default: "10", description: "How long a message of a kind that sends on its own waits in the queue first." },
          { name: "maxAutoPerHour", type: "number", default: "20", description: "Messages that may go out with nobody reading them first in any hour." },
          { name: "autoSend", type: "boolean", default: "true", description: "false removes the per-kind switch: every message waits for an agent." },
          { name: "signature", type: "false | string | ({ language }) => string", default: "fromName and a notice", description: "What a message that went out on its own is signed with. false for none." },
        ]}
      />
      <p>
        <code>proactive: false</code> switches signals off: nothing is recorded and every signal answers{" "}
        <code>unavailable</code>.
      </p>

      <H2 id="sending-on-its-own">Sending on its own</H2>
      <p>
        Nothing sends on its own by default. A kind of outreach earns it the way a topic earns{" "}
        <Link href="/docs/ai#autopilot">Autopilot</Link>, and a person switches it on.
      </p>
      <ul>
        <li>
          <strong>The track record.</strong> For each kind, over <code>windowDays</code>: how many proposals were sent
          as drafted, lightly edited, rewritten or dismissed, measured the same way as Autopilot&apos;s. Two things
          that happen after sending count against the kind too: the customer&apos;s first answer to the message is
          unhappy (they sound frustrated or angry, or say it was wrong), or an agent flags the message. Proposals AI
          couldn&apos;t draft and incident messages aren&apos;t counted.
        </li>
        <li>
          <strong>Eligible.</strong> A kind is ready when at least <code>minRate</code> of its latest{" "}
          <code>minDrafts</code> decided proposals went out as drafted or lightly edited: by default 90% of 10.{" "}
          <code>support.ai.setOutreachKind({"{ kind, on: true, actorId }"})</code> is refused until then, and records
          who switched it on and when. Switching a kind on or off goes through Autopilot&apos;s <code>canManage</code>{" "}
          when you set one.
        </li>
        <li>
          <strong>Held first.</strong> Once a kind is on, each new message of it waits in the queue for{" "}
          <code>holdMinutes</code>, shown with the time it goes. Any agent can stop it (
          <code>holdOutreach</code>), send it now or dismiss it. <code>runScheduled</code> sends the ones that are due.
        </li>
        <li>
          <strong>What a message must pass.</strong> The model marked it confident, every source it cited exists and at
          least one isn&apos;t the guidance, and fewer than <code>maxAutoPerHour</code> went out in the last hour.
          Otherwise it waits for an agent, with the reason in <code>autoBlock</code>: <code>stopped</code>,{" "}
          <code>not_confident</code>, <code>unsourced</code>, <code>hourly_cap</code> or <code>held_back</code>.
        </li>
        <li>
          <strong>Never as a person.</strong> A message that went out on its own has no author, its ticket is
          unassigned, and it is signed with your <code>fromName</code> and &quot;This message was sent automatically.
          Reply to it and our team will pick it up.&quot; <code>listOutreach({"{ sent: true }"})</code> returns it with{" "}
          <code>auto: true</code>.
        </li>
        <li>
          <strong>The kill switch.</strong> Autopilot&apos;s Stop (<code>setAutopilot({"{ stopped: true }"})</code>)
          stops outreach too. It is checked when a message is drafted and again just before it is sent.
        </li>
        <li>
          <strong>Automatic pause.</strong> When a kind&apos;s latest decided proposals fall under <code>minRate</code>{" "}
          (judged from 10 proposals on, or from <code>minDrafts</code> when that is lower), the kind pauses. This is
          checked on every <code>runScheduled</code> and each time a message of the kind is drafted. It can be switched
          on again once the record has recovered. A held message is sent only while its kind is still on: one whose
          kind was paused or switched off in the meantime waits for an agent.
        </li>
        <li>
          <strong>Flag as wrong.</strong> On its ticket, a message that went out on its own carries a one-click flag
          for agents (<code>support.ai.flagOutreach({"{ id, actorId, note? }"})</code>, where <code>id</code> is the
          outreach id). Any agent can raise it. The kind pauses at once, held messages of the kind return to the queue,
          the ticket goes back to open and gets an <code>outreach_flagged</code> event. The kind stays paused until
          someone switches it on or off again, which counts as the review of the flag. Messages an agent sent
          can&apos;t be flagged.
        </li>
        <li>
          <strong>Switching off.</strong> <code>setOutreachKind({"{ kind, on: false, actorId }"})</code> also returns
          every held message of the kind to the queue for an agent.
        </li>
      </ul>
      <p>
        <code>support.ai.getOutreachKinds()</code> returns the readiness view: every kind that has signalled within{" "}
        <code>windowDays</code> or was ever switched on, each with its stage (<code>collecting</code>,{" "}
        <code>eligible</code>, <code>on</code>, <code>paused</code>), its record, the title of its latest signal,
        who switched it on and, while paused, why (<code>pauseReason</code>: <code>quality</code> or{" "}
        <code>flagged</code>), plus the thresholds, <code>holdMinutes</code>, whether the switch exists (
        <code>autoSend</code>) and whether the kill switch is on (<code>stopped</code>).
      </p>
      <Code title="app/api/support/route.ts" lang="ts" code={OUTREACH_API} />

      <H2 id="broadcast">Incident broadcast</H2>
      <p>
        When <Link href="/docs/insights#spikes">Insights detects a spike</Link>, the customers who wrote in are the
        ones who need to hear from you. After an agent acknowledges the spike, &quot;Message customers&quot; writes to
        all of them on one approval. Each method refuses a spike nobody has acknowledged.
      </p>
      <ul>
        <li>
          <code>previewBroadcast({"{ spikeId }"})</code> returns who it would go to: one person per customer, the one
          who wrote in about the spike&apos;s topic while it lasted, on their latest ticket. It also counts who is left
          out: senders not linked to a customer (<code>unlinked</code>), customers already written to about this spike
          (<code>alreadyMessaged</code>) and customers with nobody reachable (<code>unreachable</code>). Nothing is
          sent.
        </li>
        <li>
          <code>draftBroadcast({"{ spikeId, intent }"})</code> writes the message from one line of intent, with{" "}
          <code>{"{name}"}</code> and <code>{"{company}"}</code> where each customer&apos;s go, in the language the intent was written in. It
          states nothing about any one account.
        </li>
        <li>
          <code>sendBroadcast({"{ spikeId, subject, text, actorId }"})</code> opens one ticket per customer, from the
          agent who approved it and assigned to them. <code>{"{name}"}</code> becomes the person&apos;s first name and{" "}
          <code>{"{company}"}</code> the customer&apos;s name; a missing name is written around, so &quot;Hi{" "}
          {"{name}"},&quot; becomes &quot;Hi,&quot;.
        </li>
        <li>
          <strong>Approving twice sends once.</strong> A customer gets one message per spike, enforced by a unique
          index, whoever approves and however often.
        </li>
        <li>
          The first 20 messages go out while the agent waits. The rest are sent by the next{" "}
          <code>runScheduled</code> runs, 25 per run. The result says how many were <code>sent</code>,{" "}
          <code>queued</code> and <code>failed</code>.
        </li>
        <li>
          Incident messages are not in the Outreach queue, don&apos;t count toward a kind&apos;s track record or a
          customer&apos;s daily limit, and each spike shows how many customers were written to (<code>messaged</code>).
        </li>
      </ul>
      <Code title="Your API" lang="ts" code={BROADCAST} />
      <Code title="app/api/support/route.ts" lang="ts" code={BROADCAST_API} />

      <H2 id="self-serve">Self-serve in the portal</H2>
      <p>
        The portal&apos;s Ask box answers a signed-in customer&apos;s question at once, with the sources it used.
        Wire three methods on your server. Each takes <code>customerId</code> and <code>userId</code> from your
        session: they decide whose account is read.
      </p>
      <Code title="Your portal API" lang="ts" code={ASK_API} />
      <Code title="app/support/client.ts" lang="ts" code={ASK_CLIENT} />
      <Code title="What ask returns" lang="ts" code={ASK_RESULT} />
      <p>
        Pass <code>sessionId</code> back to continue a conversation: earlier questions and answers are part of the
        next one. <code>rateAnswer</code> records the customer&apos;s thumbs-up or thumbs-down.
      </p>
      <H3>Off until your team switches it on</H3>
      <p>
        The Ask box answers nothing until someone on your team switches it on in <code>SupportAiSettings</code> (
        <code>support.ai.updateSettings({"{ selfServe: true }"})</code>). <code>portal.list()</code> returns{" "}
        <code>ask: true</code> once it is on, which is what shows the box. Until then <code>portal.ask</code> throws.{" "}
        <code>supportAi({"{ selfServe: false }"})</code> removes it altogether, the switch included.
      </p>
      <H3>What it answers from</H3>
      <ul>
        <li>Your knowledge articles and your approved answers.</li>
        <li>
          The asking customer&apos;s own account facts, from your directory&apos;s <code>describeCustomer</code>.
        </li>
        <li>
          Lookups you marked <code>portal: true</code>: read-only actions (<code>approval: &quot;never&quot;</code>),
          run for the signed-in customer, up to six per answer. A lookup the team switched off in AI settings
          isn&apos;t run. Actions that change something are never available here.
        </li>
      </ul>
      <Code title="lib/support/index.ts" lang="ts" code={PORTAL_LOOKUP} />
      <p>
        Your team&apos;s guidance shapes the tone, and never counts as a source. An answer is shown only when the
        model marked it confident and every source it cited exists. It is written in the language of the question.
      </p>
      <H3>Handing off</H3>
      <p>
        When it can&apos;t answer, <code>ask</code> returns <code>kind: &quot;handoff&quot;</code> with a reason, and
        the Ask box offers to send the question to your team:
      </p>
      <Props
        rows={[
          { name: "cannot_answer", type: "", description: "The knowledge, the approved answers and the account don't hold the answer, the model wasn't confident, or answering failed." },
          { name: "asked_for_human", type: "", description: "The customer asked for a person, a call or an escalation, or is plainly upset." },
          { name: "blocked", type: "", description: "The question read like an attempt to steer the assistant, or the answer recited your guidance." },
          { name: "limit", type: "", description: "The customer reached the hourly limit, or the conversation its length." },
        ]}
      />
      <p>
        <code>portal.escalate</code> turns the conversation into a request on <code>portalChannelId</code>, the same as{" "}
        <code>portal.create</code>: the
        first question is the subject, and the latest question (or <code>text</code>, when the customer reworded it) is
        the message. The ticket carries an internal note for the agent with every question, what AI answered, what it
        drafted but didn&apos;t show, and the sources. The customer never sees the note. A customer can also escalate
        after an answer. A conversation is handed off once; a later question starts a new one.
      </p>
      <Callout title="What keeps it safe">
        <strong>One account.</strong> Account facts and lookups are read for the <code>customerId</code> your server
        passed, by code the question can&apos;t reach. A lookup gets that customer and no ticket, and a{" "}
        <code>sessionId</code> only continues a conversation that belongs to the same customer and user.{" "}
        <strong>Injection.</strong> A question that reads like an attempt to steer the assistant or to reach another
        account is handed off before any model call. Everything in the question is treated as data. An answer that
        repeats ten words in a row from your guidance is not shown. <strong>Caps.</strong> One customer may ask 20
        questions an hour, and a conversation holds 8 before it goes to a person (<code>maxPerHour</code>,{" "}
        <code>maxQuestions</code>). <strong>No guessing.</strong> An answer the model isn&apos;t sure of is never
        shown: it goes to the agent in the hand-off note instead.
      </Callout>

      <H2 id="deflection">Deflection in Insights</H2>
      <p>
        <code>support.ai.insights()</code> gains <code>selfServe: {"{ current, previous }"}</code>, and{" "}
        <Link href="/docs/insights#with-ai">Insights</Link> shows it as questions answered before a ticket. Each side
        counts the conversations started in its period:
      </p>
      <Props
        rows={[
          { name: "conversations", type: "number", description: "Conversations customers started in the Ask box." },
          { name: "answered", type: "number", description: "Those that got at least one answer." },
          { name: "deflected", type: "number", description: "Answered, not handed off, and either the customer gave a thumbs-up, or they gave no rating, asked nothing more for quietHours (24) and that person opened no ticket since the conversation began." },
          { name: "escalated", type: "number", description: "Handed to your team as a ticket." },
          { name: "helpful / notHelpful", type: "number", description: "Conversations whose latest rating was a thumbs-up or a thumbs-down." },
        ]}
      />
      <p>
        A thumbs-down is never counted as deflected, and neither is a conversation still inside its quiet period. So
        the number for the last day grows as conversations age.
      </p>

      <H2 id="store">Store and migration</H2>
      <p>
        Apply <code>0007_proactive.sql</code> and then <code>0008_outreach_record.sql</code>, which ship with{" "}
        <code>support-ai-postgres</code> and <code>support-ai-d1</code>, before you deploy. The second adds the
        columns behind a kind&apos;s record after sending: <code>follow_up</code> and the flag columns on{" "}
        <code>support_outreach</code>, and <code>pause_reason</code> on <code>support_outreach_kinds</code>. The first
        adds:
      </p>
      <Props
        rows={[
          { name: "support_signals", type: "table", description: "Every signal with what became of it: proposed, duplicate or suppressed with the reason. A unique index on dedupe_key." },
          { name: "support_outreach", type: "table", description: "Proposals and messages, from signals and from broadcasts: the draft, what was sent, its sources, status, who decided and the ticket. A unique index on spike and customer." },
          { name: "support_outreach_kinds", type: "table", description: "Each kind's switch for sending on its own, and who set it." },
          { name: "support_ask_sessions", type: "table", description: "Ask conversations: the questions, what came of each, the rating and the ticket it was handed off to." },
          { name: "support_ai_settings.self_serve", type: "column", description: "The team's switch for the Ask box. False by default." },
        ]}
      />
      <p>
        Starting a conversation needs no migration. <code>proactive.ts</code> is a new file in the core{" "}
        <code>support</code> item: it holds the parts that need no model and no database, including{" "}
        <code>PROACTIVE_DEFAULTS</code>, <code>SELF_SERVE_DEFAULTS</code> and the rules above. If you wrote your own
        store, see <Link href="/docs/upgrading#proactive">Upgrading</Link> for the new methods.
      </p>

      <H2 id="screens">Screens and client methods</H2>
      <p>
        Every method is optional, and each screen appears when your client has the methods it needs. Pass the signed-in
        agent&apos;s id as <code>agentId</code> or <code>actorId</code> on your server.
      </p>
      <Props
        rows={[
          { name: "NewTicketDialog, NewTicketButton", type: "new-ticket-dialog.tsx", description: "New ticket in the inbox and Message on a ticket's customer card. Needs client.startTicket. listChannels lets the agent choose the channel and explains the ones that can't write first, listContacts finds people, uploadForNewTicket adds attachments, and ai.draftOpening adds a draft from one line." },
          { name: "OutreachQueue", type: "outreach.tsx", description: "The inbox's Outreach tab. Needs ai.listOutreach; ai.sendOutreach, ai.dismissOutreach and ai.holdOutreach are its buttons." },
          { name: "OutreachMark", type: "autopilot.tsx", description: "On a ticket, under a message that went out on its own: \"Sent automatically from a signal\" and the flag. The flag needs ai.flagOutreach." },
          { name: "OutreachKinds", type: "outreach.tsx", description: "Each kind's readiness and switch, inside SupportAiSettings. Needs ai.getOutreachKinds and ai.setOutreachKind." },
          { name: "BroadcastDialog", type: "outreach.tsx", description: "Opened from a spike's \"Message customers\". Needs ai.previewBroadcast and ai.sendBroadcast; ai.draftBroadcast adds the draft from one line." },
          { name: "SupportAsk", type: "support-ask.tsx", description: "The Ask box at the top of SupportRequests. Needs ask on the portal client and ask: true from list(); rateAnswer and escalate are its thumbs and its hand-off." },
        ]}
      />
      <Code title="app/admin/support/client.ts" lang="ts" code={CLIENT} />
      <p>
        For the self-serve switch in <code>SupportAiSettings</code>, return <code>selfServe</code> from{" "}
        <code>client.ai.getSettings()</code> (<code>support.ai.getSettings()</code> already does) and pass it through{" "}
        <code>updateSettings</code>. For deflection, <code>client.ai.insights()</code> already carries{" "}
        <code>selfServe</code>.
      </p>
      <Callout title="What leaves your servers">
        A signal&apos;s facts, an agent&apos;s intent and a customer&apos;s question, with that customer&apos;s account
        facts and what a portal lookup returns, go to the model provider you configured, like the rest of{" "}
        <Link href="/docs/ai#privacy">AI</Link>. Questions and answers are stored in <code>support_ask_sessions</code>{" "}
        in your database.
      </Callout>
    </DocsShell>
  );
}
