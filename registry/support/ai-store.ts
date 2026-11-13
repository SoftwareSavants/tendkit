import type { OutcomeRow } from "./autopilot";
import type { Distribution, Spike } from "./insights";
import type {
  ActionRun,
  ApprovedAnswer,
  AutopilotBlock,
  AutopilotMode,
  AutopilotState,
  Gap,
  GuidanceSuggestion,
  Mood,
  ProposedAction,
  Suggestion,
  SuggestionSource,
  SuggestionStatus,
  TicketInsight,
  Urgency,
} from "./types";

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
  /** `change` is `editWeight` of an edited draft. `autopilot: "sent"` marks a reply nobody read first. */
  decideSuggestion(
    id: string,
    patch: { status: SuggestionStatus; sentMessageId?: string | null; finalText?: string | null; change?: number | null; autopilot?: AutopilotState | null },
    at: Date
  ): Promise<void>;

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
   * included): suggestions that said "cannot answer", by when they were made, drafts an agent
   * discarded, by when, and replies Autopilot sent that an agent flagged as wrong, by when. Oldest first.
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

  /* Actions: every run, and what a suggestion proposed. The table and columns are in `0003_actions.sql`. */

  /** Replaces a suggestion's proposed actions: an agent skipped one, or changed its inputs before approving. */
  setSuggestionActions(id: string, actions: ProposedAction[]): Promise<void>;
  /**
   * Starts the log entry of a run, as "running". Returns null when a run with the same
   * `idempotencyKey` exists: someone else started it first.
   */
  insertActionRun(input: NewActionRun): Promise<ActionRun | null>;
  finishActionRun(
    id: string,
    patch: Pick<ActionRun, "status" | "summary" | "data" | "durationMs"> & { error: string | null },
    at: Date
  ): Promise<void>;
  /** Lookups ran before their suggestion was stored: this ties them to it. */
  linkActionRuns(ids: string[], suggestionId: string): Promise<void>;
  /** A suggestion's runs, or a ticket's. Newest first. */
  listActionRuns(input: { suggestionId: string } | { ticketId: string; limit: number }): Promise<ActionRun[]>;

  /* Autopilot: which topics answer on their own, and the evidence. The table and columns are in `0004_autopilot.sql`. */

  /** Every topic someone switched on at some point, whatever its status now. */
  listAutopilotTopics(): Promise<AutopilotTopic[]>;
  saveAutopilotTopic(topic: AutopilotTopic): Promise<void>;
  /** Pauses a topic that is on. Returns false when it wasn't on: someone else got there first. */
  pauseAutopilotTopic(topic: string, reason: NonNullable<AutopilotTopic["pauseReason"]>, at: Date): Promise<boolean>;
  /** Suggestions made since `since`, newest first: what a track record is computed from. No texts. */
  listOutcomes(input: { since: Date; topic?: string; limit: number }): Promise<OutcomeRow[]>;
  /**
   * Takes a held reply, once, in one conditional update: false when it's no longer held or no
   * longer pending. Whoever gets true decides what happens to it (the scheduler sends it, an agent
   * stops it or answers instead); everyone else must leave it alone. `at` is kept as `sendAt`, so a
   * claim that never finished can be told from one in progress.
   */
  claimHeldSuggestion(id: string, at: Date): Promise<boolean>;
  /** Moves a pending suggestion's Autopilot state. Does nothing once the suggestion is decided. */
  setSuggestionAutopilot(id: string, patch: { autopilot: AutopilotState | null; autopilotBlock?: AutopilotBlock | null; sendAt?: Date | null }): Promise<void>;
  /** Held replies whose time has come, oldest first. */
  listHeldSuggestions(input: { dueBefore: Date; limit: number }): Promise<Suggestion[]>;
  /** Replies Autopilot sent since `since`, for the hourly cap. */
  countAutopilotSent(since: Date): Promise<number>;
  /** The suggestion a sent message came from. */
  suggestionForMessage(messageId: string): Promise<SuggestionRow | null>;
  /** What the customer did after a suggested reply was sent. "unhappy" is never overwritten by "reopened". */
  setFollowUp(id: string, followUp: "unhappy" | "reopened"): Promise<void>;
  /** Marks a reply Autopilot sent as wrong. Returns false when it already was, or wasn't Autopilot's. */
  flagSuggestion(id: string, input: { by: string; note: string | null }, at: Date): Promise<boolean>;
  /** A person looked at a topic's flagged replies: they no longer hold the topic back. */
  reviewFlags(topic: string, at: Date): Promise<void>;

  /* Insights: topics over time, what became of drafts, and spikes. The table and index are in `0006_insights_ai.sql`. */

  /** Tickets opened in a range, by the day they were opened (0 is the range's first 24 hours) and their topic. Spam and tickets Copilot hasn't read are left out. */
  topicDays(range: { from: Date; to: Date }): Promise<{ day: number; topic: string; tickets: number }[]>;
  /** The same tickets by day, urgency and mood. */
  moodDays(range: { from: Date; to: Date }): Promise<{ day: number; urgency: Urgency | null; mood: Mood | null; tickets: number }[]>;
  /** Drafts decided in a range, by topic and how they ended (`light`: changed by less than `LIGHT_EDIT`), and the Autopilot replies flagged in it. */
  draftOutcomes(range: { from: Date; to: Date }): Promise<{
    outcomes: { topic: string | null; status: "used" | "edited" | "discarded"; light: boolean; autopilot: boolean; drafts: number }[];
    flagged: number;
  }>;
  /** Time to first reply on tickets opened in a range, split by whether a draft was ready before the reply went out. */
  firstReplyByDraft(range: { from: Date; to: Date }): Promise<{ withDraft: Distribution; withoutDraft: Distribution }>;
  /**
   * Per topic: the tickets opened from `since` until `until` and the different customers behind
   * them (a customer, or a contact nobody linked to one). Without `topic`, every topic but "other".
   */
  topicActivity(input: { since: Date; until: Date; topic?: string }): Promise<{ topic: string; tickets: number; customers: number; firstAt: Date }[]>;
  /** When a topic's tickets were opened, newest first: what its usual volume is worked out from. */
  topicTicketTimes(input: { topic: string; since: Date; until: Date; limit: number }): Promise<Date[]>;
  /** Records a spike. Returns null when the topic already has one going: another scheduler recorded it first. */
  insertSpike(input: Omit<Spike, "id" | "endedAt" | "acknowledgedAt" | "acknowledgedBy">): Promise<Spike | null>;
  updateSpike(id: string, patch: Partial<Pick<Spike, "lastSeenAt" | "endedAt" | "tickets" | "customers">>): Promise<void>;
  /** Newest first. `since` and `until` are about when a spike was detected. */
  listSpikes(input: { ongoing?: boolean; unacknowledged?: boolean; since?: Date; until?: Date; limit: number }): Promise<Spike[]>;
  getSpike(id: string): Promise<Spike | null>;
  /** Returns false when someone already had. */
  acknowledgeSpike(id: string, by: string, at: Date): Promise<boolean>;
}

/** A topic's Autopilot switch, and who set it. */
export type AutopilotTopic = {
  topic: string;
  mode: AutopilotMode;
  status: "on" | "paused" | "off";
  /** Who last switched it on, and when. */
  enabledBy: string | null;
  enabledAt: Date | null;
  pausedAt: Date | null;
  /** "quality": its track record fell under the threshold. "flagged": an agent marked a sent reply as wrong. */
  pauseReason: "quality" | "flagged" | null;
};

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
  /** Lookups ("never" approval) the team switched off: Copilot doesn't run them while drafting. */
  disabledActions: string[];
  /** The kill switch: set while Autopilot is stopped for every topic. */
  autopilotStoppedAt: Date | null;
  autopilotStoppedBy: string | null;
  /** The team's own thresholds, when stricter than the ones in code. */
  autopilotMinDrafts: number | null;
  autopilotMinRate: number | null;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  guidance: "",
  topics: [],
  draftOnArrival: true,
  knowledgeSyncedAt: null,
  memoryRunAt: null,
  memoryCursor: null,
  disabledActions: [],
  autopilotStoppedAt: null,
  autopilotStoppedBy: null,
  autopilotMinDrafts: null,
  autopilotMinRate: null,
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
  /** From the customer's latest message: they ask for a person, or say the last reply didn't help. */
  asksForHuman: boolean;
  notHelped: boolean;
};

export type InsightPatch = Partial<
  Pick<
    InsightRow,
    "basedOnMessageId" | "topic" | "urgency" | "urgencyReason" | "mood" | "language" | "summary" | "topicSetBy" | "urgencySetBy" | "asksForHuman" | "notHelped"
  >
>;

export type SuggestionRow = Suggestion & {
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  sentMessageId: string | null;
  finalText: string | null;
  decidedAt: Date | null;
  change: number | null;
  followUp: "unhappy" | "reopened" | null;
  flaggedAt: Date | null;
  flaggedBy: string | null;
  flagNote: string | null;
};

export type NewSuggestion = {
  ticketId: string;
  basedOnMessageId: string;
  kind: Suggestion["kind"];
  text: string | null;
  reason: string | null;
  sources: SuggestionSource[];
  actions: ProposedAction[];
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  topic?: string | null;
  language?: string | null;
  autopilot?: AutopilotState | null;
  sendAt?: Date | null;
  autopilotBlock?: AutopilotBlock | null;
  createdAt: Date;
};

export type NewActionRun = Pick<ActionRun, "ticketId" | "suggestionId" | "action" | "title" | "input" | "trigger" | "approvedBy" | "createdAt"> & {
  /** Set for approved proposals, so one approval runs once however many times it's sent. */
  idempotencyKey: string | null;
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
