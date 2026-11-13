import type { ApprovedAnswer, Gap, GuidanceSuggestion, Suggestion, SuggestionSource, SuggestionStatus, TicketInsight, Urgency } from "./types";

/**
 * Everything Copilot keeps. `postgres/ai-store.ts` and `d1/ai-store.ts` implement it; it's
 * separate from `SupportStore`, so apps without AI don't carry these tables.
 */
export interface AiStore {
  getSettings(): Promise<AiSettings>;
  updateSettings(patch: Partial<AiSettings>): Promise<AiSettings>;

  /** Every article, ordered by source and article id (a stable order keeps prompt caches warm). */
  listKnowledge(): Promise<KnowledgeRow[]>;
  /** Makes a source's articles exactly these: inserts new ones, updates changed ones, removes the rest. */
  replaceKnowledge(sourceId: string, articles: NewKnowledgeRow[], at: Date): Promise<{ added: number; updated: number; removed: number }>;
  /** Removes the articles of sources that are no longer configured. */
  deleteKnowledgeExcept(sourceIds: string[]): Promise<void>;
  knowledgeStats(): Promise<{ sourceId: string; articles: number; syncedAt: Date | null }[]>;

  getInsight(ticketId: string): Promise<InsightRow | null>;
  getInsights(ticketIds: string[]): Promise<InsightRow[]>;
  /** Records that a customer's message waits for Copilot. Resets the attempts. */
  queueInsight(ticketId: string, messageId: string, at: Date): Promise<void>;
  /** Writes what Copilot or an agent decided. */
  saveInsight(ticketId: string, patch: InsightPatch, at: Date): Promise<void>;
  /** Clears the queued message once it's handled, unless a newer one replaced it. */
  finishInsight(ticketId: string, messageId: string, at: Date): Promise<void>;
  failInsight(ticketId: string, error: string, at: Date): Promise<void>;
  /** Tickets with a queued message, fewer than `maxAttempts` tries, last touched before `before`. */
  listQueuedInsights(input: { before: Date; maxAttempts: number; limit: number }): Promise<{ ticketId: string; messageId: string }[]>;

  insertSuggestion(input: NewSuggestion): Promise<Suggestion>;
  getSuggestion(id: string): Promise<SuggestionRow | null>;
  /** The newest pending suggestion of a ticket. */
  pendingSuggestion(ticketId: string): Promise<Suggestion | null>;
  /** Tickets among these with a pending draft (not a cannot_answer). */
  ticketsWithDraft(ticketIds: string[]): Promise<Set<string>>;
  /**
   * Closes a ticket's pending suggestions: "stale" when a newer customer message replaced them,
   * "discarded" when the agent answered without them.
   */
  closeSuggestions(ticketId: string, status: "stale" | "discarded", at: Date): Promise<void>;
  decideSuggestion(id: string, patch: { status: SuggestionStatus; sentMessageId?: string | null; finalText?: string | null }, at: Date): Promise<void>;

  /* Memory: what the team teaches Copilot while answering. Tables are in `0002_memory.sql`. */

  /** Every approved answer, oldest first (a stable order keeps prompt caches warm). */
  listAnswers(): Promise<ApprovedAnswer[]>;
  getAnswer(id: string): Promise<ApprovedAnswer | null>;
  insertAnswer(input: Pick<ApprovedAnswer, "title" | "text" | "language" | "ticketId" | "createdBy">, at: Date): Promise<ApprovedAnswer>;
  updateAnswer(id: string, patch: Pick<ApprovedAnswer, "title" | "text" | "language">, at: Date): Promise<ApprovedAnswer | null>;
  deleteAnswer(id: string): Promise<void>;

  /** Keeps a corrected draft with the words to find it by. Does nothing when the suggestion already has one. */
  insertExample(input: NewExample): Promise<void>;
  /** Corrections whose question shares the most of these words, best first. */
  searchExamples(input: { terms: string[]; limit: number }): Promise<ExampleRow[]>;
  /** The newest corrections of a customer's tickets, or of a topic. */
  recentExamples(input: { customerId?: string; topic?: string; limit: number }): Promise<ExampleRow[]>;
  /** Corrections changed by at least `minChange` that no lesson was drawn from yet, oldest first. */
  listExamplesToLearn(input: { minChange: number; maxAttempts: number; limit: number }): Promise<ExampleRow[]>;
  /** The lesson drawn from a correction: "" when there was none to draw, null when drawing it failed (counts an attempt). */
  setExampleLesson(id: string, lesson: string | null): Promise<void>;
  /** Corrections since `since` changed by at least `minChange`, newest first. */
  listEditedExamples(input: { since: Date; minChange: number; limit: number }): Promise<ExampleRow[]>;

  /** Newest first. */
  listGuidanceSuggestions(input: { status?: GuidanceSuggestion["status"]; limit: number }): Promise<GuidanceSuggestion[]>;
  insertGuidanceSuggestion(input: Pick<GuidanceSuggestion, "rule" | "reason" | "ticketIds">, at: Date): Promise<void>;
  /** Decides a pending suggestion. Returns it, or null when it was already decided. */
  decideGuidanceSuggestion(id: string, patch: { status: "accepted" | "dismissed"; rule?: string; decidedBy: string | null }, at: Date): Promise<GuidanceSuggestion | null>;

  /**
   * Questions that went without a usable draft from `after` (included) until `until` (not
   * included): suggestions that said "cannot answer", by when they were made, and drafts an agent
   * discarded, by when. Oldest first.
   */
  listUnanswered(input: { after: Date; until: Date; limit: number }): Promise<UnansweredRow[]>;
  /** With how many tickets asked, when last, and the latest three. Most asked first. */
  listGaps(input: { statuses: Gap["status"][] }): Promise<Gap[]>;
  getGap(id: string): Promise<Pick<Gap, "id" | "theme" | "status"> | null>;
  insertGap(input: { theme: string }, at: Date): Promise<{ id: string }>;
  /** Files a ticket under a gap, once. */
  addGapTicket(gapId: string, ticketId: string, at: Date): Promise<void>;
  /** The tickets of a gap, latest first. */
  gapTicketIds(gapId: string, limit: number): Promise<string[]>;
  setGapStatus(id: string, status: Gap["status"], decidedBy: string | null, at: Date): Promise<void>;
}

export type AiSettings = {
  /** How your team answers: tone, policies, what never to promise. Goes into every prompt. */
  guidance: string;
  /** What tickets are about, for sorting and reports. Copilot picks one or "other". */
  topics: string[];
  /** Draft a reply as soon as a customer writes. On by default. */
  draftOnArrival: boolean;
  /** When the knowledge sources were last synced; set by `syncKnowledge`. */
  knowledgeSyncedAt: Date | null;
  /** When the daily review (guidance suggestions, gaps) last ran, whether or not it succeeded. */
  memoryRunAt: Date | null;
  /** Unanswered questions up to here are filed under gaps. */
  memoryCursor: Date | null;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  guidance: "",
  topics: [],
  draftOnArrival: true,
  knowledgeSyncedAt: null,
  memoryRunAt: null,
  memoryCursor: null,
};

export type KnowledgeRow = {
  sourceId: string;
  articleId: string;
  title: string;
  url: string | null;
  text: string;
  contentHash: string;
  syncedAt: Date;
};

export type NewKnowledgeRow = Omit<KnowledgeRow, "sourceId" | "articleId" | "syncedAt"> & { id: string };

export type InsightRow = TicketInsight & {
  urgencyRank: number | null;
  pendingMessageId: string | null;
  attempts: number;
  lastError: string | null;
};

export type InsightPatch = Partial<
  Pick<
    InsightRow,
    "basedOnMessageId" | "topic" | "urgency" | "urgencyReason" | "mood" | "language" | "summary" | "topicSetBy" | "urgencySetBy"
  >
>;

export type SuggestionRow = Suggestion & {
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  sentMessageId: string | null;
  finalText: string | null;
  decidedAt: Date | null;
};

export type NewSuggestion = {
  ticketId: string;
  basedOnMessageId: string;
  kind: Suggestion["kind"];
  text: string | null;
  reason: string | null;
  sources: SuggestionSource[];
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
};

/** A draft an agent changed before sending: how the team actually answers. */
export type ExampleRow = {
  id: string;
  suggestionId: string;
  ticketId: string;
  /** The ticket's customer today, not when the reply was sent. */
  customerId: string | null;
  topic: string | null;
  language: string | null;
  /** The customer's message the draft answered. */
  question: string;
  draft: string;
  final: string;
  /** 0 (a typo) to 1 (rewritten): the share of words that changed. */
  change: number;
  /** What the edit teaches about tone and structure, free of customer details. Null until it's drawn, "" when there was nothing. */
  lesson: string | null;
  createdAt: Date;
};

export type NewExample = Omit<ExampleRow, "id" | "customerId" | "lesson"> & {
  /** The question's distinct words, for `searchExamples`. */
  terms: string[];
};

export type UnansweredRow = { suggestionId: string; ticketId: string; messageId: string; reason: string | null; at: Date };

/**
 * Optional, for later: turns text into vectors. When `supportAi` is given one, the corrections
 * found by words and topic are re-ordered by meaning. Nothing is stored.
 */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
