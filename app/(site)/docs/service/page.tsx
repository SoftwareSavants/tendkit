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
        <code>notify</code> receives one of four events. Send them however your team works: email, Slack, push.
      </p>
      <Props
        rows={[
          { name: "ticket.created", type: "{ ticket, message, contact }", description: "A new ticket, including ones opened from the portal. Not sent for automatic mail or tickets marked as spam." },
          { name: "ticket.customer_replied", type: "{ ticket, message, contact }", description: "The customer wrote again. Usually goes to the assignee, or everyone when unassigned." },
          { name: "ticket.assigned", type: "{ ticket, assigneeId, actorId }", description: "Someone assigned the ticket." },
          { name: "message.failed", type: "{ ticket, message }", description: "A reply bounced or couldn't be delivered; message.deliveryError says why." },
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
          { name: "runScheduled", type: "() => Promise<summary>", description: "Polls channels, renews subscriptions, fails sends that never finished." },
          { name: "ingest", type: "(channelId, event)", description: "Feed an event directly, for tests or custom transports." },
          { name: "listTickets / getTicket / counts", type: "", description: "What the inbox and ticket screens read." },
          { name: "reply / retry / addNote", type: "", description: "Send a reply (status and attachments included), retry a failed one, or add an internal note." },
          { name: "assign / setStatus / linkCustomer", type: "", description: "Assignment, status (open, waiting, solved, spam) and linking a sender to a customer." },
          { name: "changeContact", type: "({ ticketId, address, actorId })", description: "Makes someone else the ticket's contact. Replies go to them, and they're matched to an account as usual." },
          { name: "uploadAttachment / attachmentUrl", type: "", description: "Agent uploads, and short-lived download links with access checks." },
          { name: "searchCustomers / listAgents / markRead", type: "", description: "Pickers and read state per agent." },
          { name: "portal.list / get / create / reply", type: "", description: <>The customer portal. See <Link href="/docs/portal">Customer portal</Link>.</> },
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
