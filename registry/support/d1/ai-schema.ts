import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { supportTickets } from "./schema";

/* Copilot's tables for SQLite and Cloudflare D1. Only needed when you configure `ai` in createSupport. */

const ms = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** One row: the team's AI settings. */
export const supportAiSettings = sqliteTable("support_ai_settings", {
  id: text("id").primaryKey().default("default"),
  guidance: text("guidance").notNull().default(""),
  topics: text("topics", { mode: "json" }).$type<string[]>().notNull().default([]),
  draftOnArrival: integer("draft_on_arrival", { mode: "boolean" }).notNull().default(true),
  knowledgeSyncedAt: ms("knowledge_synced_at"),
  updatedAt: ms("updated_at").notNull().default(now),
});

/** Articles from your knowledge sources, synced daily. */
export const supportKnowledge = sqliteTable(
  "support_knowledge",
  {
    sourceId: text("source_id").notNull(),
    articleId: text("article_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    text: text("text").notNull(),
    contentHash: text("content_hash").notNull(),
    syncedAt: ms("synced_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.articleId] })]
);

/** What Copilot understood of each ticket, and the customer message still waiting for it. */
export const supportTicketInsights = sqliteTable(
  "support_ticket_insights",
  {
    ticketId: text("ticket_id")
      .primaryKey()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    basedOnMessageId: text("based_on_message_id"),
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
    pendingMessageId: text("pending_message_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: ms("updated_at").notNull().default(now),
  },
  (t) => [index("support_ticket_insights_pending_idx").on(t.pendingMessageId, t.updatedAt)]
);

/** Replies Copilot drafted, and what the agent did with them. */
export const supportSuggestions = sqliteTable(
  "support_suggestions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    basedOnMessageId: text("based_on_message_id").notNull(),
    kind: text("kind").notNull(),
    text: text("text"),
    reason: text("reason"),
    sources: text("sources", { mode: "json" })
      .$type<{ type: "knowledge" | "fact" | "guidance"; id: string; title: string; url?: string | null }[]>()
      .notNull()
      .default([]),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: text("status").notNull().default("pending"),
    sentMessageId: text("sent_message_id"),
    finalText: text("final_text"),
    createdAt: ms("created_at").notNull().default(now),
    decidedAt: ms("decided_at"),
  },
  (t) => [index("support_suggestions_ticket_idx").on(t.ticketId, t.status, t.createdAt)]
);

export const supportAiSchema = { supportAiSettings, supportKnowledge, supportTicketInsights, supportSuggestions };
