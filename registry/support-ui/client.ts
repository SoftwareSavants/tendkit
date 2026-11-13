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

export type SuggestionSource = { type: "knowledge" | "answer" | "fact" | "guidance"; id: string; title: string; url?: string | null };

/** A suggested reply, or why there isn't one. */
export type Suggestion = {
  id: string;
  kind: "draft" | "cannot_answer";
  text: string | null;
  reason: string | null;
  sources: SuggestionSource[];
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
  type: "created" | "assigned" | "status_changed" | "customer_linked" | "reopened" | "follow_up" | "contact_changed" | "forwarded" | "insight_changed";
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
