import { and, count, desc, eq, gte, inArray, isNotNull, lt, max, ne, sql, type SQL } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { distributionFromRanks, type Distribution, type PeriodBreakdown, type PeriodTotals, type StatsRange } from "../insights";
import { supportEvents, supportTickets } from "./schema";

/*
 * Insights for SQLite and Cloudflare D1: the aggregate queries behind `support.stats()`. Every
 * query reads one period's tickets through `support_tickets_created_idx` or
 * `support_tickets_solved_idx` (0005_insights.sql) and answers in a handful of rows, so the
 * dashboard stays cheap to load with hundreds of thousands of tickets. `postgres/stats.ts` is the
 * same file in Postgres' dialect: the four helpers below are all that differs. Queries run one
 * after another, as everywhere in this store.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<"async", any, any>;

/** A moment as a query parameter. */
export const at = (date: Date) => sql`${date.getTime()}`;
/** Milliseconds from one timestamp to a later one. */
export const elapsed = (later: SQL, earlier: SQL) => sql`(${later} - ${earlier})`;
/** Which day of a period a timestamp falls on, counting from 0. */
// The cast matters: a bound number may arrive as a real, and the division must still be whole days.
export const dayOf = (column: SQL, from: Date) => sql`cast((${column} - ${at(from)}) / 86400000 as integer)`;
const NO = sql.raw("0");

export const num = (value: SQL) => sql<number>`${value}`.mapWith(Number);

/** A reply that reached the customer: not an acknowledgement, not a failed send. */
export const isReply = (alias: string) =>
  sql.raw(`${alias}.kind = 'outbound' and ${alias}.auto = 0 and coalesce(${alias}.delivery_status, '') <> 'failed'`);

/**
 * The tickets opened in a range, as `r`: when the customer first wrote (`asked`) and when the
 * first reply after that reached them (`replied`, null while they wait). Tickets your team
 * started have no `asked`, so they never count as answered fast.
 */
export const firstReplies = (from: Date, to: Date) => sql`(
  select a.id, a.number, a.subject, a.status, a.waiting_since, a.asked,
    (select min(o.created_at) from support_messages o where o.ticket_id = a.id and ${isReply("o")} and o.created_at >= a.asked) as replied
  from (
    select t.id, t.number, t.subject, t.status, t.waiting_since,
      (select min(i.created_at) from support_messages i where i.ticket_id = t.id and i.kind = 'inbound' and i.auto = ${NO}) as asked
    from support_tickets t
    where t.created_at >= ${at(from)} and t.created_at < ${at(to)} and t.status <> 'spam'
  ) a
) r`;

/** How long each of those tickets waited, for the ones a target applies to: answered late, or still waiting. */
const waited = (now: Date) => sql`case when r.replied is not null then ${elapsed(sql`r.replied`, sql`r.asked`)} else ${elapsed(at(now), sql`r.asked`)} end`;
const isLate = (now: Date, targetMs: number) =>
  sql`r.asked is not null and (r.replied is not null or (r.status = 'open' and r.waiting_since is not null)) and ${waited(now)} > ${targetMs}`;

/**
 * The median and 90th percentile of `durations` (a derived table with one column, `d`), optionally
 * per group (a second column, `g`). The database ranks the values and hands back only the ranks
 * the two percentiles sit between.
 */
export async function distributions(db: Db, durations: SQL, grouped = false): Promise<Map<string, Distribution>> {
  const over = grouped ? sql.raw("partition by g") : sql.raw("");
  const rows = await db
    .select({ group: sql<string>`g`, rank: num(sql`rn`), value: num(sql`d`), n: num(sql`n`) })
    .from(
      sql`(select ${grouped ? sql.raw("g") : sql.raw("'all' as g")}, d, row_number() over (${over} order by d) as rn, count(*) over (${over}) as n from ${durations}) ranked`
    )
    .where(sql`rn in ((n - 1) * 5 / 10 + 1, (n - 1) * 5 / 10 + 2, (n - 1) * 9 / 10 + 1, (n - 1) * 9 / 10 + 2)`);
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(String(row.group), [...(groups.get(String(row.group)) ?? []), row]);
  return new Map([...groups].map(([group, picked]) => [group, distributionFromRanks(picked)]));
}

const NONE: Distribution = { count: 0, median: null, p90: null };

export async function periodTotals(db: Db, { from, to, now, targetMs }: StatsRange): Promise<PeriodTotals> {
  const [opened] = await db
    .select({
      opened: num(sql`count(*)`),
      breaches: num(targetMs === null ? sql`0` : sql`coalesce(sum(case when ${isLate(now, targetMs)} then 1 else 0 end), 0)`),
    })
    .from(targetMs === null ? sql`(select 1 from support_tickets t where t.created_at >= ${at(from)} and t.created_at < ${at(to)} and t.status <> 'spam') r` : firstReplies(from, to));
  const firstReply = await distributions(
    db,
    sql`(select ${elapsed(sql`r.replied`, sql`r.asked`)} as d from ${firstReplies(from, to)} where r.replied is not null) durations`
  );

  const solvedIn = sql`t.solved_at >= ${at(from)} and t.solved_at < ${at(to)} and t.status = 'solved'`;
  const [solved] = await db
    .select({
      solved: num(sql`count(*)`),
      answered: num(sql`coalesce(sum(case when s.replies >= 1 then 1 else 0 end), 0)`),
      replies: num(sql`coalesce(sum(s.replies), 0)`),
      oneReply: num(sql`coalesce(sum(case when s.replies = 1 then 1 else 0 end), 0)`),
    })
    .from(sql`(select (select count(*) from support_messages o where o.ticket_id = t.id and ${isReply("o")}) as replies from support_tickets t where ${solvedIn}) s`);
  const timeToSolve = await distributions(db, sql`(select ${elapsed(sql`t.solved_at`, sql`t.created_at`)} as d from support_tickets t where ${solvedIn}) durations`);

  const [reopened] = await db
    .select({ tickets: num(sql`count(distinct ${supportEvents.ticketId})`) })
    .from(supportEvents)
    .where(and(eq(supportEvents.type, "reopened"), gte(supportEvents.createdAt, from), lt(supportEvents.createdAt, to)));

  return {
    opened: opened?.opened ?? 0,
    solved: solved?.solved ?? 0,
    reopened: reopened?.tickets ?? 0,
    firstReply: firstReply.get("all") ?? NONE,
    timeToSolve: timeToSolve.get("all") ?? NONE,
    breaches: targetMs === null ? null : (opened?.breaches ?? 0),
    answered: solved?.answered ?? 0,
    replies: solved?.replies ?? 0,
    oneReply: solved?.oneReply ?? 0,
  };
}

export async function periodBreakdown(db: Db, { from, to, now, targetMs, previousFrom }: StatsRange & { previousFrom: Date }): Promise<PeriodBreakdown> {
  const notSpam = ne(supportTickets.status, "spam");
  const isSolved = eq(supportTickets.status, "solved");
  const days = new Map<string, PeriodBreakdown["days"][number]>();
  const day = (index: number, channelId: string) => {
    const key = `${index}:${channelId}`;
    if (!days.has(key)) days.set(key, { day: index, channelId, opened: 0, solved: 0 });
    return days.get(key)!;
  };
  const openedRows = await db
    .select({ day: num(dayOf(sql`${supportTickets.createdAt}`, from)), channelId: supportTickets.channelId, tickets: count() })
    .from(supportTickets)
    .where(and(gte(supportTickets.createdAt, from), lt(supportTickets.createdAt, to), notSpam))
    .groupBy(sql`1`, sql`2`);
  for (const row of openedRows) day(row.day, row.channelId).opened = Number(row.tickets);
  const solvedRows = await db
    .select({ day: num(dayOf(sql`${supportTickets.solvedAt}`, from)), channelId: supportTickets.channelId, tickets: count() })
    .from(supportTickets)
    .where(and(gte(supportTickets.solvedAt, from), lt(supportTickets.solvedAt, to), isSolved))
    .groupBy(sql`1`, sql`2`);
  for (const row of solvedRows) day(row.day, row.channelId).solved = Number(row.tickets);

  // What is open now, walked back to `to` when the period ended earlier.
  const backlog = new Map<string, number>();
  const add = (rows: { channelId: string; tickets: number }[], sign: 1 | -1) => {
    for (const row of rows) backlog.set(row.channelId, (backlog.get(row.channelId) ?? 0) + sign * Number(row.tickets));
  };
  const byChannel = (where: SQL | undefined) =>
    db.select({ channelId: supportTickets.channelId, tickets: count() }).from(supportTickets).where(where).groupBy(supportTickets.channelId);
  add(await byChannel(inArray(supportTickets.status, ["open", "waiting"])), 1);
  if (to < now) {
    add(await byChannel(and(gte(supportTickets.createdAt, to), notSpam)), -1);
    add(await byChannel(and(gte(supportTickets.solvedAt, to), isSolved)), 1);
  }

  const agents = new Map<string | null, PeriodBreakdown["agents"][number]>();
  const agent = (agentId: string | null) => {
    if (!agents.has(agentId)) agents.set(agentId, { agentId, open: 0, waiting: 0, solved: 0, solvedBefore: 0 });
    return agents.get(agentId)!;
  };
  const load = await db
    .select({ agentId: supportTickets.assigneeId, status: supportTickets.status, tickets: count() })
    .from(supportTickets)
    .where(inArray(supportTickets.status, ["open", "waiting"]))
    .groupBy(supportTickets.assigneeId, supportTickets.status);
  for (const row of load) agent(row.agentId)[row.status as "open" | "waiting"] = Number(row.tickets);
  const solvedBy = await db
    .select({
      agentId: supportTickets.assigneeId,
      solved: num(sql`sum(case when ${supportTickets.solvedAt} >= ${at(from)} then 1 else 0 end)`),
      before: num(sql`sum(case when ${supportTickets.solvedAt} < ${at(from)} then 1 else 0 end)`),
    })
    .from(supportTickets)
    .where(and(gte(supportTickets.solvedAt, previousFrom), lt(supportTickets.solvedAt, to), isSolved))
    .groupBy(supportTickets.assigneeId);
  for (const row of solvedBy) Object.assign(agent(row.agentId), { solved: row.solved, solvedBefore: row.before });

  const top = await db
    .select({ customerId: supportTickets.customerId, tickets: count() })
    .from(supportTickets)
    .where(and(gte(supportTickets.createdAt, from), lt(supportTickets.createdAt, to), notSpam, isNotNull(supportTickets.customerId)))
    .groupBy(supportTickets.customerId)
    .orderBy(desc(count()), supportTickets.customerId)
    .limit(8);
  const topIds = top.map((row) => row.customerId!);
  const earlier = topIds.length
    ? await db
        .select({ customerId: supportTickets.customerId, tickets: count() })
        .from(supportTickets)
        .where(and(gte(supportTickets.createdAt, previousFrom), lt(supportTickets.createdAt, from), notSpam, inArray(supportTickets.customerId, topIds)))
        .groupBy(supportTickets.customerId)
    : [];
  const before = new Map(earlier.map((row) => [row.customerId, Number(row.tickets)]));

  const reopened = await db
    .select({ id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject, at: max(supportEvents.createdAt) })
    .from(supportEvents)
    .innerJoin(supportTickets, eq(supportTickets.id, supportEvents.ticketId))
    .where(and(eq(supportEvents.type, "reopened"), gte(supportEvents.createdAt, from), lt(supportEvents.createdAt, to)))
    .groupBy(supportTickets.id, supportTickets.number, supportTickets.subject)
    .orderBy(desc(max(supportEvents.createdAt)), desc(supportTickets.number))
    .limit(5);

  const late =
    targetMs === null
      ? []
      : await db
          .select({
            id: sql<string>`r.id`,
            number: num(sql`r.number`),
            subject: sql<string | null>`r.subject`,
            waitedMs: num(waited(now)),
            answered: num(sql`case when r.replied is not null then 1 else 0 end`),
          })
          .from(firstReplies(from, to))
          .where(isLate(now, targetMs))
          .orderBy(sql`4 desc`, sql`2 desc`)
          .limit(5);

  return {
    days: [...days.values()].sort((a, b) => a.day - b.day || a.channelId.localeCompare(b.channelId)),
    backlog: [...backlog].map(([channelId, tickets]) => ({ channelId, tickets })),
    agents: [...agents.values()],
    customers: top.map((row) => ({ customerId: row.customerId!, tickets: Number(row.tickets), before: before.get(row.customerId) ?? 0 })),
    reopened: reopened.map((row) => ({ ...row, at: row.at! })),
    late: late.map((row) => ({ ...row, answered: row.answered === 1 })),
  };
}
