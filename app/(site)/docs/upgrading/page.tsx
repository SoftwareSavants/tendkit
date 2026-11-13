import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { DocsShell, H2 } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Upgrading",
  description: "Take upstream Tendkit fixes into code you've copied and changed.",
  alternates: { canonical: "/docs/upgrading" },
};

export default function Upgrading() {
  return (
    <DocsShell
      href="/docs/upgrading"
      toc={[
        { id: "see-what-changed", title: "See what changed" },
        { id: "keep-diffs-small", title: "Keep diffs small" },
        { id: "schema-changes", title: "Schema changes" },
        { id: "proactive", title: "Taking Proactive and self-serve" },
      ]}
    >
      <p>Copied code doesn&apos;t update itself. That&apos;s the point: you choose what to take, and when.</p>

      <H2 id="see-what-changed">See what changed</H2>
      <Code title="Terminal" lang="bash" code={`npx shadcn@latest add @tendkit/support --diff\nnpx shadcn@latest add @tendkit/channel-resend --diff`} />
      <p>Apply the parts you want. The GitHub history explains why each change was made.</p>

      <H2 id="keep-diffs-small">Keep diffs small</H2>
      <ul>
        <li>
          Keep the engine files (<code>service.ts</code>, <code>text.ts</code>, <code>channels/*</code>) as they are.
          Product logic belongs in your directory, notifier, storage and API.
        </li>
        <li>Wrap the screens instead of editing them where you can: your provider, pages and customer panel.</li>
        <li>When you do change a shared file, a short comment marking why makes the next diff easy to read.</li>
      </ul>

      <H2 id="schema-changes">Schema changes</H2>
      <p>
        When an update changes the support schema, regenerate your migration with Drizzle and review it like any other.
        Tendkit never migrates your database for you.
      </p>
      <p>
        Each schema change also ships as a numbered reference migration next to your store, so you can see exactly what
        an update adds: <code>0001_ai.sql</code> for the AI tables, <code>0002_memory.sql</code> for AI memory (approved
        answers, corrections, guidance suggestions and gaps, plus two columns on <code>support_ai_settings</code>),{" "}
        <code>0003_actions.sql</code> for AI actions (the <code>support_action_runs</code> log, plus a column each on{" "}
        <code>support_suggestions</code> and <code>support_ai_settings</code>), <code>0004_autopilot.sql</code> for
        Autopilot (the <code>support_autopilot_topics</code> table and columns on <code>support_suggestions</code>,{" "}
        <code>support_ticket_insights</code> and <code>support_ai_settings</code>; its two closing <code>UPDATE</code>{" "}
        statements file the outcomes you already recorded under their topics, so keep them when you write your own
        migration), <code>0005_insights.sql</code> for <a href="/docs/insights">Insights</a> (three indexes on{" "}
        <code>support_tickets</code> and <code>support_events</code>; it ships with the store, so apply it with or
        without AI) and <code>0006_insights_ai.sql</code> for Insights with AI (the <code>support_spikes</code> table
        and an index on <code>support_suggestions</code>) and <code>0007_proactive.sql</code> for{" "}
        <Link href="/docs/proactive">Proactive and self-serve</Link> (the <code>support_signals</code>,{" "}
        <code>support_outreach</code>, <code>support_outreach_kinds</code> and <code>support_ask_sessions</code> tables,
        and a <code>self_serve</code> column on <code>support_ai_settings</code>). Apply the migration before you deploy
        the updated code.
      </p>

      <H2 id="proactive">Taking Proactive and self-serve</H2>
      <p>
        This update adds <code>startTicket</code>, signals and outreach, incident broadcast and the portal&apos;s Ask
        box. If you use the shipped stores and adapters as they are, take the files and apply{" "}
        <code>0007_proactive.sql</code> (with AI only; starting a conversation needs no migration). If you changed or
        replaced any of these, check them:
      </p>
      <ul>
        <li>
          <strong>A new core file.</strong> <code>proactive.ts</code> comes with the <code>support</code> item.{" "}
          <code>service.ts</code>, <code>insights.ts</code>, <code>autopilot.ts</code> and the AI files import from it.
        </li>
        <li>
          <strong>Your own <code>SupportStore</code>.</strong> Add{" "}
          <code>listContacts({"{ customerId?, userId?, search?, limit }"})</code>: the people of a customer, or the
          people whose name or address holds <code>search</code>, most recently updated first. And{" "}
          <code>insertAttachment</code> now accepts <code>ticketId: null</code>, for a file uploaded before its ticket
          exists.
        </li>
        <li>
          <strong>Your own <code>AiStore</code>.</strong> Add the methods under &quot;Proactive and self-serve&quot; in{" "}
          <code>ai-store.ts</code>: signals, outreach, outreach kinds, Ask sessions and <code>selfServeStats</code>.
          Settings gain <code>selfServe</code>, false by default.
        </li>
        <li>
          <strong>Actions.</strong> <code>SupportAction.run</code> and <code>available</code> now receive{" "}
          <code>ticket: Ticket | null</code>. It is null only for lookups you mark <code>portal: true</code>, so
          existing actions keep working; TypeScript will ask you to handle null where you read the ticket.
        </li>
        <li>
          <strong>Your own channel adapters.</strong> <code>canStartConversation</code> is an optional capability.
          Left out, a channel can write first when it has no reply window and its kind isn&apos;t{" "}
          <code>&quot;api&quot;</code>. Set it to <code>false</code> for a channel where the customer has to write
          first.
        </li>
        <li>
          <strong>The screens.</strong> Three new files: <code>new-ticket-dialog.tsx</code>, <code>outreach.tsx</code>{" "}
          and <code>support-ask.tsx</code>. Every new client method is optional, and nothing new shows until you add
          it. <code>portal.list()</code> now also returns <code>ask</code>.
        </li>
      </ul>
    </DocsShell>
  );
}
