import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { Callout, DocsShell, H2, Props } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "The service",
  description: "createSupport: storage, channels, team notifications, automatic replies and every option.",
  alternates: { canonical: "/docs/service" },
};

const SERVICE = `import { createSupport } from "@/lib/support/service";
import { createPostgresStore } from "@/lib/support/postgres/store";
import { resendChannel } from "@/lib/support/channels/resend";
import { directory } from "./directory";
import { storage } from "./storage";

export const support = () =>
  createSupport({
    store: createPostgresStore(db),
    storage,
    channels: [
      resendChannel({
        id: "email",
        apiKey: process.env.RESEND_API_KEY!,
        webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
        address: "support@acme.com",
        replyAddress: "support@in.acme.com",
      }),
    ],
    directory,
    notify: async (n) => {
      if (n.type === "ticket.created") await emailTeam("New ticket", n.ticket.subject);
    },
    acknowledgement: () => ({
      text: "Thanks for writing to Acme. We've received your message and will reply to this email.",
    }),
    fromName: "Acme Support",
    portalChannelId: "email",
    ignoreFrom: ["noreply@acme.com"],
  });`;

const STORAGE = `import type { AttachmentStorage } from "@/lib/support/service";

// S3, R2, Supabase Storage, a disk: anything that can store bytes and hand out a download link.
export const storage: AttachmentStorage = {
  async put(key, body, contentType) {
    await bucket.put(key, body, { contentType });
  },
  async get(key) {
    return new Uint8Array(await bucket.get(key).arrayBuffer());
  },
  async url(key, { filename, expiresInSeconds }) {
    // A short-lived link that downloads (Content-Disposition: attachment).
    return bucket.signedUrl(key, { expiresIn: expiresInSeconds, downloadAs: filename });
  },
};`;

export default function Service() {
  return (
    <DocsShell
      href="/docs/service"
      toc={[
        { id: "create-the-service", title: "Create the service" },
        { id: "options", title: "Options" },
        { id: "attachment-storage", title: "Attachment storage" },
        { id: "notifications", title: "Notifications" },
        { id: "automatic-replies", title: "Automatic replies" },
        { id: "methods", title: "Methods" },
        { id: "errors", title: "Errors" },
      ]}
    >
      <H2 id="create-the-service">Create the service</H2>
      <p>
        <code>createSupport</code> returns the object your webhook route, scheduled job and API call. It holds no state of
        its own, so create it once per request (or once per worker) with your database client.
      </p>
      <Code title="lib/support/index.ts" lang="ts" code={SERVICE} />

      <H2 id="options">Options</H2>
      <Props
        rows={[
          { name: "store", type: "SupportStore", required: true, description: "createPostgresStore(db) or createD1Store(db)." },
          { name: "storage", type: "AttachmentStorage", required: true, description: "Where attachment bytes live. See below." },
          { name: "channels", type: "Channel[]", required: true, description: <>The adapters you use. Each needs a unique, permanent <code>id</code>.</> },
          { name: "directory", type: "SupportDirectory", required: true, description: <>Who people are. See <Link href="/docs/directory">Your directory</Link>.</> },
          { name: "notify", type: "(n) => Promise<void>", description: "Alerts to your team. Errors are logged, never thrown into ingestion." },
          { name: "acknowledgement", type: "(ctx) => { text } | null", description: "The automatic first reply to new tickets. Return null to skip one." },
          { name: "signature", type: "(agent) => string", default: "the agent's first name", description: "Appended to email replies only; the stored text stays what the agent wrote." },
          { name: "fromName", type: "string", description: 'The display name replies are sent as, such as "Acme Support".' },
          { name: "portalChannelId", type: "string", description: "The email channel that portal requests and contact forms reply on." },
          { name: "ignoreFrom", type: "string[]", description: "Senders whose mail never becomes a ticket, such as your app's no-reply address." },
          { name: "team", type: "{ addresses?, domains? }", default: "your agents' emails", description: <>Who counts as your team, besides your agents. See <Link href="/docs/email#team-email">Email from your team</Link>.</> },
          { name: "teamEmail", type: '"loop-in" | "customer"', default: '"loop-in"', description: "Whether a teammate's email to the support address hands the conversation to the inbox, or is handled like anyone else's." },
          { name: "replyAll", type: "boolean", default: "true", description: "Replies copy everyone else on the latest email, minus your addresses and your team. Agents can change it per reply." },
          { name: "reopenWindowDays", type: "number", default: "14", description: "A reply within this many days reopens a solved ticket; later replies open a new one that links back." },
          { name: "maxAttachmentBytes", type: "number", default: "25 MB", description: "Larger inbound files are skipped; larger uploads are refused." },
          { name: "ai", type: "supportAi({ model, store, … })", description: <>Optional triage, summaries and suggested replies. See <Link href="/docs/ai">AI</Link>.</> },
          { name: "now", type: "() => Date", description: "For tests." },
          { name: "log", type: "(level, message, data) => void", default: "console", description: "Where warnings and errors go." },
        ]}
      />

      <H2 id="attachment-storage">Attachment storage</H2>
      <p>
        Inbound attachments are copied into your storage as they arrive, and agents upload files to replies and notes.
        Download links are created on demand and expire after five minutes.
      </p>
      <Code title="lib/support/storage.ts" lang="ts" code={STORAGE} />
      <Callout title="Serve files as downloads">
        Customer files are untrusted. Make <code>url</code> return links that download rather than display, ideally from a
        different origin than your app, so an HTML or SVG attachment can never run as a page on your domain.
      </Callout>

      <H2 id="notifications">Notifications</H2>
      <p>
        <code>notify</code> receives one of these events. Send them however your team works: email, Slack, push.
      </p>
      <Props
        rows={[
          { name: "ticket.created", type: "{ ticket, message, contact }", description: "A new ticket, including ones opened from the portal. Not sent for automatic mail or tickets marked as spam." },
          { name: "ticket.customer_replied", type: "{ ticket, message, contact }", description: "The customer wrote again. Usually goes to the assignee, or everyone when unassigned." },
          { name: "ticket.assigned", type: "{ ticket, assigneeId, actorId }", description: "Someone assigned the ticket." },
          { name: "message.failed", type: "{ ticket, message }", description: "A reply bounced or couldn't be delivered; message.deliveryError says why." },
          { name: "insights.spike", type: "{ spike }", description: "With AI: many different customers raised one topic in a short window. Sent once per spike. See Insights." },
        ]}
      />

      <H2 id="automatic-replies">Automatic replies</H2>
      <p>
        <code>acknowledgement</code> runs for new tickets from senders your directory matched to a customer. Strangers, spam
        and spoofed senders never get one, so the inbox can&apos;t be used to send mail to arbitrary addresses. The reply
        carries <code>Auto-Submitted: auto-replied</code> so other systems don&apos;t answer it.
      </p>

      <H2 id="methods">Methods</H2>
      <p>What the service returns. Expose the agent methods and the portal through your own API, behind your own auth.</p>
      <Props
        rows={[
          { name: "handleWebhook", type: "(channelId, request) => Response", description: <>For your webhook route. See <Link href="/docs/webhooks">Webhooks</Link>.</> },
          { name: "runScheduled", type: "() => Promise<summary>", description: "Polls channels, renews subscriptions, fails sends that never finished. With AI, also handles queued messages, the daily knowledge sync, and outreach that is waiting to be drafted or due to send." },
          { name: "ingest", type: "(channelId, event)", description: "Feed an event directly, for tests or custom transports." },
          { name: "listTickets / getTicket / counts", type: "", description: "What the inbox and ticket screens read. getTicket includes accountFacts from your directory's describeCustomer." },
          { name: "reply / retry / addNote", type: "", description: "Send a reply (status and attachments included), retry a failed one, or add an internal note." },
          { name: "startTicket", type: "({ to, text, agentId, channelId?, customerId?, cc?, subject?, attachmentIds? }) => { ticket, message }", description: <>Opens a ticket by writing to a customer first: Waiting on customer, assigned to the agent, sent like a reply. <code>to</code> is <code>{"{ contactId }"}</code> or <code>{"{ address, name? }"}</code>. See <Link href="/docs/proactive#start-a-conversation">Start a conversation</Link>.</> },
          { name: "listChannels", type: "() => { id, kind, address, identityKind, capabilities, startBlockedReason, default }[]", description: <>Your channels, with whether your team can write first on each (<code>startBlockedReason</code> is null, &quot;needs_template&quot; or &quot;not_supported&quot;) and which one a new conversation uses by default.</> },
          { name: "listContacts", type: "({ customerId?, search?, limit? }) => { id, name, identities, customer }[]", description: "A customer's people, or the people matching a search: who a new conversation can go to. Blocked people are left out. Empty without a customer or a search; limit defaults to 20, at most 50." },
          { name: "signal", type: "({ customerId, kind, title, facts?, dedupeKey?, to? }) => SignalResult", description: <>Something your product noticed that a customer should hear about. With AI it becomes a drafted message in the Outreach queue; the result is proposed, duplicate or suppressed with a reason. Without AI it answers suppressed with &quot;unavailable&quot;. See <Link href="/docs/proactive#signals">Signals</Link>.</> },
          { name: "assign / setStatus / linkCustomer", type: "", description: "Assignment, status (open, waiting, solved, spam) and linking a sender to a customer." },
          { name: "changeContact", type: "({ ticketId, address, actorId })", description: "Makes someone else the ticket's contact. Replies go to them, and they're matched to an account as usual." },
          { name: "uploadAttachment / attachmentUrl", type: "", description: "Agent uploads, and short-lived download links with access checks. uploadAttachment takes ticketId: null for a file that startTicket is about to send; only its uploader can send it." },
          { name: "searchCustomers / listAgents / markRead", type: "", description: "Pickers and read state per agent." },
          { name: "portal.list / get / create / reply", type: "", description: <>The customer portal. See <Link href="/docs/portal">Customer portal</Link>.</> },
          { name: "portal.ask / rateAnswer / escalate", type: "", description: <>With AI: the portal&apos;s Ask box, its thumbs and its hand-off to a ticket. See <Link href="/docs/proactive#self-serve">Self-serve</Link>.</> },
          { name: "ai.*", type: "", description: <>Only when <code>ai</code> is configured. See <Link href="/docs/ai#methods">AI</Link>.</> },
        ]}
      />

      <H2 id="errors">Errors</H2>
      <p>
        Methods throw <code>SupportError</code> with a <code>code</code> of <code>not_found</code>, <code>forbidden</code>,{" "}
        <code>invalid</code>, <code>reply_window_closed</code> or <code>too_large</code>, and a message written for the
        person using the screen. Map it to your API&apos;s error type and show the message as is.
      </p>
    </DocsShell>
  );
}
