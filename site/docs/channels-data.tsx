import type { ReactNode } from "react";

/*
 * Each adapter's docs page. Setup, options and behaviour are taken from the adapter's own source
 * (registry/support/channels/*.ts); keep them in sync when an adapter changes.
 */

type Option = { name: string; type: string; description: ReactNode; required?: boolean; default?: string };

export type ChannelDoc = {
  slug: string;
  item: string;
  name: string;
  kind: string;
  setup: { title: string; body: ReactNode }[];
  config: string;
  options: Option[];
  notes: ReactNode[];
};

const common = {
  id: { name: "id", type: "string", required: true, description: "Stable channel id, stored on every ticket and used in the webhook URL. Never change it." },
  fetch: { name: "fetch / baseUrl", type: "", description: "For tests and proxies." },
} satisfies Record<string, Option>;

export const CHANNEL_DOCS: ChannelDoc[] = [
  {
    slug: "resend",
    item: "channel-resend",
    name: "Resend",
    kind: "Email",
    setup: [
      { title: "Verify your sending domain", body: <>In Resend, verify <code>acme.com</code> so replies go out from <code>support@acme.com</code>.</> },
      {
        title: "Add a receiving domain",
        body: (
          <>
            Add <code>in.acme.com</code> with receiving on, and its MX record in your DNS. To keep your mailbox, copy{" "}
            <code>support@acme.com</code> to <code>support@in.acme.com</code> (see <a href="/docs/email">Email setup</a>).
          </>
        ),
      },
      { title: "Create a full access API key", body: <>Reading received mail needs more than a sending-only key.</> },
      {
        title: "Add the webhook",
        body: (
          <>
            Point it at <code>/api/webhooks/support/email</code> with <code>email.received</code>, <code>email.sent</code>,{" "}
            <code>email.delivered</code>, <code>email.bounced</code>, <code>email.failed</code>, <code>email.suppressed</code> and{" "}
            <code>email.complained</code>, and pass its signing secret as <code>webhookSecret</code>.
          </>
        ),
      },
    ],
    config: `resendChannel({
  id: "email",
  apiKey: process.env.RESEND_API_KEY!,
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
  address: "support@acme.com",
  replyAddress: "support@in.acme.com",
  receivingDomains: ["in.acme.com"],
})`,
    options: [
      common.id,
      { name: "apiKey", type: "string", required: true, description: "A full access key." },
      { name: "webhookSecret", type: "string", required: true, description: 'The webhook\'s signing secret, "whsec_…".' },
      { name: "address", type: "string", required: true, description: "What customers write to and replies are sent from." },
      { name: "replyAddress", type: "string", required: true, description: "An address on your Resend receiving domain." },
      { name: "receivingDomains", type: "string[]", description: "Only accept mail addressed to these domains. Set it when several products share one Resend account." },
      common.fetch,
    ],
    notes: [
      <>Delivery, bounce and complaint events update each reply&apos;s status, and failures notify your team.</>,
      <>Threading headers are read from the raw message, so they work even when the API omits them.</>,
      <>Your team can write first on it: <a href="/docs/proactive#start-a-conversation">New ticket</a> and outreach go out from the same address.</>,
    ],
  },
  {
    slug: "microsoft365",
    item: "channel-microsoft365",
    name: "Microsoft 365",
    kind: "Email",
    setup: [
      {
        title: "Register an app",
        body: <>Entra admin center → App registrations → New registration (single tenant). Copy the tenant and client ids and add a client secret.</>,
      },
      {
        title: "Scope it to one mailbox",
        body: (
          <>
            Don&apos;t grant Mail.* permissions in Entra: a tenant-wide grant overrides any scoping. Use Exchange RBAC for
            Applications instead, giving the app <code>Application Mail.ReadWrite</code> and{" "}
            <code>Application Mail.Send</code> on a management scope that contains only the support mailbox. Changes can
            take up to two hours.
          </>
        ),
      },
      {
        title: "Shared mailboxes",
        body: (
          <>
            So replies agents send from Outlook with Send As reach the ticket, run{" "}
            <code>Set-Mailbox support@acme.com -MessageCopyForSentAsEnabled $true -MessageCopyForSendOnBehalfEnabled $true</code>.
          </>
        ),
      },
      {
        title: "Optional push",
        body: (
          <>
            Set <code>notificationUrl</code> to the channel&apos;s webhook URL and <code>clientState</code> to a long random
            secret. Run <code>runScheduled()</code> either way: it creates and renews the subscription and sweeps the mailbox,
            since Graph can drop notifications.
          </>
        ),
      },
    ],
    config: `microsoft365Channel({
  id: "email",
  tenantId: process.env.MS_TENANT_ID!,
  clientId: process.env.MS_CLIENT_ID!,
  clientSecret: process.env.MS_CLIENT_SECRET!,
  mailbox: "support@acme.com",
  notificationUrl: "https://acme.com/api/webhooks/support/email",
  clientState: process.env.MS_CLIENT_STATE!,
})`,
    options: [
      common.id,
      { name: "tenantId", type: "string", required: true, description: "Directory (tenant) id of the tenant that owns the mailbox." },
      { name: "clientId", type: "string", required: true, description: "Application (client) id." },
      { name: "clientSecret", type: "string", required: true, description: "The app's client secret." },
      { name: "mailbox", type: "string", required: true, description: "The user or shared mailbox to read and send from." },
      { name: "notificationUrl", type: "string", description: "Public webhook URL for change notifications. Omit to poll only." },
      { name: "clientState", type: "string", description: "Secret Graph echoes in every notification. Required with notificationUrl." },
      { name: "baseUrl", type: "string", description: "Microsoft Graph base URL, for national clouds." },
    ],
    notes: [
      <>Replies your team sends from Outlook are recorded on the ticket from Sent Items. Junk Email is never read.</>,
      <>Mail goes out as the mailbox itself, so it uses the mailbox&apos;s display name rather than <code>fromName</code>.</>,
      <>Your team can write first on it: <a href="/docs/proactive#start-a-conversation">New ticket</a> and outreach go out from the mailbox.</>,
    ],
  },
  {
    slug: "gmail",
    item: "channel-gmail",
    name: "Gmail",
    kind: "Email",
    setup: [
      { title: "Enable the Gmail API", body: <>In Google Cloud, enable the Gmail API and create a service account with a JSON key.</> },
      {
        title: "Delegate access (Google Workspace)",
        body: (
          <>
            Admin console → Security → API controls → Domain-wide delegation: add the service account&apos;s client id with the
            scope <code>https://www.googleapis.com/auth/gmail.modify</code>. It can take up to 24 hours.
          </>
        ),
      },
      {
        title: "Or, a single Gmail account",
        body: (
          <>
            Create an OAuth client, run the consent flow once with <code>access_type=offline&amp;prompt=consent</code> and
            scope gmail.modify, and pass the refresh token. Apps left in Testing get refresh tokens that expire after 7 days.
          </>
        ),
      },
      {
        title: "Run the schedule, optionally push",
        body: (
          <>
            <code>runScheduled()</code> polls the mailbox history. For replies within seconds, create a Pub/Sub topic, grant{" "}
            <code>gmail-api-push@system.gserviceaccount.com</code> the Publisher role, add an authenticated push subscription to
            the channel&apos;s webhook URL and pass <code>pubsub</code>. The watch is renewed daily.
          </>
        ),
      },
    ],
    config: `gmailChannel({
  id: "email",
  mailbox: "support@acme.com",
  auth: {
    serviceAccount: {
      clientEmail: process.env.GOOGLE_CLIENT_EMAIL!,
      privateKey: process.env.GOOGLE_PRIVATE_KEY!,
    },
  },
  pubsub: { topic: "projects/acme/topics/gmail-support" },
})`,
    options: [
      common.id,
      { name: "mailbox", type: "string", required: true, description: "The mailbox customers write to." },
      { name: "auth", type: "{ serviceAccount } | { oauth }", required: true, description: "A service account with domain-wide delegation, or an OAuth refresh token." },
      { name: "replyAddress", type: "string", description: "An extra address that routes to this mailbox, used for the ticket token." },
      { name: "pubsub", type: "{ topic, audience?, serviceAccountEmail? }", description: "Push notifications. Without it the mailbox is polled only." },
      common.fetch,
    ],
    notes: [<>Replies your team writes in Gmail show up on the ticket.</>, <>Each sync fetches up to 100 messages; the rest come next time.</>, <>Your team can write first on it: <a href="/docs/proactive#start-a-conversation">New ticket</a> and outreach go out from the mailbox.</>],
  },
  {
    slug: "smtp",
    item: "channel-smtp",
    name: "SMTP and IMAP",
    kind: "Email",
    setup: [
      {
        title: "Pick your network libraries",
        body: (
          <>
            The adapter builds and parses MIME; you inject two functions: <code>smtp.send(raw, envelope)</code> and{" "}
            <code>imap.fetchSince(state)</code>. On Node, nodemailer and imapflow work well. On Cloudflare Workers use port 587
            or 465 (25 is blocked), with nodemailer or worker-mailer for SMTP and imapflow for IMAP.
          </>
        ),
      },
      {
        title: "Track position by UID",
        body: (
          <>
            Store the mailbox&apos;s UIDVALIDITY and next UID in the returned state. On the first call return no messages,
            only the current position, so old mail isn&apos;t imported.
          </>
        ),
      },
      { title: "Run the schedule", body: <><code>runScheduled()</code> calls your IMAP poller. Keep each run short; return at most a batch of messages.</> },
    ],
    config: `smtpChannel({
  id: "email",
  address: "support@acme.com",
  smtp: {
    send: (raw, envelope) =>
      transporter.sendMail({ raw: Buffer.from(raw), envelope }).then(() => {}),
  },
  imap: { fetchSince: (state) => pollInbox(state) },
})`,
    options: [
      common.id,
      { name: "address", type: "string", required: true, description: "The address customers write to and replies come from." },
      { name: "smtp", type: "{ send(raw, envelope) }", required: true, description: "Delivers one complete RFC 5322 message." },
      { name: "imap", type: "{ fetchSince(state) }", description: "Reads the inbox. Leave out when mail arrives another way." },
      { name: "replyAddress", type: "string", description: "An address that routes back to this mailbox, for the ticket token." },
    ],
    notes: [<>Works with Fastmail, Zoho, cPanel hosting, or Gmail and Microsoft 365 with an app password.</>, <>Your team can write first on it: <a href="/docs/proactive#start-a-conversation">New ticket</a> and outreach go out through your SMTP transport.</>],
  },
  {
    slug: "twilio",
    item: "channel-twilio",
    name: "Twilio",
    kind: "SMS and WhatsApp",
    setup: [
      { title: "Get a number", body: <>Buy a number, or connect a WhatsApp sender, in the Twilio Console.</> },
      {
        title: "Point incoming messages at your webhook",
        body: (
          <>
            Under &quot;A message comes in&quot;, set the channel&apos;s webhook URL with POST, and pass the exact same URL as{" "}
            <code>webhookUrl</code>: Twilio signs it character for character.
          </>
        ),
      },
      { title: "Create an API key", body: <>Account → API keys. Pass it as apiKeySid and apiKeySecret; keep authToken for webhook signatures.</> },
    ],
    config: `twilioChannel({
  id: "whatsapp",
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  apiKeySid: process.env.TWILIO_API_KEY_SID!,
  apiKeySecret: process.env.TWILIO_API_KEY_SECRET!,
  from: "whatsapp:+14155550133", // or "+14155550133" for SMS
  webhookUrl: "https://acme.com/api/webhooks/support/whatsapp",
})`,
    options: [
      common.id,
      { name: "accountSid", type: "string", required: true, description: '"AC…".' },
      { name: "authToken", type: "string", required: true, description: "The primary Auth Token. Twilio signs webhooks with it." },
      { name: "apiKeySid / apiKeySecret", type: "string", description: "An API key for REST calls; recommended over the Auth Token." },
      { name: "from", type: "string", required: true, description: 'The number: "+14155550133" for SMS, "whatsapp:+14155550133" for WhatsApp.' },
      { name: "messagingServiceSid", type: "string", description: "Send through a Messaging Service instead of from." },
      { name: "webhookUrl", type: "string", required: true, description: "The exact public URL configured in Twilio." },
      { name: "statusCallbackUrl", type: "string", description: "Where delivery updates go. Defaults to webhookUrl." },
      { name: "address", type: "string", description: "Shown to agents. Defaults to from without the whatsapp: prefix." },
    ],
    notes: [
      <>SMS: no attachments, 1,600 characters, billed per segment. Two-way SMS isn&apos;t available in every country; check Twilio&apos;s guidelines for yours.</>,
      <>WhatsApp: replies are allowed for 24 hours after the customer&apos;s last message. After that the composer explains why it can&apos;t send.</>,
      <>Writing first: an SMS number can <a href="/docs/proactive#start-a-conversation">start a conversation</a>. A WhatsApp sender can&apos;t, since a first message needs an approved template, which this adapter doesn&apos;t send.</>,
    ],
  },
  {
    slug: "whatsapp",
    item: "channel-whatsapp",
    name: "WhatsApp Cloud API",
    kind: "WhatsApp",
    setup: [
      { title: "Create a Meta app", body: <>Type Business, with the WhatsApp product, and add your business number.</> },
      {
        title: "Create a System User token",
        body: <>Business settings → System users. Assign the app and WhatsApp account, and generate a token with whatsapp_business_messaging and whatsapp_business_management.</>,
      },
      {
        title: "Register the webhook",
        body: (
          <>
            App → WhatsApp → Configuration: callback URL = the channel&apos;s webhook URL, verify token = your{" "}
            <code>verifyToken</code>; subscribe to <code>messages</code>. Meta verifies with a GET, so export GET from your
            route too.
          </>
        ),
      },
      { title: "Add a payment method", body: <>Meta charges replies per message after a monthly free tier, and stops delivering them when the tier runs out without one.</> },
    ],
    config: `whatsappChannel({
  id: "whatsapp",
  phoneNumberId: process.env.WA_PHONE_NUMBER_ID!,
  accessToken: process.env.WA_ACCESS_TOKEN!,
  appSecret: process.env.WA_APP_SECRET!,
  verifyToken: process.env.WA_VERIFY_TOKEN!,
  displayNumber: "+1 415 555 0133",
})`,
    options: [
      common.id,
      { name: "phoneNumberId", type: "string", required: true, description: "The business number's id, not the number itself." },
      { name: "accessToken", type: "string", required: true, description: "A System User token." },
      { name: "appSecret", type: "string", required: true, description: "App settings → Basic. Signs webhook deliveries." },
      { name: "verifyToken", type: "string", required: true, description: "Any string; Meta echoes it when you register the webhook." },
      { name: "displayNumber", type: "string", required: true, description: "The number customers write to, for display." },
      { name: "apiVersion", type: "string", description: "Graph API version." },
    ],
    notes: [
      <>Replies are allowed for 24 hours after the customer&apos;s last message; this adapter doesn&apos;t send templates.</>,
      <>For the same reason your team can&apos;t <a href="/docs/proactive#start-a-conversation">start a conversation</a> on it: the customer has to write first.</>,
      <>Reactions and system notices are ignored, so they never reopen a ticket.</>,
    ],
  },
  {
    slug: "telegram",
    item: "channel-telegram",
    name: "Telegram",
    kind: "Chat",
    setup: [
      { title: "Create the bot", body: <>With @BotFather (<code>/newbot</code>). Copy the token.</> },
      {
        title: "Register the webhook",
        body: (
          <>
            Once: <code>curl https://api.telegram.org/bot&lt;token&gt;/setWebhook -d url=&lt;webhook URL&gt; -d secret_token=&lt;secretToken&gt;</code>{" "}
            with <code>allowed_updates</code> set to messages.
          </>
        ),
      },
    ],
    config: `telegramChannel({
  id: "telegram",
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  secretToken: process.env.TELEGRAM_SECRET_TOKEN!,
  botUsername: "acme_support_bot",
})`,
    options: [
      common.id,
      { name: "botToken", type: "string", required: true, description: "From @BotFather. It's part of file download URLs, so never log those." },
      { name: "secretToken", type: "string", required: true, description: "The secret_token passed to setWebhook: 1 to 256 of A-Z, a-z, 0-9, _ and -." },
      { name: "botUsername", type: "string", required: true, description: 'Without the "@", for display.' },
    ],
    notes: [<>Only private chats are handled. The bot can only write to people who messaged it first, so your team can&apos;t <a href="/docs/proactive#start-a-conversation">start a conversation</a> on it. Files up to 20 MB.</>],
  },
  {
    slug: "api",
    item: "channel-api",
    name: "Signed API",
    kind: "Your forms",
    setup: [
      { title: "Generate a secret", body: <>&quot;whsec_&quot; plus the base64 of 32 random bytes. Keep it on your server.</> },
      { title: "Configure the channel", body: <>Usually with <code>kind: &quot;email&quot;</code>, so replies go out by email through your email channel.</> },
      {
        title: "Post from your backend",
        body: (
          <>
            Sign each request with <code>signApiRequest(secret, body)</code> and POST the JSON message to the channel&apos;s
            webhook URL. Never sign in a browser.
          </>
        ),
      },
    ],
    config: `const email = resendChannel({ /* … */ });

apiChannel({
  id: "contact-form",
  secret: process.env.CONTACT_FORM_SECRET!,
  address: "Contact form",
  kind: "email",
  replyAddress: "support@in.acme.com",
  deliver: (message) => email.send(message),
  capabilities: email.capabilities,
})

// In your contact form's server action:
const body = JSON.stringify({ id: submission.id, from: { email, name }, subject, text });
await fetch("https://acme.com/api/webhooks/support/contact-form", {
  method: "POST",
  headers: await signApiRequest(process.env.CONTACT_FORM_SECRET!, body),
  body,
});`,
    options: [
      common.id,
      { name: "secret", type: "string", required: true, description: '"whsec_" + base64 of 24 to 64 random bytes, shared with the app that signs.' },
      { name: "address", type: "string", required: true, description: 'Where the ticket came from, such as "Contact form".' },
      { name: "deliver", type: "(message) => SendResult", required: true, description: "Sends replies. Usually your email channel's send." },
      { name: "kind", type: '"api" | "email"', default: '"api"', description: '"email" gives replies a subject, HTML, acknowledgements and a threading reply address.' },
      { name: "replyAddress", type: "string", description: "The email channel's receiving address, so answers return to the ticket." },
      { name: "capabilities", type: "Partial<ChannelCapabilities>", description: "Usually the delivering channel's." },
    ],
    notes: [
      <>Resending the same message <code>id</code> is a no-op, so retries are safe.</>,
      <>API messages are untrusted: they never link to an account, so a form can&apos;t impersonate a customer.</>,
      <>It only receives: your team can&apos;t <a href="/docs/proactive#start-a-conversation">start a conversation</a> on it. Use the delivering email channel for that.</>,
    ],
  },
];
