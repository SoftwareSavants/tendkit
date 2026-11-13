import type { Metadata } from "next";
import { Code } from "@/site/code";
import { GITHUB_URL } from "@/site/config";
import { Callout, DocsShell, H2, Props } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "Write an adapter",
  description: "Implement the Channel interface to connect any provider to Tendkit.",
  alternates: { canonical: "/docs/channels/custom" },
};

const SKELETON = `import { WebhookError, type Channel } from "@/lib/support/channel";

export function acmeChatChannel(config: { id: string; apiKey: string; signingSecret: string }): Channel {
  return {
    id: config.id,
    kind: "api",
    identityKind: "email",
    address: "Acme Chat",
    capabilities: {
      subject: false,
      attachments: false,
      maxTextLength: 4000,
      conversation: "contact", // one running conversation per person
      replyWindowHours: null,
      deliveryReceipts: false,
      canStartConversation: false, // the customer has to write first
    },

    async webhook(request) {
      const body = await request.text();
      if (!(await verify(config.signingSecret, request.headers, body))) {
        throw new WebhookError("Invalid signature");
      }
      const payload = JSON.parse(body);
      return {
        events: [
          {
            type: "message",
            message: {
              providerMessageId: payload.id,
              from: { address: payload.user.email, name: payload.user.name },
              to: [{ address: "Acme Chat" }],
              text: payload.text,
              receivedAt: new Date(payload.sentAt),
            },
          },
        ],
      };
    },

    async send(message) {
      const res = await fetch("https://api.acmechat.example/messages", {
        method: "POST",
        headers: { authorization: \`Bearer \${config.apiKey}\`, "content-type": "application/json" },
        body: JSON.stringify({ to: message.to[0]!.address, text: message.text }),
      });
      const data = await res.json();
      return { providerMessageId: data.id };
    },
  };
}`;

export default function Custom() {
  return (
    <DocsShell
      href="/docs/channels/custom"
      toc={[
        { id: "the-interface", title: "The interface" },
        { id: "example", title: "Example" },
        { id: "rules", title: "Rules" },
        { id: "contribute", title: "Contribute it" },
      ]}
    >
      <H2 id="the-interface">The interface</H2>
      <Props
        rows={[
          { name: "id", type: "string", required: true, description: "From your config; stored on tickets." },
          { name: "kind", type: '"email" | "sms" | "whatsapp" | "telegram" | "api"', required: true, description: "How the inbox treats it: email gets subjects, HTML and threading headers." },
          { name: "identityKind", type: "IdentityKind", required: true, description: "How senders are identified: email or phone, for example." },
          { name: "address", type: "string", required: true, description: "What customers write to, for display." },
          { name: "capabilities", type: "ChannelCapabilities", required: true, description: "Subjects, attachment limits, maximum length, one conversation per thread or per person, any reply window, delivery receipts, and whether your team can write first (canStartConversation). The composer enforces them." },
          { name: "replyAddress", type: "string", description: "Email only: an address that routes back, carrying the ticket token." },
          { name: "webhook", type: "(request) => { events, response? }", description: "Verify, parse, return events. Return response when the provider expects a specific body." },
          { name: "sync", type: "(state) => { events, state }", description: "For polled providers and renewing subscriptions. Called by runScheduled with the last state." },
          { name: "send", type: "(message) => SendResult", required: true, description: "Send a reply. Throw ChannelError with retryable set when a retry might work." },
        ]}
      />

      <H2 id="example">Example</H2>
      <Code title="lib/support/channels/acme-chat.ts" lang="ts" code={SKELETON} />

      <H2 id="rules">Rules</H2>
      <ul>
        <li>Translate only. Don&apos;t thread, store or decide anything: the service does that the same way for every channel.</li>
        <li>
          Use <code>fetch</code> and WebCrypto only, so the adapter runs on Workers, Node, Bun and Deno. No provider SDKs.
        </li>
        <li>Verify every webhook, in constant time, and reject old timestamps where the provider sends them.</li>
        <li>
          Return a <code>providerMessageId</code> for every message and status event: it&apos;s how redelivery stays
          idempotent.
        </li>
        <li>
          <code>sync</code> must be safe to run twice at once: returning the same events again is fine.
        </li>
        <li>
          Set <code>canStartConversation</code> to say whether <code>send</code> can reach someone who hasn&apos;t
          written yet, which is what <code>startTicket</code> and outreach need. It is optional: left out, a channel
          can write first when it has no reply window and its kind isn&apos;t <code>&quot;api&quot;</code>. A channel
          with a reply window is reported as needing a template unless you set it to <code>true</code>.
        </li>
      </ul>

      <H2 id="contribute">Contribute it</H2>
      <Callout>
        Add tests with recorded payloads from the provider&apos;s docs, an entry in <code>registry.json</code>, and open a pull
        request. The <a href={`${GITHUB_URL}/blob/main/CONTRIBUTING.md`}>contributing guide</a> has the checklist.
      </Callout>
    </DocsShell>
  );
}
