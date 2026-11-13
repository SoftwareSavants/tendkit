import { changeRatio } from "./memory";
import type { Outreach } from "./proactive";
import type { AutopilotBlock, AutopilotMode, AutopilotState, Mood, SuggestionStatus, Urgency } from "./types";

/**
 * The parts of Autopilot that need no model and no database: how much an agent changed a draft,
 * a topic's track record from recorded outcomes, whether that record makes it eligible, and the
 * checks one reply passes before it is sent with nobody reading it first.
 */

export type AutopilotConfig = {
  /** Decided drafts a topic needs before it can be switched on. The team can ask for more, never fewer. */
  minDrafts: number;
  /** The share of those that must have been sent as drafted or lightly edited, 0 to 1. The team can ask for more, never less. */
  minRate: number;
  /** Days of history a track record looks at. */
  windowDays: number;
  /** How long a reply waits in "hold for review" before it is sent, in minutes. */
  holdMinutes: number;
  /** Replies Autopilot may send in any hour, across all topics. */
  maxPerHour: number;
  /** A customer who sounds like this gets a person. */
  blockMoods: Mood[];
  /** Tickets this urgent get a person. */
  blockUrgencies: Urgency[];
  /** From this many customer messages without the ticket being solved, a person takes over. */
  maxCustomerMessages: number;
  /** Decided drafts a language needs within the topic before Autopilot answers in it. 0 to skip the check. */
  minLanguageDrafts: number;
};

export const AUTOPILOT_DEFAULTS: AutopilotConfig = {
  minDrafts: 30,
  minRate: 0.9,
  windowDays: 30,
  holdMinutes: 10,
  maxPerHour: 30,
  blockMoods: ["angry"],
  blockUrgencies: ["urgent"],
  maxCustomerMessages: 3,
  minLanguageDrafts: 5,
};

/** Below this, an edit is light: wording was touched and every fact was kept. */
export const LIGHT_EDIT = 0.15;
/** A topic that is on is paused when its record falls under the threshold with at least this many recent drafts. */
export const PAUSE_MIN_DRAFTS = 10;

/** What a reply states as fact, as far as text can show it: numbers (amounts, dates, ids), links and addresses. */
function facts(text: string) {
  const found = text.toLowerCase().match(/https?:\/\/[^\s<>"')]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[^\s]*\d[^\s]*/g) ?? [];
  return found.map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean).sort();
}

/**
 * How much an agent changed a draft before sending it, 0 to 1. It is the share of words that
 * changed, except when a number, link or address was added, removed or replaced: an agent who
 * corrects "3 business days" to "5" changed one word and the whole answer, so that edit weighs at
 * least 0.5. Under `LIGHT_EDIT` the draft was right and the agent polished it.
 */
export function editWeight(draft: string, sent: string) {
  const ratio = changeRatio(draft, sent);
  const [before, after] = [facts(draft), facts(sent)];
  const sameFacts = before.length === after.length && before.every((fact, i) => fact === after[i]);
  return sameFacts ? ratio : Math.max(ratio, 0.5);
}

/** One suggestion as the track record reads it. */
export type OutcomeRow = {
  suggestionId: string;
  ticketId: string;
  topic: string | null;
  language: string | null;
  kind: "draft" | "cannot_answer";
  status: SuggestionStatus;
  /** `editWeight` of an edited draft. Null for edits recorded before Autopilot was installed with no measure kept. */
  change: number | null;
  autopilot: AutopilotState | null;
  /** After it was sent: the customer came back unhappy, or their reply reopened a solved ticket. */
  followUp: "unhappy" | "reopened" | null;
  flaggedAt: Date | null;
  flagReviewedAt: Date | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/** How one draft ended, the way the readiness view names it. */
export type DraftOutcome = "used" | "light" | "heavy" | "discarded" | "flagged" | "unhappy";

/** Null for drafts nobody decided on: still waiting, or replaced by a newer customer message. */
export function outcomeOf(row: OutcomeRow): DraftOutcome | null {
  if (row.kind !== "draft") return null;
  if (row.flaggedAt) return "flagged";
  if (row.status === "discarded") return "discarded";
  if (row.status !== "used" && row.status !== "edited") return null;
  const light = row.status === "used" || (row.change ?? 1) < LIGHT_EDIT;
  if (!light) return "heavy";
  if (row.followUp === "unhappy") return "unhappy";
  return row.status === "used" ? "used" : "light";
}

const good = (outcome: DraftOutcome | null) => outcome === "used" || outcome === "light";
const base = (language: string | null) => language?.toLowerCase().split("-")[0] ?? null;

export type TrackRecord = {
  /** Drafts an agent or Autopilot decided on in the window. The six counts below add up to it. */
  drafts: number;
  usedAsIs: number;
  lightlyEdited: number;
  heavilyEdited: number;
  discarded: number;
  /** Sent as drafted or lightly edited, and the customer then came back unhappy. */
  cameBackUnhappy: number;
  /** Sent by Autopilot and flagged as wrong by an agent. */
  flagged: number;
  /** Questions in the window it said it couldn't answer. Those always go to a person. */
  cannotAnswer: number;
  /** Of the drafts, how many Autopilot sent. */
  sentByAutopilot: number;
  /** Sent replies after which the customer's answer reopened a solved ticket. Shown, not counted against the topic. */
  reopened: number;
  /** The latest `minDrafts` decided drafts: what eligibility and the automatic pause look at. */
  recent: { drafts: number; good: number; rate: number };
  /** Flags nobody has reviewed yet. */
  openFlags: number;
  languages: { language: string; drafts: number; good: number }[];
};

/** A topic's record from its outcome rows. `rows` may hold other topics and older rows: both are left out. */
export function trackRecord(rows: OutcomeRow[], topic: string, config: Pick<AutopilotConfig, "minDrafts" | "windowDays">, now: Date): TrackRecord {
  const since = now.getTime() - config.windowDays * 86_400_000;
  const mine = rows.filter((row) => row.topic === topic && row.createdAt.getTime() >= since);
  const record: TrackRecord = {
    drafts: 0,
    usedAsIs: 0,
    lightlyEdited: 0,
    heavilyEdited: 0,
    discarded: 0,
    cameBackUnhappy: 0,
    flagged: 0,
    cannotAnswer: mine.filter((row) => row.kind === "cannot_answer").length,
    sentByAutopilot: 0,
    reopened: 0,
    recent: { drafts: 0, good: 0, rate: 0 },
    openFlags: mine.filter((row) => row.flaggedAt && !row.flagReviewedAt).length,
    languages: [],
  };
  const decided = mine
    .map((row) => ({ row, outcome: outcomeOf(row) }))
    .filter((item): item is { row: OutcomeRow; outcome: DraftOutcome } => item.outcome !== null)
    .sort((a, b) => (b.row.decidedAt ?? b.row.createdAt).getTime() - (a.row.decidedAt ?? a.row.createdAt).getTime());
  const key: Record<DraftOutcome, "usedAsIs" | "lightlyEdited" | "heavilyEdited" | "discarded" | "flagged" | "cameBackUnhappy"> = {
    used: "usedAsIs",
    light: "lightlyEdited",
    heavy: "heavilyEdited",
    discarded: "discarded",
    flagged: "flagged",
    unhappy: "cameBackUnhappy",
  };
  const languages = new Map<string, { language: string; drafts: number; good: number }>();
  for (const [index, { row, outcome }] of decided.entries()) {
    record.drafts++;
    record[key[outcome]]++;
    if (row.autopilot === "sent") record.sentByAutopilot++;
    if (row.followUp === "reopened") record.reopened++;
    if (index < config.minDrafts) {
      record.recent.drafts++;
      if (good(outcome)) record.recent.good++;
    }
    const language = base(row.language);
    if (language) {
      const entry = languages.get(language) ?? { language, drafts: 0, good: 0 };
      entry.drafts++;
      if (good(outcome)) entry.good++;
      languages.set(language, entry);
    }
  }
  record.recent.rate = record.recent.drafts ? record.recent.good / record.recent.drafts : 0;
  record.languages = [...languages.values()].sort((a, b) => b.drafts - a.drafts || a.language.localeCompare(b.language));
  return record;
}

/** Enough recent drafts, enough of them right, and no flagged reply waiting for a review. */
export function isEligible(record: TrackRecord, config: Pick<AutopilotConfig, "minDrafts" | "minRate">) {
  return record.recent.drafts >= config.minDrafts && record.recent.rate >= config.minRate && record.openFlags === 0;
}

/** A topic that is on has slipped: enough recent drafts to judge by, and too few of them right. */
export function hasSlipped(record: TrackRecord, config: Pick<AutopilotConfig, "minDrafts" | "minRate">) {
  return record.recent.drafts >= Math.min(PAUSE_MIN_DRAFTS, config.minDrafts) && record.recent.rate < config.minRate;
}

/** Whether Autopilot has answered this language well enough, within the topic, to answer it alone. */
export function languageProven(record: TrackRecord, language: string | null, config: Pick<AutopilotConfig, "minRate" | "minLanguageDrafts">) {
  if (config.minLanguageDrafts <= 0) return true;
  const entry = record.languages.find((l) => l.language === base(language));
  return Boolean(entry && entry.drafts >= config.minLanguageDrafts && entry.good / entry.drafts >= config.minRate);
}

/** What Autopilot knows about one reply when it decides whether to send it. */
export type AutopilotCheck = {
  /** The kill switch is on. */
  stopped: boolean;
  customerLinked: boolean;
  channelAllowed: boolean;
  /** The model marked every statement as backed by a source. */
  confident: boolean;
  /** Every source it cited exists, and at least one is knowledge, an approved answer, an account fact or a lookup. */
  sourced: boolean;
  /** Changes the draft proposes: each needs an agent. */
  proposals: number;
  mood: Mood | null;
  urgency: Urgency | null;
  /** Customer messages on the ticket since it was opened or reopened, this one included. */
  customerMessages: number;
  asksForHuman: boolean;
  /** They said the last reply didn't help, or came back unhappy after one. */
  notHelped: boolean;
  languageProven: boolean;
  sentLastHour: number;
};

/** The first reason a reply must go to a person, or null when Autopilot may send it. Order: cheapest to explain first. */
export function autopilotBlock(check: AutopilotCheck, config: Pick<AutopilotConfig, "maxPerHour" | "blockMoods" | "blockUrgencies" | "maxCustomerMessages">): AutopilotBlock | null {
  if (check.stopped) return "stopped";
  if (!check.customerLinked) return "unknown_customer";
  if (!check.channelAllowed) return "channel";
  if (check.asksForHuman) return "asked_for_human";
  if (check.notHelped) return "not_helped";
  if (check.mood && config.blockMoods.includes(check.mood)) return "mood";
  if (check.urgency && config.blockUrgencies.includes(check.urgency)) return "urgency";
  if (check.customerMessages >= config.maxCustomerMessages) return "long_thread";
  if (check.proposals > 0) return "needs_approval";
  if (!check.confident) return "not_confident";
  if (!check.sourced) return "unsourced";
  if (!check.languageProven) return "language";
  if (check.sentLastHour >= config.maxPerHour) return "hourly_cap";
  return null;
}

/** Where a topic stands for the team. "collecting": not enough evidence yet, or not good enough. */
export type TopicStage = "collecting" | "eligible" | "on" | "paused";

export function topicStage(setting: { status: "on" | "paused" | "off" } | null | undefined, record: TrackRecord, config: Pick<AutopilotConfig, "minDrafts" | "minRate">): TopicStage {
  if (setting?.status === "on") return "on";
  if (setting?.status === "paused") return "paused";
  return isEligible(record, config) ? "eligible" : "collecting";
}

/**
 * One decided proposal as Autopilot's track record reads it, so a kind earns sending on its own
 * the way a topic does: sent as drafted or lightly edited counts for it; rewritten, dismissed,
 * flagged as wrong, or answered by an unhappy customer counts against it. Null for proposals
 * nobody decided on, and for an incident's messages.
 */
export function outreachOutcome(
  row: Pick<Outreach, "id" | "kind" | "language" | "status" | "change" | "auto" | "ticketId" | "createdAt" | "decidedAt" | "draft" | "spikeId"> &
    Partial<Pick<Outreach, "followUp" | "flaggedAt" | "flagReviewedAt">>
): OutcomeRow | null {
  if (row.spikeId || !row.draft || (row.status !== "sent" && row.status !== "dismissed")) return null;
  const edited = row.status === "sent" && (row.change ?? 0) > 0;
  return {
    suggestionId: row.id,
    ticketId: row.ticketId ?? "",
    topic: row.kind,
    language: row.language,
    kind: "draft",
    status: row.status === "dismissed" ? "discarded" : edited ? "edited" : "used",
    change: row.change,
    autopilot: row.auto ? "sent" : null,
    followUp: row.followUp ?? null,
    flaggedAt: row.flaggedAt ?? null,
    flagReviewedAt: row.flagReviewedAt ?? null,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export type { AutopilotMode };
