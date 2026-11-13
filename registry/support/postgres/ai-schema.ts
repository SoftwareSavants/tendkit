import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  memoryRunAt: at("memory_run_at"),
  memoryCursor: at("memory_cursor"),
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
    sources: jsonb("sources").$type<{ type: "knowledge" | "answer" | "fact" | "guidance"; id: string; title: string; url?: string | null }[]>().notNull().default([]),
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

/* Memory (0002_memory.sql): what the team teaches Copilot while answering. */

/** Answers the team approved for reuse: the most trusted source for drafts, and quick replies for agents. */
export const supportApprovedAnswers = pgTable("support_approved_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  /** Null: for every language. */
  language: text("language"),
  /** The ticket it was saved from. */
  ticketId: uuid("ticket_id"),
  createdBy: text("created_by"),
  createdAt: at("created_at").notNull().defaultNow(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

/** Drafts an agent changed before sending, kept as examples of how the team writes. */
export const supportExamples = pgTable(
  "support_examples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    suggestionId: uuid("suggestion_id").notNull(),
    ticketId: uuid("ticket_id")
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
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("support_examples_suggestion_idx").on(t.suggestionId),
    index("support_examples_ticket_idx").on(t.ticketId),
    index("support_examples_topic_idx").on(t.topic, t.createdAt),
  ]
);

/** The words of each example's question: a plain inverted index, so finding similar questions needs no extension. */
export const supportExampleTerms = pgTable(
  "support_example_terms",
  {
    term: text("term").notNull(),
    exampleId: uuid("example_id")
      .notNull()
      .references(() => supportExamples.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.term, t.exampleId] }), index("support_example_terms_example_idx").on(t.exampleId)]
);

/** Rules the team's edits suggest for the guidance, waiting for someone to accept or dismiss them. */
export const supportGuidanceSuggestions = pgTable(
  "support_guidance_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rule: text("rule").notNull(),
    reason: text("reason").notNull(),
    ticketIds: jsonb("ticket_ids").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("pending"),
    createdAt: at("created_at").notNull().defaultNow(),
    decidedAt: at("decided_at"),
    decidedBy: text("decided_by"),
  },
  (t) => [index("support_guidance_suggestions_status_idx").on(t.status, t.createdAt)]
);

/** Questions the knowledge didn't answer, grouped by theme. */
export const supportGaps = pgTable(
  "support_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    theme: text("theme").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: at("created_at").notNull().defaultNow(),
    decidedAt: at("decided_at"),
    decidedBy: text("decided_by"),
  },
  (t) => [index("support_gaps_status_idx").on(t.status)]
);

export const supportGapTickets = pgTable(
  "support_gap_tickets",
  {
    gapId: uuid("gap_id")
      .notNull()
      .references(() => supportGaps.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    seenAt: at("seen_at").notNull(),
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
