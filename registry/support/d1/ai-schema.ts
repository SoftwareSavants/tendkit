import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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
  memoryRunAt: ms("memory_run_at"),
  memoryCursor: ms("memory_cursor"),
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
      .$type<{ type: "knowledge" | "answer" | "fact" | "guidance"; id: string; title: string; url?: string | null }[]>()
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

/* Memory (0002_memory.sql): what the team teaches Copilot while answering. */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** Answers the team approved for reuse: the most trusted source for drafts, and quick replies for agents. */
export const supportApprovedAnswers = sqliteTable("support_approved_answers", {
  id: id(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  /** Null: for every language. */
  language: text("language"),
  /** The ticket it was saved from. */
  ticketId: text("ticket_id"),
  createdBy: text("created_by"),
  createdAt: ms("created_at").notNull().default(now),
  updatedAt: ms("updated_at").notNull().default(now),
});

/** Drafts an agent changed before sending, kept as examples of how the team writes. */
export const supportExamples = sqliteTable(
  "support_examples",
  {
    id: id(),
    suggestionId: text("suggestion_id").notNull(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    topic: text("topic"),
    language: text("language"),
    question: text("question").notNull(),
    draft: text("draft").notNull(),
    final: text("final").notNull(),
    /** 0 to 1: the share of words that changed. */
    change: real("change").notNull(),
    /** What the edit teaches, free of customer details. Null until drawn, "" when there was nothing. */
    lesson: text("lesson"),
    lessonAttempts: integer("lesson_attempts").notNull().default(0),
    createdAt: ms("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("support_examples_suggestion_idx").on(t.suggestionId),
    index("support_examples_ticket_idx").on(t.ticketId),
    index("support_examples_topic_idx").on(t.topic, t.createdAt),
  ]
);

/** The words of each example's question: a plain inverted index, so finding similar questions needs no extension. */
export const supportExampleTerms = sqliteTable(
  "support_example_terms",
  {
    term: text("term").notNull(),
    exampleId: text("example_id")
      .notNull()
      .references(() => supportExamples.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.term, t.exampleId] }), index("support_example_terms_example_idx").on(t.exampleId)]
);

/** Rules the team's edits suggest for the guidance, waiting for someone to accept or dismiss them. */
export const supportGuidanceSuggestions = sqliteTable(
  "support_guidance_suggestions",
  {
    id: id(),
    rule: text("rule").notNull(),
    reason: text("reason").notNull(),
    ticketIds: text("ticket_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("pending"),
    createdAt: ms("created_at").notNull().default(now),
    decidedAt: ms("decided_at"),
    decidedBy: text("decided_by"),
  },
  (t) => [index("support_guidance_suggestions_status_idx").on(t.status, t.createdAt)]
);

/** Questions the knowledge didn't answer, grouped by theme. */
export const supportGaps = sqliteTable(
  "support_gaps",
  {
    id: id(),
    theme: text("theme").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: ms("created_at").notNull().default(now),
    decidedAt: ms("decided_at"),
    decidedBy: text("decided_by"),
  },
  (t) => [index("support_gaps_status_idx").on(t.status)]
);

export const supportGapTickets = sqliteTable(
  "support_gap_tickets",
  {
    gapId: text("gap_id")
      .notNull()
      .references(() => supportGaps.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    seenAt: ms("seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gapId, t.ticketId] })]
);

export const supportAiSchema = {
  supportAiSettings,
  supportKnowledge,
  supportTicketInsights,
  supportSuggestions,
  supportApprovedAnswers,
  supportExamples,
  supportExampleTerms,
  supportGuidanceSuggestions,
  supportGaps,
  supportGapTickets,
};
