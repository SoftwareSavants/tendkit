import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AskTurn } from "../proactive";
import type { AccountFact, ProposedAction, SuggestionSource } from "../types";
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
  disabledActions: jsonb("disabled_actions").$type<string[]>().notNull().default([]),
  /** Autopilot's kill switch: set while it is stopped for every topic. */
  autopilotStoppedAt: at("autopilot_stopped_at"),
  autopilotStoppedBy: text("autopilot_stopped_by"),
  /** The team's own thresholds, when stricter than the ones in code. */
  autopilotMinDrafts: integer("autopilot_min_drafts"),
  autopilotMinRate: real("autopilot_min_rate"),
  /** The portal's Ask box answers customers (0007_proactive.sql). */
  selfServe: boolean("self_serve").notNull().default(false),
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
    /** From the customer's latest message, for Autopilot: they ask for a person, or say the last reply didn't help. */
    asksForHuman: boolean("asks_for_human").notNull().default(false),
    notHelped: boolean("not_helped").notNull().default(false),
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
    sources: jsonb("sources").$type<SuggestionSource[]>().notNull().default([]),
    actions: jsonb("actions").$type<ProposedAction[]>().notNull().default([]),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    status: text("status").notNull().default("pending"),
    sentMessageId: uuid("sent_message_id"),
    finalText: text("final_text"),
    createdAt: at("created_at").notNull().defaultNow(),
    decidedAt: at("decided_at"),
    /* Autopilot (0004_autopilot.sql): what each outcome counts towards, and replies sent with nobody reading them first. */
    /** The ticket's topic and the customer's language when it was drafted. */
    topic: text("topic"),
    language: text("language"),
    /** How much the agent changed it before sending, 0 to 1 (`editWeight`). */
    change: real("change"),
    /** held, sending, sent, cancelled or failed. Null for an ordinary suggestion. */
    autopilot: text("autopilot"),
    sendAt: at("send_at"),
    /** Why Autopilot left it to a person. */
    autopilotBlock: text("autopilot_block"),
    /** After it was sent: unhappy or reopened. */
    followUp: text("follow_up"),
    flaggedAt: at("flagged_at"),
    flaggedBy: text("flagged_by"),
    flagNote: text("flag_note"),
    flagReviewedAt: at("flag_reviewed_at"),
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

/* Actions (0003_actions.sql): what Copilot and agents did in your product from a ticket. */

/** Every run of an action: who approved it, with what, how it ended and how long it took. */
export const supportActionRuns = pgTable(
  "support_action_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    suggestionId: uuid("suggestion_id"),
    action: text("action").notNull(),
    title: text("title").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    /** draft, suggestion or manual. */
    trigger: text("trigger").notNull(),
    /** running, succeeded, failed, timed_out or errored. */
    status: text("status").notNull().default("running"),
    summary: text("summary"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    /** What was thrown, for whoever reads the log. Agents see a plain message instead. */
    error: text("error"),
    approvedBy: text("approved_by"),
    durationMs: integer("duration_ms"),
    /** One approval of a proposed action runs once. */
    idempotencyKey: text("idempotency_key"),
    createdAt: at("created_at").notNull().defaultNow(),
    finishedAt: at("finished_at"),
  },
  (t) => [
    index("support_action_runs_ticket_idx").on(t.ticketId, t.createdAt),
    index("support_action_runs_suggestion_idx").on(t.suggestionId),
    uniqueIndex("support_action_runs_idempotency_idx").on(t.idempotencyKey),
  ]
);

/* Autopilot (0004_autopilot.sql): the topics a team lets answer on their own. */

/** One row per topic someone switched on: how it sends, whether it's on, and who decided. */
export const supportAutopilotTopics = pgTable("support_autopilot_topics", {
  topic: text("topic").primaryKey(),
  /** hold or immediate. */
  mode: text("mode").notNull().default("hold"),
  /** on, paused or off. */
  status: text("status").notNull().default("off"),
  enabledBy: text("enabled_by"),
  enabledAt: at("enabled_at"),
  pausedAt: at("paused_at"),
  /** quality or flagged. */
  pauseReason: text("pause_reason"),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

/* Insights (0006_insights_ai.sql): bursts of different customers raising one topic. */

/** One row per spike: when it started, how big it got, and who acknowledged it. */
export const supportSpikes = pgTable(
  "support_spikes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: text("topic").notNull(),
    /** When the first ticket of the burst was opened. */
    startedAt: at("started_at").notNull(),
    detectedAt: at("detected_at").notNull(),
    lastSeenAt: at("last_seen_at").notNull(),
    /** Set once a whole window has passed without it. */
    endedAt: at("ended_at"),
    tickets: integer("tickets").notNull(),
    customers: integer("customers").notNull(),
    /** Tickets the topic usually gets in a window this long, at this time of day. */
    usual: real("usual").notNull().default(0),
    acknowledgedAt: at("acknowledged_at"),
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
export const supportSignals = pgTable(
  "support_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: text("customer_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    facts: jsonb("facts").$type<AccountFact[]>().notNull().default([]),
    /** The same key reported twice does nothing the second time. */
    dedupeKey: text("dedupe_key"),
    /** proposed, duplicate or suppressed. Null until it's decided. */
    status: text("status"),
    reason: text("reason"),
    outreachId: uuid("outreach_id"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("support_signals_dedupe_idx").on(t.dedupeKey), index("support_signals_status_idx").on(t.status, t.createdAt), index("support_signals_kind_idx").on(t.kind, t.createdAt)]
);

/** Messages to customers who haven't written: proposed from a signal, or one of an incident's. */
export const supportOutreach = pgTable(
  "support_outreach",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id"),
    spikeId: uuid("spike_id"),
    customerId: text("customer_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    facts: jsonb("facts").$type<AccountFact[]>().notNull().default([]),
    contactId: uuid("contact_id"),
    channelId: text("channel_id"),
    subject: text("subject"),
    text: text("text"),
    /** What was drafted, kept to measure how much an agent changed. */
    draft: text("draft"),
    sources: jsonb("sources").$type<SuggestionSource[]>().notNull().default([]),
    language: text("language"),
    confident: boolean("confident").notNull().default(false),
    /** drafting, pending, held, sending, sent, dismissed or failed. */
    status: text("status").notNull().default("drafting"),
    sendAt: at("send_at"),
    /** Why a message of a kind that sends on its own waits for a person. */
    autoBlock: text("auto_block"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ticketId: uuid("ticket_id"),
    messageId: uuid("message_id"),
    decidedBy: text("decided_by"),
    /** Sent with nobody reading it first. */
    auto: boolean("auto").notNull().default(false),
    change: real("change"),
    /** After it was sent: the customer's answer was unhappy, or reopened a solved ticket. */
    followUp: text("follow_up"),
    /** An agent marked a message that went out on its own as wrong. */
    flaggedAt: at("flagged_at"),
    flaggedBy: text("flagged_by"),
    flagNote: text("flag_note"),
    flagReviewedAt: at("flag_reviewed_at"),
    createdAt: at("created_at").notNull().defaultNow(),
    decidedAt: at("decided_at"),
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
export const supportOutreachKinds = pgTable("support_outreach_kinds", {
  kind: text("kind").primaryKey(),
  /** on, paused or off. */
  status: text("status").notNull().default("off"),
  enabledBy: text("enabled_by"),
  enabledAt: at("enabled_at"),
  pausedAt: at("paused_at"),
  /** quality: its record slipped. flagged: an agent marked a sent message as wrong. */
  pauseReason: text("pause_reason"),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

/** Conversations in the portal's Ask box: what a signed-in customer asked, and what they got. */
export const supportAskSessions = pgTable(
  "support_ask_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: text("customer_id").notNull(),
    userId: text("user_id").notNull(),
    turns: jsonb("turns").$type<AskTurn[]>().notNull().default([]),
    questions: integer("questions").notNull().default(0),
    /** Questions that got an answer. */
    answered: integer("answered").notNull().default(0),
    /** The customer's latest thumbs-up or thumbs-down. */
    helpful: boolean("helpful"),
    /** The ticket it was handed off to. */
    ticketId: uuid("ticket_id"),
    createdAt: at("created_at").notNull().defaultNow(),
    lastAt: at("last_at").notNull().defaultNow(),
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
