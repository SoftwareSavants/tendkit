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
  | "insight_changed"
  /** An agent ran an action, or approved one Copilot proposed. For agents only: customers never see events. */
  | "action_run"
  /** Autopilot sent a reply with nobody reading it first. For agents only. */
  | "autopilot_sent"
  /** An agent marked a reply Autopilot sent as wrong. */
  | "autopilot_flagged";

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

export type SuggestionSource = {
  type: "knowledge" | "answer" | "fact" | "guidance" | "action";
  id: string;
  title: string;
  url?: string | null;
  /** For "action": what the lookup found, in one line. */
  detail?: string | null;
};

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
  /** Changes the draft assumes: each waits for an agent to approve or skip it. */
  actions: ProposedAction[];
  status: SuggestionStatus;
  /** The ticket's topic and the customer's language when it was drafted: what its outcome counts towards. */
  topic: string | null;
  language: string | null;
  /** Set when the topic is on Autopilot: where this reply stands. Null for an ordinary suggestion. */
  autopilot: AutopilotState | null;
  /** When a held reply is sent unless someone steps in. */
  sendAt: Date | null;
  /** Why Autopilot left this reply to a person, when the topic is on. */
  autopilotBlock: AutopilotBlock | null;
  createdAt: Date;
};

/** "hold": queued, then sent after a delay unless someone steps in. "immediate": sent as soon as it's drafted. */
export type AutopilotMode = "hold" | "immediate";

/**
 * held: waiting out the delay. sending: being sent. sent: went out. cancelled: someone stepped in,
 * or it no longer applied when its time came. failed: the channel didn't take it.
 */
export type AutopilotState = "held" | "sending" | "sent" | "cancelled" | "failed";

/** Why a reply on an Autopilot topic went to a person instead. */
export type AutopilotBlock =
  | "stopped"
  | "unknown_customer"
  | "channel"
  | "asked_for_human"
  | "not_helped"
  | "mood"
  | "urgency"
  | "long_thread"
  | "needs_approval"
  | "not_confident"
  | "unsourced"
  | "language"
  | "hourly_cap"
  /** An agent stopped a held reply. */
  | "held_back"
  /** By the time a held reply was due, the ticket had moved on: a note, a status change, a paused topic. */
  | "moved_on"
  | "send_failed";

/** "always": an agent approves every run. "never": a read-only lookup Copilot may run while drafting. */
export type ActionApproval = "always" | "never";

/** One input of an action, as a form field. Built from the action's schema. */
export type ActionField = {
  name: string;
  label: string;
  description: string | null;
  /** "json" is the fallback for shapes a small form can't show: lists and nested objects. */
  kind: "text" | "number" | "boolean" | "select" | "date" | "json";
  required: boolean;
  options?: string[];
};

/** An action an agent can run on a ticket. */
export type TicketAction = { name: string; title: string; description: string; approval: ActionApproval; fields: ActionField[] };

/** A declared action, for the settings screen. `enabled` only varies for "never" actions: the team can stop Copilot running them on its own. */
export type ActionSetting = { name: string; title: string; description: string; approval: ActionApproval; enabled: boolean };

/**
 * succeeded and failed are what your `run` answered (`ok`). timed_out and errored mean it didn't
 * answer: the change may or may not have happened.
 */
export type ActionRunStatus = "running" | "succeeded" | "failed" | "timed_out" | "errored";

/** One run of an action: the log entry. */
export type ActionRun = {
  id: string;
  ticketId: string;
  /** The suggestion that proposed it, or whose draft looked it up. */
  suggestionId: string | null;
  action: string;
  title: string;
  input: Record<string, unknown>;
  /** "draft": a lookup Copilot ran while drafting. "suggestion": a proposal an agent approved. "manual": run from the ticket's menu. */
  trigger: "draft" | "suggestion" | "manual";
  status: ActionRunStatus;
  /** What your `run` said happened. */
  summary: string | null;
  data: Record<string, unknown> | null;
  /** The agent who approved or ran it. Null for lookups Copilot ran. */
  approvedBy: string | null;
  durationMs: number | null;
  createdAt: Date;
  finishedAt: Date | null;
};

/** An action Copilot proposes with a draft, as stored. */
export type ProposedAction = {
  name: string;
  title: string;
  input: Record<string, unknown>;
  /** Why the conversation calls for it, for the agent. */
  reason: string;
  /** An agent skipped it. */
  declined: boolean;
};

/** A proposed action with what an agent needs to decide on it. */
export type ProposedActionView = ProposedAction & {
  state: "proposed" | "running" | "done" | "failed" | "declined";
  fields: ActionField[];
  /** Its latest run, once approved. */
  run: ActionRun | null;
};

export type SuggestionView = Omit<Suggestion, "actions"> & { actions: ProposedActionView[] };

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
