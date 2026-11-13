import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/*
 * Support tables for SQLite and Cloudflare D1. Same shape as the Postgres schema: ids that point
 * into your product (customer, user, agent) are text, timestamps are epoch milliseconds.
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const ms = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = () => ms("created_at").notNull().default(now);
const updatedAt = () => ms("updated_at").notNull().default(now);
type AddressJson = { address: string; name?: string | null };

export const supportContacts = sqliteTable(
  "support_contacts",
  {
    id: id(),
    name: text("name"),
    customerId: text("customer_id"),
    userId: text("user_id"),
    locale: text("locale"),
    blockedAt: ms("blocked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("support_contacts_customer_idx").on(t.customerId), index("support_contacts_user_idx").on(t.userId)]
);

export const supportContactIdentities = sqliteTable(
  "support_contact_identities",
  {
    id: id(),
    contactId: text("contact_id")
      .notNull()
      .references(() => supportContacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("support_contact_identities_kind_value").on(t.kind, t.value),
    index("support_contact_identities_contact_idx").on(t.contactId),
  ]
);

export const supportTickets = sqliteTable(
  "support_tickets",
  {
    id: id(),
    /** Assigned by the store as max + 1; unique, so a concurrent insert retries. */
    number: integer("number").notNull(),
    channelId: text("channel_id").notNull(),
    subject: text("subject"),
    status: text("status").notNull(),
    contactId: text("contact_id")
      .notNull()
      .references(() => supportContacts.id),
    customerId: text("customer_id"),
    assigneeId: text("assignee_id"),
    replyToken: text("reply_token").notNull(),
    providerThreadId: text("provider_thread_id"),
    waitingSince: ms("waiting_since"),
    lastMessageAt: ms("last_message_at").notNull(),
    lastInboundAt: ms("last_inbound_at"),
    lastOutboundAt: ms("last_outbound_at"),
    solvedAt: ms("solved_at"),
    preview: text("preview"),
    previewKind: text("preview_kind"),
    previewAuthorId: text("preview_author_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("support_tickets_number").on(t.number),
    unique("support_tickets_reply_token").on(t.replyToken),
    index("support_tickets_status_waiting_idx").on(t.status, t.waitingSince),
    index("support_tickets_status_recent_idx").on(t.status, t.lastMessageAt),
    index("support_tickets_customer_idx").on(t.customerId, t.lastMessageAt),
    index("support_tickets_contact_idx").on(t.contactId, t.channelId),
    index("support_tickets_thread_idx").on(t.channelId, t.providerThreadId),
    /* Insights (0005_insights.sql): a period's tickets are found by when they were opened and solved. */
    index("support_tickets_created_idx").on(t.createdAt),
    index("support_tickets_solved_idx").on(t.solvedAt),
  ]
);

export const supportMessages = sqliteTable(
  "support_messages",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    channelId: text("channel_id"),
    authorId: text("author_id"),
    from: text("from", { mode: "json" }).$type<AddressJson | null>(),
    to: text("to", { mode: "json" }).$type<AddressJson[]>().notNull().default(sql`'[]'`),
    cc: text("cc", { mode: "json" }).$type<AddressJson[]>().notNull().default(sql`'[]'`),
    subject: text("subject"),
    text: text("text").notNull(),
    fullText: text("full_text"),
    html: text("html"),
    rfcMessageId: text("rfc_message_id"),
    inReplyTo: text("in_reply_to"),
    references: text("references", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    providerMessageId: text("provider_message_id"),
    deliveryStatus: text("delivery_status"),
    deliveryError: text("delivery_error"),
    auto: integer("auto", { mode: "boolean" }).notNull().default(false),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("support_messages_provider_id").on(t.channelId, t.providerMessageId),
    index("support_messages_ticket_idx").on(t.ticketId, t.createdAt),
    index("support_messages_rfc_idx").on(t.rfcMessageId),
  ]
);

export const supportAttachments = sqliteTable(
  "support_attachments",
  {
    id: id(),
    messageId: text("message_id").references(() => supportMessages.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id").references(() => supportTickets.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by"),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    contentId: text("content_id"),
    inline: integer("inline", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("support_attachments_message_idx").on(t.messageId)]
);

export const supportEvents = sqliteTable(
  "support_events",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id"),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [
    index("support_events_ticket_idx").on(t.ticketId, t.createdAt),
    /* Insights (0005_insights.sql): reopened tickets in a period. */
    index("support_events_type_idx").on(t.type, t.createdAt),
  ]
);

export const supportReads = sqliteTable(
  "support_reads",
  {
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    readerId: text("reader_id").notNull(),
    readAt: ms("read_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.readerId] })]
);

export const supportChannelState = sqliteTable("support_channel_state", {
  channelId: text("channel_id").primaryKey(),
  state: text("state", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
});
