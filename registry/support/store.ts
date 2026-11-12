import type {
  Attachment,
  Contact,
  DeliveryStatus,
  Identity,
  Message,
  Ticket,
  TicketEvent,
  TicketStatus,
} from "./types";
import type { ChannelState } from "./channel";

/**
 * Everything the service needs from a database. `postgres/store.ts` implements it with Drizzle;
 * port that file (and `postgres/schema.ts`) to use another database.
 */
export interface SupportStore {
  /** Runs `fn` atomically where the database supports it. */
  transaction<T>(fn: (store: SupportStore) => Promise<T>): Promise<T>;

  findContactByIdentity(identity: Identity): Promise<Contact | null>;
  getContact(id: string): Promise<Contact | null>;
  getContacts(ids: string[]): Promise<Contact[]>;
  createContact(input: NewContact): Promise<Contact>;
  updateContact(id: string, patch: Partial<Pick<Contact, "name" | "customerId" | "userId" | "locale" | "blockedAt">>): Promise<void>;
  /** Ignored when the identity already belongs to someone. */
  addIdentity(contactId: string, identity: Identity): Promise<void>;

  getTicket(id: string): Promise<Ticket | null>;
  findTicketByToken(token: string): Promise<Ticket | null>;
  /** The ticket holding a message with any of these RFC Message-IDs, newest first. */
  findTicketByRfcMessageIds(ids: string[]): Promise<Ticket | null>;
  findTicketByProviderThread(channelId: string, providerThreadId: string): Promise<Ticket | null>;
  /** The contact's most recently active ticket on a channel, any status. */
  findLatestTicket(channelId: string, contactId: string): Promise<Ticket | null>;
  createTicket(input: NewTicket): Promise<Ticket>;
  /** Gives the contact's tickets that have no customer yet this customer. */
  linkContactTickets(contactId: string, customerId: string): Promise<void>;
  updateTicket(id: string, patch: TicketPatch): Promise<Ticket>;
  listTickets(query: TicketQuery): Promise<{ items: Ticket[]; total: number }>;
  countTickets(query: { assigneeId?: string | null }): Promise<TicketCounts>;

  /** Inserts a message; returns null if one with the same channel and provider id exists. */
  insertMessage(input: NewMessage): Promise<Message | null>;
  updateMessage(id: string, patch: MessagePatch): Promise<void>;
  getMessage(id: string): Promise<Message | null>;
  findMessageByProviderId(channelId: string, providerMessageId: string): Promise<Message | null>;
  listMessages(ticketId: string, options: { includeNotes: boolean }): Promise<Message[]>;
  /** Outbound messages stuck in "queued" since before `before` (the sender crashed). */
  listStaleQueued(before: Date): Promise<Message[]>;

  insertAttachment(input: Omit<Attachment, "id"> & { ticketId: string; uploadedBy?: string | null }): Promise<Attachment>;
  getAttachment(id: string): Promise<(Attachment & { ticketId: string | null; uploadedBy: string | null }) | null>;
  /** Attaches uploaded files to the message they were sent with. */
  linkAttachments(ids: string[], messageId: string): Promise<void>;

  insertEvent(input: Omit<TicketEvent, "id" | "createdAt"> & { createdAt?: Date }): Promise<void>;
  listEvents(ticketId: string): Promise<TicketEvent[]>;

  markRead(ticketId: string, readerId: string, at: Date): Promise<void>;
  /** When `readerId` last read each ticket. */
  getReadTimes(ticketIds: string[], readerId: string): Promise<Map<string, Date>>;

  getChannelState(channelId: string): Promise<ChannelState | null>;
  setChannelState(channelId: string, state: ChannelState, error?: string | null): Promise<void>;
}

export type NewContact = {
  name: string | null;
  customerId: string | null;
  userId: string | null;
  locale: string | null;
  identities: Identity[];
};

export type NewTicket = Pick<
  Ticket,
  "channelId" | "subject" | "status" | "contactId" | "customerId" | "assigneeId" | "replyToken" | "providerThreadId"
> & { createdAt: Date };

export type TicketPatch = Partial<
  Pick<
    Ticket,
    | "subject"
    | "status"
    | "contactId"
    | "customerId"
    | "assigneeId"
    | "providerThreadId"
    | "waitingSince"
    | "lastMessageAt"
    | "lastInboundAt"
    | "lastOutboundAt"
    | "solvedAt"
    | "preview"
    | "previewKind"
    | "previewAuthorId"
  >
>;

export type NewMessage = Omit<Message, "id" | "attachments">;

export type MessagePatch = Partial<
  Pick<Message, "deliveryStatus" | "deliveryError" | "providerMessageId" | "rfcMessageId">
>;

export type TicketQuery = {
  status?: TicketStatus;
  /** A user id, or null for unassigned tickets. Omit for everyone's. */
  assigneeId?: string | null;
  customerId?: string;
  /** The customer portal: only tickets this person started. */
  contactUserId?: string;
  search?: string;
  /** Customers whose name matched the search, resolved by the directory. */
  searchCustomerIds?: string[];
  /** "priority": most urgent first (from Copilot's insights; needs the AI tables), then longest waiting. */
  sort: "waiting" | "recent" | "solved" | "priority";
  limit: number;
  offset: number;
};

export type TicketCounts = Record<TicketStatus, number> & { unassigned: number; mine: number };

export type { DeliveryStatus };
