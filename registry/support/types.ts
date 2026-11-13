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
  | "forwarded"
  /** An agent corrected the topic or urgency Copilot gave the ticket. */
  | "insight_changed";

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

/** One line about a customer's account, from `directory.describeCustomer`. */
export type AccountFact = { label: string; value: string; url?: string | null };

export type Urgency = "urgent" | "high" | "normal" | "low";
export type Mood = "calm" | "confused" | "frustrated" | "angry";

/** What Copilot understood of a ticket from the customer's latest message. */
export type TicketInsight = {
  ticketId: string;
  basedOnMessageId: string | null;
  /** One of the topics in the AI settings, or "other". */
  topic: string | null;
  urgency: Urgency | null;
  urgencyReason: string | null;
  mood: Mood | null;
  /** BCP-47, such as "en" or "pt-BR": the language the customer writes in. */
  language: string | null;
  /** One line, in the agents' language. */
  summary: string | null;
  /** Set when an agent changed the topic or urgency; Copilot doesn't overwrite them. */
  topicSetBy: string | null;
  urgencySetBy: string | null;
  updatedAt: Date;
};

export type SuggestionSource = { type: "knowledge" | "answer" | "fact" | "guidance"; id: string; title: string; url?: string | null };

export type SuggestionStatus = "pending" | "used" | "edited" | "discarded" | "stale";

/** A reply Copilot drafted, or why it couldn't. */
export type Suggestion = {
  id: string;
  ticketId: string;
  basedOnMessageId: string;
  kind: "draft" | "cannot_answer";
  text: string | null;
  reason: string | null;
  sources: SuggestionSource[];
  status: SuggestionStatus;
  createdAt: Date;
};

/**
 * An answer the team wrote once and approved for reuse. Drafts treat it as their most trusted
 * source, and agents insert it into the reply box as it is.
 */
export type ApprovedAnswer = {
  id: string;
  /** The question it answers, or a short title. */
  title: string;
  /** May hold the placeholders {name}, {company} and {agent}, filled in when it's used. */
  text: string;
  /** BCP-47. Set: only for customers writing in this language. Null: for everyone. */
  language: string | null;
  /** The ticket it was saved from, when there was one. */
  ticketId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A rule the team's own edits suggest adding to the guidance. Nothing changes until someone accepts it. */
export type GuidanceSuggestion = {
  id: string;
  /** The line to add to the guidance. */
  rule: string;
  /** What agents kept doing that suggests it. */
  reason: string;
  /** Tickets where they did it. */
  ticketIds: string[];
  status: "pending" | "accepted" | "dismissed";
  createdAt: Date;
};

/** A question the knowledge didn't answer, or one whose draft agents threw away. */
export type Gap = {
  id: string;
  theme: string;
  status: "open" | "resolved" | "dismissed";
  /** Tickets that asked it. */
  count: number;
  lastSeenAt: Date | null;
  /** The latest few. */
  tickets: { id: string; number: number; subject: string | null }[];
  createdAt: Date;
};
