import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Support tables. Ids that point into your product (customer, user, agent) are text so this
 * works with any id format. If your ids are uuids, you can change those columns to uuid and
 * add foreign keys to your own tables: the store code doesn't depend on the column type.
 *
 * Timestamps are `timestamp with time zone`.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const supportContacts = pgTable("support_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  customerId: text("customer_id"),
  userId: text("user_id"),
  locale: text("locale"),
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("support_contacts_customer_idx").on(t.customerId), index("support_contacts_user_idx").on(t.userId)]);

export const supportContactIdentities = pgTable(
  "support_contact_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => supportContacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** Normalized: lower-cased email, E.164 phone. */
    value: text("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("support_contact_identities_kind_value").on(t.kind, t.value), index().on(t.contactId)]
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").generatedAlwaysAsIdentity().notNull(),
    channelId: text("channel_id").notNull(),
    subject: text("subject"),
    status: text("status").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => supportContacts.id),
    customerId: text("customer_id"),
    assigneeId: text("assignee_id"),
    replyToken: text("reply_token").notNull(),
    providerThreadId: text("provider_thread_id"),
    waitingSince: timestamp("waiting_since", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    solvedAt: timestamp("solved_at", { withTimezone: true }),
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

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    channelId: text("channel_id"),
    authorId: text("author_id"),
    from: jsonb("from").$type<{ address: string; name?: string | null } | null>(),
    to: jsonb("to").$type<{ address: string; name?: string | null }[]>().notNull().default([]),
    cc: jsonb("cc").$type<{ address: string; name?: string | null }[]>().notNull().default([]),
    subject: text("subject"),
    text: text("text").notNull(),
    fullText: text("full_text"),
    html: text("html"),
    rfcMessageId: text("rfc_message_id"),
    inReplyTo: text("in_reply_to"),
    references: jsonb("references").$type<string[]>().notNull().default([]),
    providerMessageId: text("provider_message_id"),
    deliveryStatus: text("delivery_status"),
    deliveryError: text("delivery_error"),
    auto: boolean("auto").notNull().default(false),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("support_messages_provider_id").on(t.channelId, t.providerMessageId),
    index("support_messages_ticket_idx").on(t.ticketId, t.createdAt),
    index("support_messages_rfc_idx").on(t.rfcMessageId),
  ]
);

export const supportAttachments = pgTable(
  "support_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null while an agent's upload waits to be sent. */
    messageId: uuid("message_id").references(() => supportMessages.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").references(() => supportTickets.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by"),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    contentId: text("content_id"),
    inline: boolean("inline").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("support_attachments_message_idx").on(t.messageId)]
);

export const supportEvents = pgTable(
  "support_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("support_events_ticket_idx").on(t.ticketId, t.createdAt),
    /* Insights (0005_insights.sql): reopened tickets in a period. */
    index("support_events_type_idx").on(t.type, t.createdAt),
  ]
);

/** When each agent (or customer, in the portal) last read a ticket. */
export const supportReads = pgTable(
  "support_reads",
  {
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    readerId: text("reader_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.readerId] })]
);

/** Cursors and subscriptions for channels that are polled or need renewing. */
export const supportChannelState = pgTable("support_channel_state", {
  channelId: text("channel_id").primaryKey(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
});

export const supportSchema = {
  supportContacts,
  supportContactIdentities,
  supportTickets,
  supportMessages,
  supportAttachments,
  supportEvents,
  supportReads,
  supportChannelState,
};
