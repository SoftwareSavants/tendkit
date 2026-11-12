/** Every docs page, in reading order. Drives the sidebar, previous/next links and search. */
export type DocLink = { title: string; href: string; description: string };
export type DocGroup = { title: string; pages: DocLink[] };

export const DOCS: DocGroup[] = [
  {
    title: "Getting started",
    pages: [
      { title: "Introduction", href: "/docs", description: "What Tendkit is, what you get, and how the pieces fit together." },
      { title: "Installation", href: "/docs/installation", description: "Add Tendkit to a Next.js app with the shadcn CLI and create the tables." },
      { title: "The service", href: "/docs/service", description: "createSupport: storage, channels, notifications, automatic replies and every option." },
      { title: "Your directory", href: "/docs/directory", description: "Tell Tendkit who wrote: users, customers and agents from your own database." },
      { title: "Webhooks and scheduling", href: "/docs/webhooks", description: "Receive provider webhooks and run the job that polls and renews channels." },
    ],
  },
  {
    title: "Screens",
    pages: [
      { title: "Inbox and tickets", href: "/docs/screens", description: "Mount SupportInbox and SupportTicket behind your own API and auth." },
      { title: "Customer portal", href: "/docs/portal", description: "Let customers open and follow their requests inside your app." },
      { title: "Theming", href: "/docs/theming", description: "The screens use your shadcn/ui components and tokens. Change anything." },
    ],
  },
  {
    title: "AI",
    pages: [
      { title: "AI", href: "/docs/ai", description: "Optional: triage, summaries and suggested replies from your docs, with any AI SDK model." },
    ],
  },
  {
    title: "Email",
    pages: [
      { title: "Email setup", href: "/docs/email", description: "Receiving domains, threading, trimming, automatic mail and sender authentication." },
    ],
  },
  {
    title: "Channels",
    pages: [
      { title: "Overview", href: "/docs/channels", description: "Every adapter, how channels are identified, and how to choose." },
      { title: "Resend", href: "/docs/channels/resend", description: "Send with Resend and receive on a Resend receiving domain." },
      { title: "Microsoft 365", href: "/docs/channels/microsoft365", description: "A shared or user mailbox through Microsoft Graph, scoped to one mailbox." },
      { title: "Gmail", href: "/docs/channels/gmail", description: "Google Workspace or Gmail through the Gmail API, with optional Pub/Sub push." },
      { title: "SMTP and IMAP", href: "/docs/channels/smtp", description: "Any mailbox: you bring the SMTP transport and IMAP poller for your runtime." },
      { title: "Twilio", href: "/docs/channels/twilio", description: "SMS and WhatsApp through a Twilio number or Messaging Service." },
      { title: "WhatsApp Cloud API", href: "/docs/channels/whatsapp", description: "WhatsApp Business directly with Meta." },
      { title: "Telegram", href: "/docs/channels/telegram", description: "A Telegram bot your customers message." },
      { title: "Signed API", href: "/docs/channels/api", description: "Tickets from your own forms and backends, with signed requests." },
      { title: "Write an adapter", href: "/docs/channels/custom", description: "Implement the Channel interface for any provider." },
    ],
  },
  {
    title: "Project",
    pages: [{ title: "Upgrading", href: "/docs/upgrading", description: "Take upstream fixes into code you've copied and changed." }],
  },
];

export const ALL_PAGES = DOCS.flatMap((g) => g.pages);
