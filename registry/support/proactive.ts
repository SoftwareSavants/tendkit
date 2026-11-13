import type { AccountFact, SuggestionSource } from "./types";

/**
 * The parts of proactive outreach and self-serve that need no model and no database: what a
 * signal is, when one is left unsent, how an outreach kind earns sending on its own, and the
 * checks an answer passes before a customer sees it with nobody reading it first.
 */

// ------------------------------------------------------------------ signals

/** Something your product noticed about one customer, worth telling them before they ask. */
export type SignalInput = {
  customerId: string;
  /**
   * What happened, as a stable name: "payouts_failing", "document_expiring". Lowercase letters,
   * digits and underscores. Signals of one kind are deduplicated together, share a track record
   * and share the switch that lets them send on their own.
   */
  kind: string;
  /** One line for your team: "Payouts have failed 3 times since Monday". */
  title: string;
  /** What you know, as facts. With the account facts, they are the only details the message may state. */
  facts?: AccountFact[];
  /** The same key reported twice does nothing the second time. */
  dedupeKey?: string;
  /** Who to write to. Defaults to `directory.outreachContact`, then the person at the customer who wrote last. */
  to?: { address: string; name?: string | null; locale?: string | null };
};

/** Why a signal didn't become a message. */
export type SuppressReason =
  /** The customer got a message of this kind within the window. */
  | "recently_contacted"
  /** The last message of this kind, sent within four windows, is still waiting for their answer. */
  | "awaiting_reply"
  /** An agent dismissed a proposal of this kind for this customer within the window. */
  | "dismissed"
  /** The customer already got, or is about to get, as many messages as one customer gets in a day. */
  | "customer_limit"
  /** More signals arrived this hour than the limit. */
  | "rate_limited"
  /** Nobody at the customer has an address on a channel that can write first. */
  | "no_contact"
  /** AI isn't configured, or the proactive tables aren't there. */
  | "unavailable";

export type SignalResult =
  | { status: "proposed"; outreachId: string }
  /** Reported before (the same `dedupeKey`), or a proposal of this kind already waits for this customer. */
  | { status: "duplicate"; outreachId: string | null }
  | { status: "suppressed"; reason: SuppressReason };

export type ProactiveConfig = {
  /** Hours during which a customer isn't written to about the same kind again. */
  dedupeHours: number;
  /** Messages one customer may get from signals in any 24 hours, across kinds. */
  maxPerCustomerPerDay: number;
  /** Signals turned into proposals in any hour, across customers. The rest are recorded and left unsent. */
  maxPerHour: number;
  /** Decided proposals a kind needs before it can be switched to send on its own. */
  minDrafts: number;
  /** The share of those that must have gone out as drafted or lightly edited, 0 to 1. */
  minRate: number;
  /** Days of history a kind's track record looks at. */
  windowDays: number;
  /** How long a message of a kind that sends on its own waits in the queue first, in minutes. */
  holdMinutes: number;
  /** Messages that may go out with nobody reading them first in any hour. */
  maxAutoPerHour: number;
};

export const PROACTIVE_DEFAULTS: ProactiveConfig = {
  dedupeHours: 7 * 24,
  maxPerCustomerPerDay: 2,
  maxPerHour: 60,
  minDrafts: 10,
  minRate: 0.9,
  windowDays: 90,
  holdMinutes: 10,
  maxAutoPerHour: 20,
};

/** The kind a broadcast about an incident is filed under. Signals can't use it. */
export const INCIDENT_KIND = "incident";

export const validKind = (kind: string) => /^[a-z][a-z0-9_]{0,59}$/.test(kind) && kind !== INCIDENT_KIND;

/**
 * drafting: the message is being written. pending: waits for an agent. held: sends at `sendAt`
 * unless someone stops it. sending: being sent. sent: the ticket exists. dismissed: an agent said
 * no. failed: the channel didn't take it; an agent can send it again.
 */
export type OutreachStatus = "drafting" | "pending" | "held" | "sending" | "sent" | "dismissed" | "failed";

/** Why a message of a kind that sends on its own waits for a person instead. */
export type OutreachBlock = "stopped" | "not_confident" | "unsourced" | "hourly_cap" | "held_back";

/** A message to a customer who hasn't written: proposed from a signal, or one of an incident's. */
export type Outreach = {
  id: string;
  /** The signal it came from. Null for an incident's messages. */
  signalId: string | null;
  /** The spike it tells the customer about. Null for a signal's proposal. */
  spikeId: string | null;
  customerId: string;
  kind: string;
  title: string;
  facts: AccountFact[];
  contactId: string | null;
  channelId: string | null;
  subject: string | null;
  text: string | null;
  /** What was drafted, kept to measure how much an agent changed. */
  draft: string | null;
  sources: SuggestionSource[];
  language: string | null;
  /** The model vouched for it and every source it cited exists. */
  confident: boolean;
  status: OutreachStatus;
  sendAt: Date | null;
  autoBlock: OutreachBlock | null;
  attempts: number;
  lastError: string | null;
  ticketId: string | null;
  messageId: string | null;
  /** The agent who sent, approved or dismissed it. Null when it went out on its own. */
  decidedBy: string | null;
  /** Sent with nobody reading it first. */
  auto: boolean;
  /** `editWeight` between the draft and what was sent. */
  change: number | null;
  /** After it was sent: the customer's answer was unhappy, or reopened a solved ticket. */
  followUp: "unhappy" | "reopened" | null;
  /** An agent marked it as wrong. Only a message that went out on its own can be. */
  flaggedAt: Date | null;
  flaggedBy: string | null;
  flagNote: string | null;
  /** Someone decided on the paused kind since: the flag no longer holds it back. */
  flagReviewedAt: Date | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/** What decides whether a new signal becomes a proposal. */
export type SignalHistory = {
  /** This customer's proposals and messages of the signal's kind, newest first, within the window. */
  sameKind: Pick<Outreach, "id" | "status" | "decidedAt" | "createdAt">[];
  /** The latest message of this kind went out before the window and is still waiting for the customer's answer. */
  awaitingReply: boolean;
  /** Proposals and messages for this customer in the last 24 hours, all kinds, dismissed ones left out. */
  customerDay: number;
  /** Signals turned into proposals in the last hour, all customers. */
  lastHour: number;
};

/**
 * Whether a signal becomes a proposal. A customer is never written to about the same thing twice
 * in a row: not while a proposal waits, not while the last message is unanswered, and not within
 * the window after a message went out or an agent said no.
 */
export function signalDecision(history: SignalHistory, config: Pick<ProactiveConfig, "maxPerCustomerPerDay" | "maxPerHour">): { status: "propose" } | { status: "duplicate"; outreachId: string } | { status: "suppressed"; reason: SuppressReason } {
  const waiting = history.sameKind.find((o) => o.status === "drafting" || o.status === "pending" || o.status === "held" || o.status === "sending");
  if (waiting) return { status: "duplicate", outreachId: waiting.id };
  const latest = history.sameKind[0];
  // A message the channel didn't take has its ticket, where an agent retries it.
  if (latest?.status === "sent" || latest?.status === "failed") return { status: "suppressed", reason: "recently_contacted" };
  if (history.awaitingReply) return { status: "suppressed", reason: "awaiting_reply" };
  if (latest?.status === "dismissed") return { status: "suppressed", reason: "dismissed" };
  if (history.customerDay >= config.maxPerCustomerPerDay) return { status: "suppressed", reason: "customer_limit" };
  if (history.lastHour >= config.maxPerHour) return { status: "suppressed", reason: "rate_limited" };
  return { status: "propose" };
}

/** Fills {name} and {company} in a message that goes to many customers. Unknown ones are written around. */
export function personalise(text: string, values: { name: string | null; company: string | null }) {
  const first = values.name?.trim().split(/\s+/)[0] ?? "";
  return text
    .replace(/\{name\}/g, first)
    .replace(/\{company\}/g, values.company?.trim() ?? "")
    // "Hi ," and "Hi  ," when there was no name to fill in.
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

// ---------------------------------------------------------------- self-serve

export type SelfServeConfig = {
  /** Questions one customer may ask in any hour. */
  maxPerHour: number;
  /** Questions one conversation may hold before it is handed to a person. */
  maxQuestions: number;
  /** Hours without a ticket after which an answered question counts as resolved. */
  quietHours: number;
};

export const SELF_SERVE_DEFAULTS: SelfServeConfig = { maxPerHour: 20, maxQuestions: 8, quietHours: 24 };

/** Why a question goes to a person. */
export type HandoffReason =
  /** The knowledge, the approved answers and the account don't hold the answer. */
  | "cannot_answer"
  | "asked_for_human"
  /** The question read like an attempt to steer the assistant, or the answer held internal text. */
  | "blocked"
  /** The customer reached the hourly limit, or the conversation its length. */
  | "limit";

/** One question in a self-serve conversation, and what came of it. */
export type AskTurn = {
  question: string;
  kind: "answer" | "handoff";
  /** The answer, or what was attempted before handing off. */
  text: string | null;
  reason: HandoffReason | null;
  sources: SuggestionSource[];
  at: Date | string;
};

export type AskSession = {
  id: string;
  customerId: string;
  userId: string;
  turns: AskTurn[];
  /** The customer's latest thumbs-up or thumbs-down. */
  helpful: boolean | null;
  /** The ticket it was handed off to. */
  ticketId: string | null;
  createdAt: Date;
  lastAt: Date;
};

/** What the portal's Ask box gets back. */
export type AskResult =
  | { sessionId: string; kind: "answer"; text: string; sources: SuggestionSource[] }
  | { sessionId: string | null; kind: "handoff"; reason: HandoffReason };

/** Self-serve over a period: what Insights shows as questions answered before a ticket. */
export type SelfServeStats = {
  /** Conversations customers started in the Ask box. */
  conversations: number;
  /** Those that got at least one answer. */
  answered: number;
  /** Answered, and no ticket followed: the customer said it helped, or wrote nothing for `quietHours`. */
  deflected: number;
  /** Handed to a person as a ticket. */
  escalated: number;
  helpful: number;
  notHelpful: number;
};

const INJECTION = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your|the)\b.{0,30}\b(instructions?|rules?|prompts?|guidance)\b/i,
  /\b(system|developer|hidden|internal)\s+(prompt|message|instructions?)\b/i,
  /\b(reveal|print|show|repeat|output|dump)\b.{0,40}\b(prompt|instructions?|guidance|rules)\b/i,
  /\byou are now\b|\bact as\b.{0,30}\b(admin|agent|developer|support staff)\b/i,
  /\b(another|other|different|every|all)\s+(customers?|accounts?|users?|merchants?|compan(y|ies))('s|s')?\s+(data|facts|balance|details|emails?|payouts?|payments?|invoices?|tickets?)\b/i,
  /\b(of|for|from|about)\s+(another|other|a different|every|all)\s+(customers?|accounts?|merchants?|compan(y|ies))\b/i,
  /<\/?(system|instructions?|account_facts|guidance|knowledge)\b/i,
];

/**
 * A question that reads like an attempt to steer the assistant or to reach another account. It
 * is a first line only: what keeps one customer's data from another is that only the asker's
 * account is ever read, by code the question can't reach. A false alarm costs a hand-off to a person.
 */
export function looksLikeInjection(question: string) {
  return INJECTION.some((pattern) => pattern.test(question));
}

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Whether an answer repeats a run of `run` words from text customers must not see (the team's
 * guidance). Tone and policy shape an answer; a verbatim stretch means the guidance was recited.
 */
export function revealsInternal(answer: string, internal: string[], run = 10) {
  const said = wordsOf(answer).join(" ");
  for (const text of internal) {
    const words = wordsOf(text);
    for (let i = 0; i + run <= words.length; i++) {
      if (said.includes(words.slice(i, i + run).join(" "))) return true;
    }
  }
  return false;
}

/** The note a hand-off leaves on the ticket, so the agent sees what was asked and what was already tried. */
export function handoffNote(turns: AskTurn[]) {
  const lines = ["Asked in the portal before this ticket."];
  for (const turn of turns) {
    lines.push("", `Customer: ${turn.question}`);
    if (turn.kind === "answer" && turn.text) lines.push(`AI answered: ${turn.text}`);
    else if (turn.text) lines.push(`AI drafted, not shown to the customer: ${turn.text}`);
    else lines.push(`AI didn't answer: ${HANDOFF_WHY[turn.reason ?? "cannot_answer"]}`);
    const sources = turn.sources.map((source) => (source.detail ? `${source.title} (${source.detail})` : source.title));
    if (sources.length) lines.push(`Sources: ${sources.join("; ")}`);
  }
  return lines.join("\n");
}

const HANDOFF_WHY: Record<HandoffReason, string> = {
  cannot_answer: "the knowledge and the account don't hold the answer.",
  asked_for_human: "the customer asked for a person.",
  blocked: "the question or the answer didn't pass the safety checks.",
  limit: "the customer reached the limit of questions.",
};
