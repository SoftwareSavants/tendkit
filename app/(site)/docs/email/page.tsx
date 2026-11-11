import type { Metadata } from "next";
import Link from "next/link";
import { Callout, DocsShell, H2, Step, Steps } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Email setup",
  description: "Receiving domains, threading, trimming, automatic mail and sender authentication.",
  alternates: { canonical: "/docs/email" },
};

export default function Email() {
  return (
    <DocsShell
      href="/docs/email"
      toc={[
        { id: "keep-your-mailbox", title: "Keep your mailbox" },
        { id: "threading", title: "Threading" },
        { id: "copies", title: "Copies" },
        { id: "team-email", title: "Email from your team" },
        { id: "what-the-ticket-shows", title: "What the ticket shows" },
        { id: "automatic-mail", title: "Automatic mail" },
        { id: "authentication", title: "Sender authentication" },
        { id: "deliverability", title: "Deliverability" },
      ]}
    >
      <H2 id="keep-your-mailbox">Keep your mailbox</H2>
      <p>
        You don&apos;t have to move <code>support@acme.com</code>. With an adapter that receives on its own domain (Resend),
        keep the mailbox where it is and copy its mail to a receiving subdomain:
      </p>
      <Steps>
        <Step title="Add a receiving subdomain">
          <p className="text-muted-foreground">
            For example <code>in.acme.com</code>, with its MX record pointing at your provider. The apex domain&apos;s MX
            stays on Microsoft 365 or Google Workspace.
          </p>
        </Step>
        <Step title="Copy support@ to it">
          <p className="text-muted-foreground">
            In Exchange, a mail flow rule: when the recipient (or, for a group, the To or Cc box) is{" "}
            <code>support@acme.com</code>, Bcc <code>support@in.acme.com</code>. In Google Workspace, a routing rule that
            adds a recipient. Your mailbox keeps its copy.
          </p>
        </Step>
        <Step title="Use the subdomain as replyAddress">
          <p className="text-muted-foreground">
            Replies go out from <code>support@acme.com</code> with a reply address on the subdomain, so answers come straight
            back to the ticket.
          </p>
        </Step>
      </Steps>
      <p>
        Prefer one place for everything? The <Link href="/docs/channels/microsoft365">Microsoft 365</Link> and{" "}
        <Link href="/docs/channels/gmail">Gmail</Link> adapters read and send from the mailbox itself, and record replies
        your team sends from Outlook or Gmail on the ticket.
      </p>

      <H2 id="threading">Threading</H2>
      <p>A message joins an existing ticket when, in this order:</p>
      <ul>
        <li>
          it was sent to the ticket&apos;s reply address, <code>support+t-&lt;token&gt;@in.acme.com</code>, which survives
          mail clients that drop headers;
        </li>
        <li>
          its <code>In-Reply-To</code> or <code>References</code> headers name a message on the ticket;
        </li>
        <li>the provider says it belongs to the same thread (Gmail, Microsoft 365);</li>
        <li>for SMS, WhatsApp and Telegram, it comes from the same person on the same channel.</li>
      </ul>
      <p>
        The sender must be the ticket&apos;s contact, someone at the same customer, or someone already on the conversation
        (copied on one of its emails). Anyone else opens a new ticket.
      </p>
      <p>
        A reply to a solved ticket reopens it within <code>reopenWindowDays</code> (14 by default); after that it opens a
        new ticket that links back.
      </p>

      <H2 id="copies">Copies</H2>
      <p>
        A reply goes to whoever wrote last and copies everyone else on the latest email, minus your own addresses and your
        team. Agents can remove or add people in the composer before sending, and the next reply keeps their list. Set{" "}
        <code>replyAll: false</code> to send to the customer alone by default.
      </p>

      <H2 id="team-email">Email from your team</H2>
      <p>
        Your team is your agents&apos; email addresses (from <code>listAgents</code>), plus any addresses and domains in the{" "}
        <code>team</code> option. With <code>teamEmail: &quot;loop-in&quot;</code>, the default, a teammate can hand a
        conversation to the inbox from their own mailbox:
      </p>
      <ul>
        <li>
          <strong>Reply to a customer and add the support address.</strong> The customer becomes the ticket&apos;s contact.
          Their email, read from the quote, and the teammate&apos;s reply both appear on the ticket. Nothing is sent: the
          teammate&apos;s mail client already delivered it.
        </li>
        <li>
          <strong>Forward a customer&apos;s email to the support address.</strong> The forwarded email&apos;s sender
          becomes the contact, and what the teammate wrote above it becomes an internal note.
        </li>
        <li>
          <strong>Reply on an existing ticket.</strong> An email to the customer is recorded as the teammate&apos;s reply;
          one to the support address alone becomes an internal note.
        </li>
      </ul>
      <p>
        Quotes are read from Outlook&apos;s From/Sent block, Gmail&apos;s &quot;On … wrote:&quot; line and Apple
        Mail&apos;s forwards. A hand-off gets no acknowledgement. Team mail that fails authentication is handled like
        anyone else&apos;s, and <code>teamEmail: &quot;customer&quot;</code> turns this off. When a ticket still ends up
        under the wrong person, <strong>Change contact</strong> on the ticket moves it.
      </p>

      <H2 id="what-the-ticket-shows">What the ticket shows</H2>
      <p>
        Only what the person wrote this time. Quoted history is cut at reply headers in English, French and Arabic, and at
        Outlook&apos;s From/Sent blocks. Signatures are removed when the mail client marks them (Outlook, Outlook mobile,
        Gmail, Thunderbird), and the &quot;Sent from my iPhone&quot; lines are dropped. The full message stays one click
        away, and HTML email renders sanitized in a sandboxed frame with remote images off until an agent allows them.
      </p>

      <H2 id="automatic-mail">Automatic mail</H2>
      <p>
        Out-of-office replies, bounces, mailing lists and other automated mail (detected from <code>Auto-Submitted</code>,{" "}
        <code>Precedence</code>, list headers, null return paths and delivery reports) are recorded on the ticket but never
        reopen it, notify anyone or get an acknowledgement. Mail from your own addresses and from <code>ignoreFrom</code> is
        dropped, so a copy rule can&apos;t loop.
      </p>

      <H2 id="authentication">Sender authentication</H2>
      <Callout title="Spoofing doesn't get anyone into an account">
        When the receiving provider reports that a message failed DMARC, or failed both SPF and DKIM, Tendkit treats the
        sender as untrusted: it isn&apos;t matched to an account, gets no automatic reply, and can only join a ticket through
        the reply address token.
      </Callout>

      <H2 id="deliverability">Deliverability</H2>
      <p>
        Replies are sent from your domain, so it needs SPF, DKIM and a DMARC record for every service that sends as it
        (your mailbox provider and your sending provider). Acknowledgements carry <code>Auto-Submitted: auto-replied</code>{" "}
        so other auto-responders don&apos;t answer them.
      </p>
    </DocsShell>
  );
}
