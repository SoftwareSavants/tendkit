import type { Suggestion, SuggestionSource, SuggestionStatus, TicketInsight, Urgency } from "./types";

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
};

export const DEFAULT_AI_SETTINGS: AiSettings = { guidance: "", topics: [], draftOnArrival: true, knowledgeSyncedAt: null };

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

export const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
