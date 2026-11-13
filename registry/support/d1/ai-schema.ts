import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AskTurn } from "../proactive";
import type { AccountFact, ProposedAction, SuggestionSource } from "../types";
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
  disabledActions: text("disabled_actions", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** Autopilot's kill switch: set while it is stopped for every topic. */
  autopilotStoppedAt: ms("autopilot_stopped_at"),
  autopilotStoppedBy: text("autopilot_stopped_by"),
  /** The team's own thresholds, when stricter than the ones in code. */
  autopilotMinDrafts: integer("autopilot_min_drafts"),
  autopilotMinRate: real("autopilot_min_rate"),
  /** The portal's Ask box answers customers (0007_proactive.sql). */
  selfServe: integer("self_serve", { mode: "boolean" }).notNull().default(false),
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
    /** From the customer's latest message, for Autopilot: they ask for a person, or say the last reply didn't help. */
    asksForHuman: integer("asks_for_human", { mode: "boolean" }).notNull().default(false),
    notHelped: integer("not_helped", { mode: "boolean" }).notNull().default(false),
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
    sources: text("sources", { mode: "json" }).$type<SuggestionSource[]>().notNull().default([]),
    actions: text("actions", { mode: "json" }).$type<ProposedAction[]>().notNull().default([]),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: text("status").notNull().default("pending"),
    sentMessageId: text("sent_message_id"),
    finalText: text("final_text"),
    createdAt: ms("created_at").notNull().default(now),
    decidedAt: ms("decided_at"),
    /* Autopilot (0004_autopilot.sql): what each outcome counts towards, and replies sent with nobody reading them first. */
    /** The ticket's topic and the customer's language when it was drafted. */
    topic: text("topic"),
    language: text("language"),
    /** How much the agent changed it before sending, 0 to 1 (`editWeight`). */
    change: real("change"),
    /** held, sending, sent, cancelled or failed. Null for an ordinary suggestion. */
    autopilot: text("autopilot"),
    sendAt: ms("send_at"),
    /** Why Autopilot left it to a person. */
    autopilotBlock: text("autopilot_block"),
    /** After it was sent: unhappy or reopened. */
    followUp: text("follow_up"),
    flaggedAt: ms("flagged_at"),
    flaggedBy: text("flagged_by"),
    flagNote: text("flag_note"),
    flagReviewedAt: ms("flag_reviewed_at"),
  },
  (t) => [
    index("support_suggestions_ticket_idx").on(t.ticketId, t.status, t.createdAt),
    index("support_suggestions_topic_idx").on(t.topic, t.createdAt),
    index("support_suggestions_autopilot_idx").on(t.autopilot, t.sendAt),
    index("support_suggestions_sent_message_idx").on(t.sentMessageId),
    /* Insights (0006_insights_ai.sql): what became of the drafts decided in a period. */
    index("support_suggestions_decided_idx").on(t.decidedAt),
  ]
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

/* Actions (0003_actions.sql): what Copilot and agents did in your product from a ticket. */

/** Every run of an action: who approved it, with what, how it ended and how long it took. */
export const supportActionRuns = sqliteTable(
  "support_action_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    suggestionId: text("suggestion_id"),
    action: text("action").notNull(),
    title: text("title").notNull(),
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    /** draft, suggestion or manual. */
    trigger: text("trigger").notNull(),
    /** running, succeeded, failed, timed_out or errored. */
    status: text("status").notNull().default("running"),
    summary: text("summary"),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
    /** What was thrown, for whoever reads the log. Agents see a plain message instead. */
    error: text("error"),
    approvedBy: text("approved_by"),
    durationMs: integer("duration_ms"),
    /** One approval of a proposed action runs once. */
    idempotencyKey: text("idempotency_key"),
    createdAt: ms("created_at").notNull().default(now),
    finishedAt: ms("finished_at"),
  },
  (t) => [
    index("support_action_runs_ticket_idx").on(t.ticketId, t.createdAt),
    index("support_action_runs_suggestion_idx").on(t.suggestionId),
    uniqueIndex("support_action_runs_idempotency_idx").on(t.idempotencyKey),
  ]
);

/* Autopilot (0004_autopilot.sql): the topics a team lets answer on their own. */

/** One row per topic someone switched on: how it sends, whether it's on, and who decided. */
export const supportAutopilotTopics = sqliteTable("support_autopilot_topics", {
  topic: text("topic").primaryKey(),
  /** hold or immediate. */
  mode: text("mode").notNull().default("hold"),
  /** on, paused or off. */
  status: text("status").notNull().default("off"),
  enabledBy: text("enabled_by"),
  enabledAt: ms("enabled_at"),
  pausedAt: ms("paused_at"),
  /** quality or flagged. */
  pauseReason: text("pause_reason"),
  updatedAt: ms("updated_at").notNull().default(now),
});

/* Insights (0006_insights_ai.sql): bursts of different customers raising one topic. */

/** One row per spike: when it started, how big it got, and who acknowledged it. */
export const supportSpikes = sqliteTable(
  "support_spikes",
  {
    id: id(),
    topic: text("topic").notNull(),
    /** When the first ticket of the burst was opened. */
    startedAt: ms("started_at").notNull(),
    detectedAt: ms("detected_at").notNull(),
    lastSeenAt: ms("last_seen_at").notNull(),
    /** Set once a whole window has passed without it. */
    endedAt: ms("ended_at"),
    tickets: integer("tickets").notNull(),
    customers: integer("customers").notNull(),
    /** Tickets the topic usually gets in a window this long, at this time of day. */
    usual: real("usual").notNull().default(0),
    acknowledgedAt: ms("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),
  },
  (t) => [
    index("support_spikes_detected_idx").on(t.detectedAt),
    /** One spike per topic at a time, however many schedulers run. */
    uniqueIndex("support_spikes_ongoing_idx").on(t.topic).where(sql`${t.endedAt} is null`),
  ]
);

/* Proactive and self-serve (0007_proactive.sql): signals from your product, the outreach they lead to, and the portal's Ask box. */

/** Every signal your product reported, and what became of it. */
export const supportSignals = sqliteTable(
  "support_signals",
  {
    id: id(),
    customerId: text("customer_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    facts: text("facts", { mode: "json" }).$type<AccountFact[]>().notNull().default([]),
    /** The same key reported twice does nothing the second time. */
    dedupeKey: text("dedupe_key"),
    /** proposed, duplicate or suppressed. Null until it's decided. */
    status: text("status"),
    reason: text("reason"),
    outreachId: text("outreach_id"),
    createdAt: ms("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("support_signals_dedupe_idx").on(t.dedupeKey), index("support_signals_status_idx").on(t.status, t.createdAt), index("support_signals_kind_idx").on(t.kind, t.createdAt)]
);

/** Messages to customers who haven't written: proposed from a signal, or one of an incident's. */
export const supportOutreach = sqliteTable(
  "support_outreach",
  {
    id: id(),
    signalId: text("signal_id"),
    spikeId: text("spike_id"),
    customerId: text("customer_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    facts: text("facts", { mode: "json" }).$type<AccountFact[]>().notNull().default([]),
    contactId: text("contact_id"),
    channelId: text("channel_id"),
    subject: text("subject"),
    text: text("text"),
    /** What was drafted, kept to measure how much an agent changed. */
    draft: text("draft"),
    sources: text("sources", { mode: "json" }).$type<SuggestionSource[]>().notNull().default([]),
    language: text("language"),
    confident: integer("confident", { mode: "boolean" }).notNull().default(false),
    /** drafting, pending, held, sending, sent, dismissed or failed. */
    status: text("status").notNull().default("drafting"),
    sendAt: ms("send_at"),
    /** Why a message of a kind that sends on its own waits for a person. */
    autoBlock: text("auto_block"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ticketId: text("ticket_id"),
    messageId: text("message_id"),
    decidedBy: text("decided_by"),
    /** Sent with nobody reading it first. */
    auto: integer("auto", { mode: "boolean" }).notNull().default(false),
    change: real("change"),
    createdAt: ms("created_at").notNull().default(now),
    decidedAt: ms("decided_at"),
  },
  (t) => [
    index("support_outreach_status_idx").on(t.status, t.sendAt),
    index("support_outreach_customer_idx").on(t.customerId, t.kind, t.createdAt),
    index("support_outreach_kind_idx").on(t.kind, t.createdAt),
    /** One message per customer about an incident, however many times it is approved. */
    uniqueIndex("support_outreach_spike_idx").on(t.spikeId, t.customerId).where(sql`${t.spikeId} is not null`),
  ]
);

/** One row per outreach kind someone switched to send on its own. */
export const supportOutreachKinds = sqliteTable("support_outreach_kinds", {
  kind: text("kind").primaryKey(),
  /** on, paused or off. */
  status: text("status").notNull().default("off"),
  enabledBy: text("enabled_by"),
  enabledAt: ms("enabled_at"),
  pausedAt: ms("paused_at"),
  updatedAt: ms("updated_at").notNull().default(now),
});

/** Conversations in the portal's Ask box: what a signed-in customer asked, and what they got. */
export const supportAskSessions = sqliteTable(
  "support_ask_sessions",
  {
    id: id(),
    customerId: text("customer_id").notNull(),
    userId: text("user_id").notNull(),
    turns: text("turns", { mode: "json" }).$type<AskTurn[]>().notNull().default([]),
    questions: integer("questions").notNull().default(0),
    /** Questions that got an answer. */
    answered: integer("answered").notNull().default(0),
    /** The customer's latest thumbs-up or thumbs-down. */
    helpful: integer("helpful", { mode: "boolean" }),
    /** The ticket it was handed off to. */
    ticketId: text("ticket_id"),
    createdAt: ms("created_at").notNull().default(now),
    lastAt: ms("last_at").notNull().default(now),
  },
  (t) => [index("support_ask_sessions_customer_idx").on(t.customerId, t.lastAt), index("support_ask_sessions_created_idx").on(t.createdAt)]
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
  supportActionRuns,
  supportAutopilotTopics,
  supportSpikes,
  supportSignals,
  supportOutreach,
  supportOutreachKinds,
  supportAskSessions,
};
