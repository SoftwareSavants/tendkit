/**
 * The support domain: tickets, the messages in them and the people behind them.
 * Nothing here knows about a database, a framework or a provider.
 */

export type TicketStatus = "open" | "waiting" | "solved" | "spam";

/** inbound: from the customer. outbound: to the customer. note: internal, never sent. */
export type MessageKind = "inbound" | "outbound" | "note";

export type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";

/** How a person is reached on a channel: an email address, an E.164 phone number, … */
export type IdentityKind = "email" | "phone" | "whatsapp" | "telegram" | (string & {});

export type Identity = { kind: IdentityKind; value: string };

export type Address = { address: string; name?: string | null };

export type Contact = {
  id: string;
  name: string | null;
  /** The product's customer (an organization, an account, …) this person belongs to. */
  customerId: string | null;
  /** The product's user id, when the person has an account. */
  userId: string | null;
  locale: string | null;
  blockedAt: Date | null;
  identities: Identity[];
};

export type Ticket = {
  id: string;
  /** A short number for agents to refer to a ticket. Never shown to customers. */
  number: number;
  channelId: string;
  subject: string | null;
  status: TicketStatus;
  contactId: string;
  customerId: string | null;
  assigneeId: string | null;
  /** Random token carried in reply addresses, so a reply finds its ticket even without headers. */
  replyToken: string;
  providerThreadId: string | null;
  /** When the customer's oldest unanswered message arrived; null when nobody is waiting on us. */
  waitingSince: Date | null;
  lastMessageAt: Date;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  solvedAt: Date | null;
  /** The latest public message, shortened, for lists. */
  preview: string | null;
  previewKind: "inbound" | "outbound" | null;
  previewAuthorId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Attachment = {
  id: string;
  messageId: string | null;
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
  /** For inline images referenced as cid: in HTML. */
  contentId: string | null;
  inline: boolean;
};

export type Message = {
  id: string;
  ticketId: string;
  kind: MessageKind;
  channelId: string | null;
  /** The agent for outbound messages and notes; the customer's user id for messages written in a portal. */
  authorId: string | null;
  from: Address | null;
  to: Address[];
  cc: Address[];
  subject: string | null;
  /** What the person actually wrote this time: quoted history and signatures removed. */
  text: string;
  /** The whole plain-text body, quotes included. */
  fullText: string | null;
  /** The original HTML, sanitized. */
  html: string | null;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  providerMessageId: string | null;
  deliveryStatus: DeliveryStatus | null;
  deliveryError: string | null;
  /** Sent or received automatically: acknowledgements, out-of-office replies. */
  auto: boolean;
  source: "channel" | "portal" | "agent" | "api";
  createdAt: Date;
  attachments: Attachment[];
};

export type TicketEventType =
  | "created"
  | "assigned"
  | "status_changed"
  | "customer_linked"
  | "reopened"
  | "follow_up"
  | "contact_changed"
  | "forwarded";

export type TicketEvent = {
  id: string;
  ticketId: string;
  type: TicketEventType;
  actorId: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
};

export type Agent = { id: string; name: string; email?: string | null };

export type CustomerSummary = { id: string; name: string };
