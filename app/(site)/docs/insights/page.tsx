import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { Callout, DocsShell, H2, Props } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Insights",
  description: "A support dashboard inside the inbox: response times, volume, backlog, load, topics, what became of AI drafts, and spikes.",
  alternates: { canonical: "/docs/insights" },
};

const API = `// In the API you already expose to the screens:
case "stats":
  return Response.json(await s.stats(input)); // { from, to, responseTargetMinutes }
case "listTickets":
  return Response.json(
    await s.listTickets(
      {
        status: input.status, // left out when a link asks for every status
        assigneeId: input.assignee === "me" ? agent.id : input.assignee,
        search: input.search,
        // What Insights links to:
        topic: input.topic,
        channelId: input.channel,
        customerId: input.customerId,
        createdFrom: input.createdFrom && new Date(input.createdFrom),
        createdTo: input.createdTo && new Date(input.createdTo),
        sort: input.status === "open" ? "waiting" : "recent",
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      },
      agent.id
    )
  );

// With AI:
case "ai.insights":
  return Response.json(await s.ai.insights(input)); // { from, to }
case "ai.listSpikes":
  return Response.json(await s.ai.listSpikes());
case "ai.acknowledgeSpike":
  return Response.json(await s.ai.acknowledgeSpike({ id: input.id, actorId: agent.id }));`;

const CLIENT = `export const supportClient: SupportClient = {
  // …
  stats: (input) => call("stats", input),
  ai: {
    // …
    insights: (input) => call("ai.insights", input),
    listSpikes: () => call("ai.listSpikes"),
    acknowledgeSpike: (input) => call("ai.acknowledgeSpike", input),
  },
};`;

const PAGE = `// app/admin/support/insights/page.tsx
import { SupportInsights } from "@/components/support/support-insights";

export default function Page() {
  return <SupportInsights />;
}`;

const SPIKES = `createSupport({
  // …
  notify: async (n) => {
    if (n.type === "insights.spike") {
      await postToTeamChannel(\`Likely incident: \${n.spike.customers} customers wrote about \${n.spike.topic}\`);
    }
  },
  ai: supportAi({
    // …
    spikes: { minCustomers: 5, windowMinutes: 120, factor: 3, baselineDays: 14 }, // the defaults
  }),
});`;

export default function Insights() {
  return (
    <DocsShell
      href="/docs/insights"
      toc={[
        { id: "what-it-shows", title: "What it shows" },
        { id: "set-it-up", title: "Set it up" },
        { id: "definitions", title: "How each number is defined" },
        { id: "with-ai", title: "With AI" },
        { id: "spikes", title: "Spikes" },
        { id: "cost", title: "What it costs to load" },
      ]}
    >
      <p>
        <code>SupportInsights</code> is a dashboard that lives next to the inbox. It answers two questions: how is
        support going, and what do customers struggle with. Every number sits next to the same number for the period
        before, and links to the tickets behind it where the inbox can show them. Try it in the{" "}
        <Link href="/demo">demo</Link>.
      </p>

      <H2 id="what-it-shows">What it shows</H2>
      <ul>
        <li>
          <strong>Speed.</strong> Median and 90th-percentile time to first reply and time to solve, the tickets that
          missed your response target, and the longest waits among them.
        </li>
        <li>
          <strong>Volume.</strong> Tickets opened and solved per day and the backlog at the end of each day, for every
          channel or one. From 60 days up, the charts show a week per bar.
        </li>
        <li>
          <strong>Team.</strong> What each agent holds open and waiting right now, and what they solved.
        </li>
        <li>
          <strong>Customers and quality.</strong> The customers who wrote most, tickets reopened after being solved,
          replies per solved ticket, and the share solved in one reply.
        </li>
      </ul>
      <p>The period is the last 7, 30 or 90 days in the viewer&apos;s time zone, today included.</p>

      <H2 id="set-it-up">Set it up</H2>
      <p>
        Apply <code>0005_insights.sql</code> (three indexes, no new tables), expose <code>support.stats</code> and the
        new list filters, and add <code>stats</code> to your client:
      </p>
      <Code title="app/api/support/route.ts" lang="ts" code={API} />
      <Code title="app/admin/support/client.ts" lang="ts" code={CLIENT} />
      <Code title="app/admin/support/insights/page.tsx" lang="tsx" code={PAGE} />
      <p>
        The screen uses the provider you already have. <code>responseTargetMinutes</code> is the target breaches are
        counted against, the same one that turns a wait red in the inbox. Two things are new on the provider and the
        client:
      </p>
      <Props
        rows={[
          { name: "aiSettingsHref", type: "string", description: "SupportProvider. Where SupportAiSettings is mounted, so a gap on the dashboard links to the list it is in." },
          { name: "stats", type: "(input) => Promise<SupportStats>", description: "SupportClient. Calls support.stats({ from, to, responseTargetMinutes }). Without it, SupportInsights renders nothing." },
          { name: "ListQuery", type: "topic, channel, customerId, createdFrom, createdTo", description: "SupportClient.listTickets. The filters a link from Insights adds to the inbox URL. status is left out when the link asks for every status but spam." },
        ]}
      />

      <H2 id="definitions">How each number is defined</H2>
      <ul>
        <li>
          <strong>Time to first reply</strong> runs from the customer&apos;s first message to the first reply that
          reached them, from an agent or Autopilot. Acknowledgements and failed sends don&apos;t count, and tickets your
          team started have none. It is filed under the period the ticket was opened in.
        </li>
        <li>
          <strong>Time to solve</strong> runs from when a ticket was opened to when it was last solved, for tickets that
          are still solved. It is filed under the period it was solved in.
        </li>
        <li>
          <strong>Median and 90th percentile</strong> interpolate between neighbours, as spreadsheets do: the median of
          10, 20, 30 and 40 minutes is 25.
        </li>
        <li>
          <strong>A missed target</strong> is a ticket opened in the period whose first reply took longer than{" "}
          <code>responseTargetMinutes</code>, or that is open and still waiting past it. Time is wall-clock: there are no
          business hours.
        </li>
        <li>
          <strong>Backlog</strong> is rebuilt from when tickets were opened and last solved, so a ticket that was
          solved and later reopened reads as open in between.
        </li>
        <li>
          <strong>The period before</strong> has the same length and ends where the chosen one starts. Spam is left out
          of everything.
        </li>
      </ul>

      <H2 id="with-ai">With AI</H2>
      <p>
        When <Link href="/docs/ai">AI</Link> is configured, apply <code>0006_insights_ai.sql</code> and add{" "}
        <code>insights</code> to <code>client.ai</code>. The dashboard gains:
      </p>
      <ul>
        <li>
          <strong>Topics.</strong> Tickets per topic with their trend and change, the topics growing fastest (at least
          5 tickets and a fifth more than before), the urgency mix, and the share of frustrated or angry customers
          per day. Each topic also shows how many of its drafts went out as written or lightly edited: where that is
          low, AI isn&apos;t carrying its weight on the topic yet.
        </li>
        <li>
          <strong>What became of drafts.</strong> Sent by Autopilot, sent as drafted, lightly edited, rewritten or
          discarded, counted in the period they were decided in; Autopilot replies flagged as wrong; and the median
          time to first reply on tickets that had a draft ready next to those that didn&apos;t.
        </li>
        <li>
          <strong>Gaps.</strong> The open gaps most tickets ran into, from{" "}
          <Link href="/docs/ai#memory">Memory</Link>, linking to AI settings.
        </li>
      </ul>

      <H2 id="spikes">Spikes</H2>
      <p>
        On every <code>runScheduled</code>, Tendkit looks for a topic that many different customers raised in a short
        window: by default 5 customers within 2 hours, and at least 3 times what the topic usually gets in those same
        hours over the last 14 days. A match is recorded as a spike and shown as a likely incident at the top of the
        inbox and the dashboard, with its tickets one click away, until an agent acknowledges it.
      </p>
      <Code title="lib/support.ts" lang="ts" code={SPIKES} />
      <ul>
        <li>
          Colleagues at one customer count once, and so does one person writing twice. People not linked to a customer
          count by contact. The catch-all topic &quot;other&quot; never spikes.
        </li>
        <li>
          <code>notify</code> gets <code>insights.spike</code> once per spike, however many schedulers run. While it
          lasts, its ticket and customer counts are kept up to date.
        </li>
        <li>
          A spike ends when a whole window has passed without the detector seeing it. An ended spike still shows until
          someone acknowledges it: an incident overnight is news in the morning. The next burst on the topic is a new
          spike.
        </li>
        <li>
          Add <code>listSpikes</code> and <code>acknowledgeSpike</code> to <code>client.ai</code> for the banner and
          its button. Acknowledging records who and when; the first agent stands.
        </li>
        <li>
          <code>spikes: false</code> switches detection off.
        </li>
      </ul>
      <Callout title="A spike needs topics">
        Detection reads the topic AI gave each ticket, so it starts working once you have set{" "}
        <Link href="/docs/ai">your topics</Link> in AI settings.
      </Callout>

      <H2 id="cost">What it costs to load</H2>
      <p>
        Nothing is tracked or rolled up: the numbers are computed from tickets, messages and events when the page
        loads, so they are right for any period and need no backfill. Each query reads one period&apos;s tickets
        through an index on when they were opened or solved, and percentiles are ranked in the database, which returns
        four rows however many tickets there are. The same queries run on Postgres and on SQLite or Cloudflare D1, one
        after another, and the screen keeps a result for a minute.
      </p>
    </DocsShell>
  );
}
