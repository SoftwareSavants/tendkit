import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { supportTickets } from "./schema";

/* Copilot's tables. Only needed when you configure `ai` in createSupport. */

const at = (name: string) => timestamp(name, { withTimezone: true });

/** One row: the team's AI settings. */
export const supportAiSettings = pgTable("support_ai_settings", {
  id: text("id").primaryKey().default("default"),
  guidance: text("guidance").notNull().default(""),
  topics: jsonb("topics").$type<string[]>().notNull().default([]),
  draftOnArrival: boolean("draft_on_arrival").notNull().default(true),
  knowledgeSyncedAt: at("knowledge_synced_at"),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

/** Articles from your knowledge sources, synced daily. */
export const supportKnowledge = pgTable(
  "support_knowledge",
  {
    sourceId: text("source_id").notNull(),
    articleId: text("article_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    text: text("text").notNull(),
    contentHash: text("content_hash").notNull(),
    syncedAt: at("synced_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.articleId] })]
);

/** What Copilot understood of each ticket, and the customer message still waiting for it. */
export const supportTicketInsights = pgTable(
  "support_ticket_insights",
  {
    ticketId: uuid("ticket_id")
      .primaryKey()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    basedOnMessageId: uuid("based_on_message_id"),
    topic: text("topic"),
    urgency: text("urgency"),
    /** 0 urgent … 3 low, for sorting. */
    urgencyRank: integer("urgency_rank"),
    urgencyReason: text("urgency_reason"),
    mood: text("mood"),
    language: text("language"),
    summary: text("summary"),
    topicSetBy: text("topic_set_by"),
    urgencySetBy: text("urgency_set_by"),
    pendingMessageId: uuid("pending_message_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("support_ticket_insights_pending_idx").on(t.pendingMessageId, t.updatedAt)]
);

/** Replies Copilot drafted, and what the agent did with them. */
export const supportSuggestions = pgTable(
  "support_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    basedOnMessageId: uuid("based_on_message_id").notNull(),
    kind: text("kind").notNull(),
    text: text("text"),
    reason: text("reason"),
    sources: jsonb("sources").$type<{ type: "knowledge" | "fact" | "guidance"; id: string; title: string; url?: string | null }[]>().notNull().default([]),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: text("status").notNull().default("pending"),
    sentMessageId: uuid("sent_message_id"),
    finalText: text("final_text"),
    createdAt: at("created_at").notNull().defaultNow(),
    decidedAt: at("decided_at"),
  },
  (t) => [index("support_suggestions_ticket_idx").on(t.ticketId, t.status, t.createdAt)]
);

export const supportAiSchema = { supportAiSettings, supportKnowledge, supportTicketInsights, supportSuggestions };
