/**
 * What the support screens need from your server. Implement it with your API layer
 * (oRPC, tRPC, route handlers, server actions) calling the support service.
 * Dates may arrive as Date or ISO strings; the screens accept both.
 */

export type DateLike = Date | string;
export type TicketStatus = "open" | "waiting" | "solved" | "spam";
export type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";
export type Identity = { kind: string; value: string };
export type Agent = { id: string; name: string };
export type Customer = { id: string; name: string };
export type FileInfo = { id: string; filename: string; contentType: string; size: number };
export type Address = { address: string; name?: string | null };
/** One line about a customer's account, from your directory's `describeCustomer`. */
export type AccountFact = { label: string; value: string; url?: string | null };
export type Urgency = "urgent" | "high" | "normal" | "low";
export type Mood = "calm" | "confused" | "frustrated" | "angry";

/** What AI understood of the customer's latest message. */
export type TicketInsight = {
  topic: string | null;
  urgency: Urgency | null;
  urgencyReason: string | null;
  mood: Mood | null;
  /** BCP-47: the language the customer writes in. */
  language: string | null;
  summary: string | null;
};

export type SuggestionSource = {
  type: "knowledge" | "answer" | "fact" | "guidance" | "action";
  id: string;
  title: string;
  url?: string | null;
  /** For "action": what the lookup found. */
  detail?: string | null;
};

/** One input of an action, as a form field. */
export type ActionField = {
  name: string;
  label: string;
  description: string | null;
  kind: "text" | "number" | "boolean" | "select" | "date" | "json";
  required: boolean;
  options?: string[];
};

/** How a run ended. "timed_out" and "errored" mean your product didn't answer: it may or may not have happened. */
export type ActionRun = {
  id: string;
  status: "running" | "succeeded" | "failed" | "timed_out" | "errored";
  /** What your product said happened. */
  summary: string | null;
  data?: Record<string, unknown> | null;
};

/** A change the suggested reply assumes, waiting for the agent to approve or skip it. */
export type ProposedAction = {
  name: string;
  title: string;
  input: Record<string, unknown>;
  reason: string;
  state: "proposed" | "running" | "done" | "failed" | "declined";
  fields: ActionField[];
  run: ActionRun | null;
};

/** An action an agent can run from the ticket's menu. */
export type TicketAction = { name: string; title: string; description: string; approval: "always" | "never"; fields: ActionField[] };

/** A declared action on the settings screen. Only "never" actions can be switched off. */
export type ActionSetting = { name: string; title: string; description: string; approval: "always" | "never"; enabled: boolean };

/** A suggested reply, or why there isn't one. */
export type Suggestion = {
  id: string;
  kind: "draft" | "cannot_answer";
  text: string | null;
  reason: string | null;
  sources: SuggestionSource[];
  actions?: ProposedAction[];
  /** With Autopilot: "held" while the reply waits to be sent on its own, at `sendAt`. */
  autopilot?: "held" | "sending" | "sent" | "cancelled" | "failed" | null;
  sendAt?: DateLike | null;
  /** Why Autopilot left this reply to an agent, on a topic that is switched on. */
  autopilotBlock?: string | null;
};

export type TicketListItem = {
  id: string;
  number: number;
  subject: string | null;
  status: TicketStatus;
  waitingSince: DateLike | null;
  lastMessageAt: DateLike;
  preview: string | null;
  previewKind: "inbound" | "outbound" | null;
  previewAuthorId: string | null;
  contact: { id: string; name: string | null; identities: Identity[] };
  customer: Customer | null;
  assignee: Agent | null;
  unread: boolean;
  /** With AI: how urgent it is, a one-line summary, and whether a suggested reply is waiting. */
  urgency?: Urgency | null;
  summary?: string | null;
  draftReady?: boolean;
};

export type TicketCounts = Record<TicketStatus, number> & { unassigned: number; mine: number };

export type TimelineMessage = {
  id: string;
  kind: "inbound" | "outbound" | "note";
  authorId: string | null;
  from: Address | null;
  to: Address[];
  cc: Address[];
  text: string;
  fullText: string | null;
  html: string | null;
  deliveryStatus: DeliveryStatus | null;
  deliveryError: string | null;
  auto: boolean;
  source: "channel" | "portal" | "agent" | "api";
  createdAt: DateLike;
  attachments: FileInfo[];
};

export type TimelineEvent = {
  id: string;
  type:
    | "created"
    | "assigned"
    | "status_changed"
    | "customer_linked"
    | "reopened"
    | "follow_up"
    | "contact_changed"
    | "forwarded"
    | "insight_changed"
    | "action_run"
    | "autopilot_sent"
    | "autopilot_flagged";
  actorId: string | null;
  data: Record<string, unknown>;
  createdAt: DateLike;
};

export type TicketDetail = {
  ticket: {
    id: string;
    number: number;
    subject: string | null;
    status: TicketStatus;
    customerId: string | null;
    assigneeId: string | null;
    waitingSince: DateLike | null;
    createdAt: DateLike;
  };
  contact: { id: string; name: string | null; identities: Identity[]; customerId: string | null; locale: string | null };
  customer: Customer | null;
  assignee: Agent | null;
  timeline: ({ type: "message"; at: DateLike; message: TimelineMessage } | { type: "event"; at: DateLike; event: TimelineEvent })[];
  channel: {
    id: string;
    kind: "email" | "sms" | "whatsapp" | "telegram" | "api";
    address: string;
    capabilities: { attachments: { maxBytes: number; maxCount: number } | false; maxTextLength: number | null };
  } | null;
  replyBlockedReason: "reply_window_closed" | "no_channel" | "no_recipient" | null;
  /** Who a reply goes to by default; agents can change who's copied. */
  recipients: { to: Address | null; cc: Address[] };
  previousTickets: { id: string; number: number; subject: string | null; status: TicketStatus; lastMessageAt: DateLike }[];
  /** Shown in the sidebar, with or without AI. */
  accountFacts?: AccountFact[];
  insight?: TicketInsight | null;
  /** The suggested reply nobody has used or discarded yet. */
  suggestion?: Suggestion | null;
};

export type ListQuery = {
  status: TicketStatus;
  /** "me", an agent id, null for unassigned, undefined for anyone. */
  assignee?: string | null;
  search?: string;
  /** Sent for open tickets when `ai` is set: most urgent first, then longest waiting. */
  sort?: "priority";
  page: number;
  pageSize: number;
};

export type RefineInstruction = "shorter" | "friendlier" | "formal" | "translate" | { custom: string };

export type AiSettings = {
  guidance: string;
  topics: string[];
  draftOnArrival: boolean;
  /** Your knowledge sources, from `ai.listKnowledgeSources()`. */
  sources: { id: string; articles: number; syncedAt: DateLike | null }[];
  /** Your declared actions, from `ai.listActions()`. Leave it out when you have none. */
  actions?: ActionSetting[];
};

/** An answer the team approved for reuse. Its text may hold {name}, {company} and {agent}, filled in when it's inserted. */
export type ApprovedAnswer = {
  id: string;
  title: string;
  text: string;
  /** BCP-47 when it's only for customers writing in that language; null for everyone. */
  language: string | null;
};

/** A rule the team's edits suggest adding to the guidance. */
export type GuidanceSuggestion = { id: string; rule: string; reason: string; tickets: { id: string; number: number }[] };

/** A question the knowledge didn't answer, with the latest tickets that asked it. */
export type Gap = {
  id: string;
  theme: string;
  count: number;
  lastSeenAt: DateLike | null;
  tickets: { id: string; number: number; subject: string | null }[];
};

export type AutopilotMode = "hold" | "immediate";

/** A topic's recorded outcomes over the window. The six counts after `drafts` add up to it. */
export type AutopilotRecord = {
  drafts: number;
  usedAsIs: number;
  lightlyEdited: number;
  heavilyEdited: number;
  discarded: number;
  cameBackUnhappy: number;
  flagged: number;
  cannotAnswer: number;
  sentByAutopilot: number;
  reopened: number;
  /** The latest drafts, as many as a topic needs: what readiness is judged by. */
  recent: { drafts: number; good: number; rate: number };
  languages: { language: string; drafts: number; good: number }[];
};

export type AutopilotTopic = {
  topic: string;
  /** collecting: not enough evidence yet. eligible: ready to be switched on. */
  stage: "collecting" | "eligible" | "on" | "paused";
  mode: AutopilotMode | null;
  enabledBy: Agent | null;
  enabledAt: DateLike | null;
  pausedAt: DateLike | null;
  pauseReason: "quality" | "flagged" | null;
  /** The record meets the thresholds: a paused topic can be resumed. */
  ready: boolean;
  record: AutopilotRecord;
};

/** `support.ai.getAutopilot()`. */
export type AutopilotOverview = {
  stopped: boolean;
  stoppedBy: Agent | null;
  stoppedAt: DateLike | null;
  minDrafts: number;
  minRate: number;
  /** The thresholds set in code: the team can ask for more, never less. */
  floor: { minDrafts: number; minRate: number };
  windowDays: number;
  holdMinutes: number;
  topics: AutopilotTopic[];
};

export type AutopilotExample = {
  suggestionId: string;
  ticket: { id: string; number: number; subject: string | null };
  outcome: "used" | "light" | "heavy" | "discarded" | "flagged" | "unhappy";
  byAutopilot: boolean;
  draft: string;
  /** What the agent sent instead. */
  sent: string | null;
  at: DateLike;
};

/**
 * The AI methods, each calling `support.ai` on your server. Leave `ai` off the client and the
 * screens show no AI at all.
 */
export interface SupportAiClient {
  refine(input: { ticketId: string; text: string; instruction: RefineInstruction; language?: string }): Promise<{ text: string }>;
  writeUp(input: { ticketId: string; notes: string }): Promise<{ text: string }>;
  translate(input: { messageId: string; to: string }): Promise<{ text: string }>;
  /** Asks for a suggested reply now. */
  draft(input: { ticketId: string }): Promise<unknown>;
  discardSuggestion(input: { id: string }): Promise<unknown>;
  setInsight(input: { ticketId: string; topic?: string; urgency?: Urgency }): Promise<unknown>;
  getSettings(): Promise<AiSettings>;
  updateSettings(input: Partial<Pick<AiSettings, "guidance" | "topics" | "draftOnArrival">>): Promise<unknown>;
  syncKnowledge(): Promise<unknown>;
  /**
   * What the agent said, as text: send the recording to `support.ai.transcribe` on your server.
   * Leave it off and the reply box uses the browser's own speech recognition where there is one.
   */
  transcribe?(input: { audio: Blob; language?: string }): Promise<{ text: string }>;

  /*
   * Memory. Each method is optional and the screens show only what you provide: approved answers
   * need the first three, "Save as approved answer" works better with `generaliseAnswer`.
   */
  listApprovedAnswers?(): Promise<ApprovedAnswer[]>;
  /** Pass your agent's id as `actorId` on the server. `gapId` resolves the gap the answer was written for. */
  saveApprovedAnswer?(input: { id?: string; title: string; text: string; language: string | null; ticketId?: string; gapId?: string }): Promise<unknown>;
  deleteApprovedAnswer?(input: { id: string }): Promise<unknown>;
  /** A sent reply or a draft with the customer's details taken out, for the agent to review before saving. */
  generaliseAnswer?(input: { ticketId: string; text: string }): Promise<{ title: string; text: string; language: string | null }>;
  listGuidanceSuggestions?(): Promise<GuidanceSuggestion[]>;
  /** `rule` is the agent's wording when they changed it before accepting. */
  decideGuidanceSuggestion?(input: { id: string; accept: boolean; rule?: string }): Promise<unknown>;
  listGaps?(): Promise<Gap[]>;
  dismissGap?(input: { id: string }): Promise<unknown>;
  /** A Markdown help article written from how agents answered a gap's tickets, or the tickets given. */
  draftArticle?(input: { gapId: string } | { ticketIds: string[] }): Promise<{ title: string; markdown: string }>;

  /*
   * Actions. Optional like memory: with `runAction`, proposed actions show under the suggested
   * reply; add `listActions` for the ticket's menu and `setActionEnabled` for the settings switch.
   */
  /** `support.ai.ticketActions`: what an agent can run on this ticket. */
  listActions?(input: { ticketId: string }): Promise<TicketAction[]>;
  /**
   * `support.ai.runAction`, with your signed-in agent's id as `actorId` on the server: that is the
   * approval. `suggestionId` when it was proposed; `text` is the reply box, returned rewritten when
   * the agent changed the inputs.
   */
  runAction?(input: { ticketId: string; action: string; input: Record<string, unknown>; suggestionId?: string; text?: string }): Promise<{ run: ActionRun; text?: string | null }>;
  /** `support.ai.declineAction`: skips a proposed action. Returns the reply rewritten without it. */
  declineAction?(input: { ticketId: string; suggestionId: string; action: string; text?: string }): Promise<{ text?: string | null }>;
  /** `support.ai.setActionEnabled`: stops, or lets, AI run a lookup on its own. */
  setActionEnabled?(input: { name: string; enabled: boolean }): Promise<unknown>;

  /*
   * Autopilot. Optional like the rest: with `getAutopilot` and `setAutopilotTopic`, AI settings
   * show each topic's readiness; `flagAutopilotReply` and `holdAutopilotReply` put the flag and the
   * stop on the ticket. Pass your signed-in agent's id as `actorId` on the server for each write,
   * and decide there who may call `setAutopilotTopic` and `setAutopilot`.
   */
  getAutopilot?(): Promise<AutopilotOverview>;
  /** `support.ai.setAutopilotTopic`: switches a topic on (refused until it's ready) or off, or changes how it sends. */
  setAutopilotTopic?(input: { topic: string; on: boolean; mode?: AutopilotMode }): Promise<unknown>;
  /** `support.ai.setAutopilot`: the kill switch, and thresholds stricter than the ones in code (`minRate` is 0 to 1). */
  setAutopilot?(input: { stopped?: boolean; minDrafts?: number | null; minRate?: number | null }): Promise<unknown>;
  /** `support.ai.autopilotExamples`: a topic's recent drafts with how each ended. */
  autopilotExamples?(input: { topic: string; only?: "changed" }): Promise<AutopilotExample[]>;
  /** `support.ai.holdAutopilotReply`: stops a held reply. It stays on the ticket as a suggested reply. */
  holdAutopilotReply?(input: { suggestionId: string }): Promise<unknown>;
  /** `support.ai.flagAutopilotReply`: marks a reply Autopilot sent as wrong, which pauses its topic. */
  flagAutopilotReply?(input: { suggestionId: string; note?: string }): Promise<unknown>;
}

export interface SupportClient {
  listTickets(query: ListQuery): Promise<{ items: TicketListItem[]; total: number }>;
  counts(): Promise<TicketCounts>;
  getTicket(id: string): Promise<TicketDetail>;
  /** `cc` is only passed when the agent changed who's copied. */
  reply(input: {
    ticketId: string;
    text: string;
    attachmentIds: string[];
    status: "waiting" | "solved" | "open";
    cc?: Address[];
    /** The suggested reply the text started from, so its outcome is recorded. */
    suggestionId?: string;
  }): Promise<unknown>;
  addNote(input: { ticketId: string; text: string; attachmentIds: string[] }): Promise<unknown>;
  assign(input: { ticketId: string; assigneeId: string | null }): Promise<unknown>;
  setStatus(input: { ticketId: string; status: TicketStatus }): Promise<unknown>;
  linkCustomer(input: { ticketId: string; customerId: string | null }): Promise<unknown>;
  changeContact(input: { ticketId: string; address: string }): Promise<unknown>;
  retry(input: { messageId: string }): Promise<unknown>;
  upload(input: { ticketId: string; file: File }): Promise<FileInfo>;
  attachmentUrl(input: { id: string }): Promise<string>;
  listAgents(): Promise<Agent[]>;
  searchCustomers(query: string): Promise<Customer[]>;
  ai?: SupportAiClient;
}

export type PortalTicket = {
  id: string;
  subject: string | null;
  status: TicketStatus;
  createdAt: DateLike;
  lastMessageAt: DateLike;
  preview: string | null;
  previewKind: "inbound" | "outbound" | null;
  previewAuthor: string | null;
  unread: boolean;
};

export type PortalMessage = {
  id: string;
  kind: "inbound" | "outbound";
  author: string | null;
  text: string;
  createdAt: DateLike;
  attachments: FileInfo[];
};

export interface SupportPortalClient {
  list(): Promise<{ items: PortalTicket[]; total: number }>;
  get(id: string): Promise<{ ticket: { id: string; subject: string | null; status: TicketStatus; createdAt: DateLike }; messages: PortalMessage[] }>;
  create(input: { subject: string; text: string }): Promise<{ id: string }>;
  reply(input: { ticketId: string; text: string }): Promise<unknown>;
  attachmentUrl(input: { id: string }): Promise<string>;
}
