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
  type: "created" | "assigned" | "status_changed" | "customer_linked" | "reopened" | "follow_up" | "contact_changed" | "forwarded";
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
};

export type ListQuery = {
  status: TicketStatus;
  /** "me", an agent id, null for unassigned, undefined for anyone. */
  assignee?: string | null;
  search?: string;
  page: number;
  pageSize: number;
};

export interface SupportClient {
  listTickets(query: ListQuery): Promise<{ items: TicketListItem[]; total: number }>;
  counts(): Promise<TicketCounts>;
  getTicket(id: string): Promise<TicketDetail>;
  /** `cc` is only passed when the agent changed who's copied. */
  reply(input: { ticketId: string; text: string; attachmentIds: string[]; status: "waiting" | "solved" | "open"; cc?: Address[] }): Promise<unknown>;
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
