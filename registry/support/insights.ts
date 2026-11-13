import type { Agent, CustomerSummary, Mood, Urgency } from "./types";

/**
 * Insights: how support is going and what customers struggle with. This file holds the parts that
 * need no database and no model: the shapes the stores answer in, the percentile both stores
 * share, the daily series built from their rows, and the spike detector.
 *
 * How each number is defined:
 * - A period runs from `from` (included) to `to` (not included). The one before it has the same length.
 * - Time to first reply: from the customer's first message to the first reply that reached them,
 *   from an agent or Autopilot. Acknowledgements and failed sends don't count. Filed under the
 *   period the ticket was opened in.
 * - Time to solve: from when a ticket was opened to when it was last solved. Filed under the
 *   period it was solved in.
 * - A breach: a ticket opened in the period whose first reply took longer than the response
 *   target, or that is still waiting for one past the target.
 * - Spam is left out of everything.
 */

export const DAY_MS = 86_400_000;

/** Durations in milliseconds. `median` and `p90` are null when nothing was measured. */
export type Distribution = { count: number; median: number | null; p90: number | null };

export type StatsRange = {
  from: Date;
  to: Date;
  /** Tickets still unanswered are breaches once they have waited past the target at this moment. */
  now: Date;
  /** The response target in milliseconds, or null to leave breaches out. */
  targetMs: number | null;
};

export type PeriodTotals = {
  opened: number;
  /** Tickets whose latest solve falls in the period and that are still solved. */
  solved: number;
  /** Tickets a customer's reply reopened in the period. */
  reopened: number;
  firstReply: Distribution;
  timeToSolve: Distribution;
  /** Null when no target was given. */
  breaches: number | null;
  /** Of the solved tickets, those that got at least one reply, and the replies they took in all. */
  answered: number;
  replies: number;
  /** Solved with exactly one reply. */
  oneReply: number;
};

export type TicketRef = { id: string; number: number; subject: string | null };

/** What a period breaks down into, as a store answers it. Days count from `from`: 0 is its first 24 hours. */
export type PeriodBreakdown = {
  days: { day: number; channelId: string; opened: number; solved: number }[];
  /** Tickets open or waiting at `to`, by channel. */
  backlog: { channelId: string; tickets: number }[];
  /** Open and waiting now; solved in the period and in the one before. `agentId` null: nobody is assigned. */
  agents: { agentId: string | null; open: number; waiting: number; solved: number; solvedBefore: number }[];
  /** The customers who opened the most tickets, most first. */
  customers: { customerId: string; tickets: number; before: number }[];
  /** The latest tickets a customer reopened. */
  reopened: (TicketRef & { at: Date })[];
  /** The tickets that missed the response target by the most. `answered` false: still waiting. */
  late: (TicketRef & { waitedMs: number; answered: boolean })[];
};

export type DaySeries = { opened: number; solved: number; backlog: number };

/** `support.stats()`: the dashboard without AI. */
export type SupportStats = {
  from: Date;
  to: Date;
  previousFrom: Date;
  responseTargetMinutes: number | null;
  current: PeriodTotals;
  previous: PeriodTotals;
  /** One entry per day of the period, oldest first. `backlog` is what was open or waiting when the day ended. */
  days: DaySeries[];
  channels: { id: string; kind: string | null; address: string | null; opened: number; solved: number; days: DaySeries[] }[];
  agents: { agent: Agent | null; open: number; waiting: number; solved: number; solvedBefore: number }[];
  customers: { customer: CustomerSummary; tickets: number; before: number }[];
  reopened: (TicketRef & { at: Date })[];
  late: (TicketRef & { waitedMs: number; answered: boolean })[];
};

/** A burst of different customers raising one topic: a likely incident. */
export type Spike = {
  id: string;
  topic: string;
  /** When the first ticket of the burst was opened. */
  startedAt: Date;
  detectedAt: Date;
  /** The last time the detector saw it still going. */
  lastSeenAt: Date;
  /** Set once a whole window has passed without it. */
  endedAt: Date | null;
  /** Since `startedAt`, on this topic. */
  tickets: number;
  customers: number;
  /** Tickets the topic usually gets in a window this long, at this time of day. */
  usual: number;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
};

/** A spike as the screens show it: who acknowledged it, and its latest tickets. */
export type SpikeView = Omit<Spike, "acknowledgedBy"> & { acknowledgedBy: Agent | null; latest: TicketRef[] };

export type SpikeConfig = {
  /** Different customers that must raise one topic within the window. */
  minCustomers: number;
  /** The window, in minutes. */
  windowMinutes: number;
  /** Days of the topic's own history the window is compared with. */
  baselineDays: number;
  /** How many times its usual volume the topic must reach. */
  factor: number;
};

export const SPIKE_DEFAULTS: SpikeConfig = { minCustomers: 5, windowMinutes: 120, baselineDays: 14, factor: 3 };

export type DraftShare = {
  /** Sent by an agent exactly as drafted. */
  usedAsIs: number;
  lightlyEdited: number;
  rewritten: number;
  discarded: number;
  /** Sent by Autopilot, nobody reading first. */
  autopilotSent: number;
  /** Autopilot replies an agent marked as wrong in the period. */
  autopilotFlagged: number;
};

export type MoodCounts = Record<Mood, number>;

/** `support.ai.insights()`: what the dashboard adds when AI is configured. */
export type AiInsights = {
  from: Date;
  to: Date;
  /** Most tickets first. `days` has one count per day of the period. `drafts` were decided in the period; `accepted` went out as drafted or lightly edited. */
  topics: { topic: string; tickets: number; before: number; days: number[]; drafts: number; accepted: number }[];
  urgency: { current: Record<Urgency, number>; previous: Record<Urgency, number> };
  mood: { current: MoodCounts; previous: MoodCounts; days: MoodCounts[] };
  drafts: { current: DraftShare; previous: DraftShare };
  /** Time to first reply on tickets that had a draft ready before the reply, and on those that didn't. */
  firstReply: { withDraft: Distribution; withoutDraft: Distribution };
  /** The open gaps most tickets ran into. */
  gaps: { id: string; theme: string; count: number; lastSeenAt: Date | null }[];
  /** Spikes detected in the period, newest first. */
  spikes: SpikeView[];
};

const emptyShare = (): DraftShare => ({ usedAsIs: 0, lightlyEdited: 0, rewritten: 0, discarded: 0, autopilotSent: 0, autopilotFlagged: 0 });

/** What became of a period's drafts, from the rows a store groups them into. */
export function draftShare(outcomes: { status: "used" | "edited" | "discarded"; light: boolean; autopilot: boolean; drafts: number }[], flagged: number): DraftShare {
  const share = emptyShare();
  for (const row of outcomes) {
    if (row.autopilot) share.autopilotSent += row.drafts;
    else if (row.status === "used") share.usedAsIs += row.drafts;
    else if (row.status === "discarded") share.discarded += row.drafts;
    else if (row.light) share.lightlyEdited += row.drafts;
    else share.rewritten += row.drafts;
  }
  share.autopilotFlagged = flagged;
  return share;
}

// -------------------------------------------------------------- percentiles

/**
 * A percentile of ascending values with linear interpolation between neighbours, the way
 * Postgres' `percentile_cont` and most spreadsheets do it: the median of 10, 20, 30 and 40 is 25.
 * `tenths` is 5 for the median and 9 for the 90th percentile; integers keep both stores exact.
 */
export function percentile(sorted: number[], tenths: number): number | null {
  const n = sorted.length;
  if (!n) return null;
  const position = (n - 1) * tenths;
  const low = Math.floor(position / 10);
  const share = (position % 10) / 10;
  const a = sorted[low]!;
  const b = sorted[Math.min(low + 1, n - 1)]!;
  return a + (b - a) * share;
}

export function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, median: percentile(sorted, 5), p90: percentile(sorted, 9) };
}

/**
 * The same, from the few rows a store picks out of a ranked list: `rank` counts from 1 and `n` is
 * how many values there are. Stores select the ranks named by `PERCENTILE_RANKS`, so a
 * distribution over a hundred thousand tickets comes back as four rows.
 */
export function distributionFromRanks(rows: { rank: number; value: number; n: number }[]): Distribution {
  const n = rows[0]?.n ?? 0;
  if (!n) return { count: 0, median: null, p90: null };
  const at = new Map(rows.map((row) => [row.rank, row.value]));
  const pick = (tenths: number) => {
    const position = (n - 1) * tenths;
    const low = Math.floor(position / 10);
    const a = at.get(low + 1);
    if (a === undefined) return null;
    const b = at.get(low + 2) ?? a;
    return a + (b - a) * ((position % 10) / 10);
  };
  return { count: n, median: pick(5), p90: pick(9) };
}

// ------------------------------------------------------------------ periods

/** The period before this one: the same length, ending where it starts. */
export function previousPeriod(from: Date, to: Date) {
  return { from: new Date(from.getTime() - (to.getTime() - from.getTime())), to: from };
}

export function dayCount(from: Date, to: Date) {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
}

/**
 * The daily series of a period: opened and solved per day, and the backlog at the end of each,
 * walked back from what is open at `to` (a day's backlog is the next day's, less what that day
 * opened, plus what it solved).
 */
export function daySeries(rows: { day: number; opened: number; solved: number }[], days: number, backlogAtEnd: number): DaySeries[] {
  const series: DaySeries[] = Array.from({ length: days }, () => ({ opened: 0, solved: 0, backlog: 0 }));
  for (const row of rows) {
    const day = series[row.day];
    if (!day) continue;
    day.opened += row.opened;
    day.solved += row.solved;
  }
  let backlog = backlogAtEnd;
  for (let i = days - 1; i >= 0; i--) {
    series[i]!.backlog = Math.max(0, backlog);
    backlog = backlog - series[i]!.opened + series[i]!.solved;
  }
  return series;
}

// ------------------------------------------------------------------- spikes

/**
 * What a topic usually gets in the window: the mean of the same stretch of the day on each of the
 * earlier `baselineDays` days. Comparing with the same hours keeps a busy Monday morning from
 * looking like an incident next to the night before.
 */
export function usualVolume(times: Date[], now: Date, config: SpikeConfig): number {
  const windowMs = config.windowMinutes * 60_000;
  let total = 0;
  for (const time of times) {
    const age = now.getTime() - time.getTime();
    const daysAgo = Math.floor(age / DAY_MS);
    if (daysAgo >= 1 && daysAgo <= config.baselineDays && age % DAY_MS < windowMs) total++;
  }
  return total / config.baselineDays;
}

/**
 * A spike: enough different customers on one topic within the window, and well above what the
 * topic usually gets then. Both must hold, so a quiet topic needs real numbers and a busy one
 * needs a real jump.
 */
export function isSpike(window: { customers: number; tickets: number }, usual: number, config: SpikeConfig): boolean {
  return window.customers >= config.minCustomers && window.tickets >= config.factor * usual;
}
