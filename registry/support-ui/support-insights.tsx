"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupport, toDate } from "./provider";
import type { AiInsights, DateLike, DaySeries, Distribution, DraftShare, Spike, SupportStats, Urgency } from "./client";
import { formatSpan, formatWhen } from "./format";
import { BroadcastDialog } from "./outreach";

/*
 * Insights: how support is going and what customers struggle with. Speed, volume, load and
 * customers come from `client.stats`; topics, what became of drafts, gaps and spikes are added
 * when the client has `ai.insights`. Every number is shown next to the period before it, and
 * links to the tickets behind it where the inbox can show them.
 *
 * The charts are plain SVG: bars and lines in the theme's own colours, read by hovering or
 * tapping a day.
 */

const DAY = 86_400_000;
const PERIODS = [7, 30, 90] as const;
type Days = (typeof PERIODS)[number];

/** The last `days` calendar days in the viewer's time zone, today included, up to now. */
function periodFor(days: Days) {
  const to = new Date();
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));
  return { from, to };
}

/** A link into the inbox, filtered. Dates travel as ISO strings. */
export function inboxLink(inboxHref: string, filters: Record<string, string | Date | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value instanceof Date ? value.toISOString() : value);
  return `${inboxHref}${inboxHref.includes("?") ? "&" : "?"}${params}`;
}

const number = (value: number, locale: string, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
const percent = (share: number, locale: string) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(share);
const dayLabel = (date: Date, locale: string) => date.toLocaleDateString(locale, { day: "numeric", month: "short" });

export function SupportInsights() {
  const { client, t, responseTargetMinutes } = useSupport();
  const [days, setDays] = useState<Days>(30);
  const period = useMemo(() => periodFor(days), [days]);
  const stats = useQuery({
    queryKey: ["support", "stats", days, responseTargetMinutes],
    queryFn: () => client.stats!({ ...period, responseTargetMinutes }),
    enabled: Boolean(client.stats),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const ai = useQuery({
    queryKey: ["support", "ai", "insights", days],
    queryFn: () => client.ai!.insights!(period),
    enabled: Boolean(client.ai?.insights),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  if (!client.stats) return null;
  const data = stats.data;

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <div role="group" aria-label={t("insights.period.label")} className="inline-flex rounded-lg border bg-card p-0.5">
          {PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === days}
              onClick={() => setDays(option)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                option === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("insights.period.days", { days: option })}
            </button>
          ))}
        </div>
      </div>

      <SpikeAlerts />

      {stats.error ? (
        <div className="rounded-xl border bg-card px-4 py-12 text-center">
          <p className="text-sm text-destructive">{t("errors.load")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => stats.refetch()}>
            {t("actions.retry")}
          </Button>
        </div>
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className={cn("space-y-8 transition-opacity", stats.isPlaceholderData && "opacity-60")}>
          <Speed data={data} days={days} />
          <Volume data={data} days={days} from={period.from} />
          <div className="grid gap-8 lg:grid-cols-2">
            <Team data={data} days={days} />
            <Customers data={data} days={days} from={period.from} />
          </div>
        </div>
      )}

      {ai.data && (
        <div className={cn("space-y-8 transition-opacity", ai.isPlaceholderData && "opacity-60")}>
          <Topics data={ai.data} days={days} from={period.from} />
          <AiShare data={ai.data} days={days} />
          <SelfServe data={ai.data} days={days} />
          <div className="grid gap-8 lg:grid-cols-2">
            <GapList data={ai.data} />
            <SpikeHistory data={ai.data} />
          </div>
        </div>
      )}
    </div>
  );

}

// ------------------------------------------------------------------ pieces

function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {help && <p className="text-sm text-muted-foreground">{help}</p>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;

/**
 * How a number moved against the period before. `better` says which direction is good news:
 * faster replies are, more tickets are neither.
 */
function Delta({ now, before, days, better, format }: { now: number | null; before: number | null; days: Days; better?: "lower" | "higher"; format?: (value: number) => string }) {
  const { t, locale } = useSupport();
  if (now === null || before === null) return null;
  const was = t("insights.before", { value: format ? format(before) : number(before, locale, 1), days });
  if (before === 0 || now === before) {
    return now === before ? null : (
      <span className="text-xs font-normal text-muted-foreground" title={was}>
        {t("insights.topics.new")}
      </span>
    );
  }
  const change = (now - before) / before;
  const good = better ? (better === "lower" ? change < 0 : change > 0) : null;
  const Arrow = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      title={was}
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
        good === null ? "text-muted-foreground" : good ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      )}
    >
      <Arrow className="size-3.5" aria-hidden />
      {percent(Math.abs(change), locale)}
      <span className="sr-only">{was}</span>
    </span>
  );
}

function Tile({ label, value, delta, children }: { label: string; value: ReactNode; delta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1 rounded-xl border bg-card p-3 sm:p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="flex flex-wrap items-baseline gap-x-2 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
        {value}
        {delta}
      </p>
      {children && <div className="text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

function TicketLinks({ title, tickets }: { title: string; tickets: { id: string; number: number; subject: string | null; note?: string }[] }) {
  const { t, ticketHref } = useSupport();
  if (!tickets.length) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <Link href={ticketHref(ticket.id)} className="flex items-baseline gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/50">
              <span className="shrink-0 tabular-nums text-muted-foreground">#{ticket.number}</span>
              <span dir="auto" className="min-w-0 flex-1 truncate">
                {ticket.subject || t("inbox.noSubject")}
              </span>
              {ticket.note && <span className="shrink-0 text-xs text-muted-foreground">{ticket.note}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Speed({ data, days }: { data: SupportStats; days: Days }) {
  const { t, locale, responseTargetMinutes } = useSupport();
  const { current: now, previous: before } = data;
  const span = (ms: number) => formatSpan(ms, locale);
  const time = (d: Distribution, was: Distribution) =>
    d.median === null ? (
      <span className="text-base font-normal text-muted-foreground">{t("insights.noData")}</span>
    ) : (
      <>
        {span(d.median)}
        <Delta now={d.median} before={was.median} days={days} better="lower" format={span} />
      </>
    );
  const perSolved = (totals: typeof now) => (totals.answered ? totals.replies / totals.answered : null);
  const oneReply = (totals: typeof now) => (totals.answered ? totals.oneReply / totals.answered : null);
  return (
    <Section title={t("insights.speed.heading")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("insights.speed.firstReply")} value={time(now.firstReply, before.firstReply)}>
          {now.firstReply.p90 !== null && t("insights.speed.p90", { value: span(now.firstReply.p90) })}
        </Tile>
        <Tile label={t("insights.speed.solve")} value={time(now.timeToSolve, before.timeToSolve)}>
          {now.timeToSolve.p90 !== null && t("insights.speed.p90", { value: span(now.timeToSolve.p90) })}
        </Tile>
        {now.breaches !== null && (
          <Tile
            label={t("insights.speed.breaches")}
            value={
              <>
                {number(now.breaches, locale)}
                <Delta now={now.breaches} before={before.breaches} days={days} better="lower" />
              </>
            }
          >
            {t("insights.speed.breachesHelp", { opened: number(now.opened, locale), target: span(responseTargetMinutes * 60_000) })}
          </Tile>
        )}
        <Tile
          label={t("insights.quality.oneReply")}
          value={
            oneReply(now) === null ? (
              <span className="text-base font-normal text-muted-foreground">{t("insights.noData")}</span>
            ) : (
              <>
                {percent(oneReply(now)!, locale)}
                <Delta now={oneReply(now)} before={oneReply(before)} days={days} better="higher" format={(v) => percent(v, locale)} />
              </>
            )
          }
        >
          {perSolved(now) !== null && `${t("insights.quality.replies")}: ${number(perSolved(now)!, locale, 1)}`}
        </Tile>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TicketLinks
          title={t("insights.speed.late")}
          tickets={data.late.map((ticket) => ({
            ...ticket,
            note: ticket.answered ? t("insights.speed.answeredAfter", { time: span(ticket.waitedMs) }) : t("insights.speed.stillWaiting", { time: span(ticket.waitedMs) }),
          }))}
        />
        <TicketLinks
          title={`${t("insights.quality.reopenedList")} (${number(now.reopened, locale)})`}
          tickets={data.reopened.map((ticket) => ({ ...ticket, note: formatWhen(ticket.at, locale) }))}
        />
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ charts

type Series = { label: string; values: number[]; className: string; swatch: string };

/** Ninety daily bars don't fit a phone: from 60 days up, days are shown a week at a time. */
function weekly<T>(values: T[], combine: (week: T[]) => T): T[] {
  if (values.length < 60) return values;
  const weeks: T[] = [];
  // Whole weeks counted back from today, so the newest bar is always a full one.
  for (let end = values.length; end > 0; end -= 7) weeks.unshift(combine(values.slice(Math.max(0, end - 7), end)));
  return weeks;
}

function bucketLabels(from: Date, count: number, locale: string, t: (key: string, values?: Record<string, string | number>) => string) {
  const days = Array.from({ length: count }, (_, i) => new Date(from.getTime() + i * DAY));
  return weekly(
    days.map((day) => ({ first: day, last: day })),
    (week) => ({ first: week[0]!.first, last: week.at(-1)!.last })
  ).map(({ first, last }) => (first === last ? dayLabel(first, locale) : t("insights.volume.week", { from: dayLabel(first, locale), to: dayLabel(last, locale) })));
}

/**
 * Bars (side by side per day) or one line over a shared zero-based scale. The row above the plot
 * is the legend; pointing at a day turns it into that day's values.
 */
function Chart({ kind, series, labels, title }: { kind: "bars" | "line"; series: Series[]; labels: string[]; title: string }) {
  const { locale } = useSupport();
  const [active, setActive] = useState<number | null>(null);
  const count = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const height = 100;
  const y = (value: number) => height - (value / max) * height;
  const point = (clientX: number, element: Element) => {
    const box = element.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;
    const index = Math.floor((document.dir === "rtl" ? 1 - ratio : ratio) * count);
    setActive(Math.min(count - 1, Math.max(0, index)));
  };
  return (
    <figure className="space-y-2 rounded-xl border bg-card p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className={cn("size-2 rounded-sm", s.swatch)} aria-hidden />
              {s.label}
              {active !== null && <span className="font-medium tabular-nums text-foreground">{number(s.values[active] ?? 0, locale)}</span>}
            </span>
          ))}
        </span>
        <span className="tabular-nums text-muted-foreground">{active !== null ? labels[active] : `${labels[0]} – ${labels.at(-1)}`}</span>
      </figcaption>
      <div className="relative">
        <span className="pointer-events-none absolute start-0 top-0 text-[10px] tabular-nums text-muted-foreground">{number(max, locale)}</span>
        <svg
          role="img"
          aria-label={title}
          viewBox={`0 0 ${count} ${height}`}
          preserveAspectRatio="none"
          className="h-32 w-full touch-pan-y overflow-visible rtl:-scale-x-100"
          onPointerMove={(e) => point(e.clientX, e.currentTarget)}
          onPointerDown={(e) => point(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
        >
          {active !== null && <rect x={active} y={0} width={1} height={height} className="fill-muted" />}
          <line x1={0} x2={count} y1={0} y2={0} className="stroke-border" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          {kind === "bars"
            ? series.map((s, si) =>
                s.values.map((value, i) => {
                  const width = 0.76 / series.length;
                  return value ? <rect key={`${si}-${i}`} x={i + 0.12 + si * width} y={y(value)} width={Math.max(0.05, width - 0.04)} height={height - y(value)} className={s.className} /> : null;
                })
              )
            : series.map((s) => (
                <g key={s.label}>
                  <polygon points={`0.5,${height} ${s.values.map((value, i) => `${i + 0.5},${y(value)}`).join(" ")} ${count - 0.5},${height}`} className={cn(s.className, "fill-current stroke-none opacity-10")} />
                  <polyline
                    points={s.values.map((value, i) => `${i + 0.5},${y(value)}`).join(" ")}
                    fill="none"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    className={cn(s.className, "stroke-current")}
                  />
                </g>
              ))}
          <line x1={0} x2={count} y1={height} y2={height} className="stroke-border" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </figure>
  );
}

/** A topic's days as a line small enough for a table row. */
function Sparkline({ values }: { values: number[] }) {
  const points = weekly(values, (week) => week.reduce((sum, value) => sum + value, 0));
  const max = Math.max(1, ...points);
  const last = Math.max(1, points.length - 1);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-20 text-muted-foreground rtl:-scale-x-100" aria-hidden>
      <polyline
        points={points.map((value, i) => `${(i / last) * 100},${22 - (value / max) * 20}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Parts of a whole as one bar, with each part named and counted underneath. */
function Parts({ parts, total }: { parts: { label: string; count: number; className: string }[]; total: number }) {
  const { locale } = useSupport();
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {parts.map((part) => (part.count ? <span key={part.label} className={part.className} style={{ width: `${(part.count / total) * 100}%` }} /> : null))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {parts.map((part) => (
          <li key={part.label} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-sm", part.className)} aria-hidden />
            {part.label}
            <span className="font-medium tabular-nums text-foreground">{number(part.count, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ volume

function Volume({ data, days, from }: { data: SupportStats; days: Days; from: Date }) {
  const { t, locale, inboxHref } = useSupport();
  const [channelId, setChannelId] = useState<string | null>(null);
  const channel = data.channels.find((c) => c.id === channelId) ?? null;
  const series: DaySeries[] = channel?.days ?? data.days;
  const labels = bucketLabels(from, series.length, locale, t);
  const sum = (pick: (day: DaySeries) => number) => weekly(series.map(pick), (week) => week.reduce((a, b) => a + b, 0));
  const { current: now, previous: before } = data;
  const chip = (id: string | null, label: string, opened: number) => (
    <button
      key={id ?? "all"}
      type="button"
      aria-pressed={id === (channel?.id ?? null)}
      onClick={() => setChannelId(id)}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        id === (channel?.id ?? null) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <bdi>{label}</bdi> <span className="tabular-nums opacity-70">{number(opened, locale)}</span>
    </button>
  );
  return (
    <Section title={t("insights.volume.heading")}>
      <div className="grid grid-cols-3 gap-3">
        <Tile
          label={t("insights.volume.opened")}
          value={
            <>
              {number(now.opened, locale)}
              <Delta now={now.opened} before={before.opened} days={days} />
            </>
          }
        />
        <Tile
          label={t("insights.volume.solved")}
          value={
            <>
              {number(now.solved, locale)}
              <Delta now={now.solved} before={before.solved} days={days} better="higher" />
            </>
          }
        />
        <Tile
          label={t("insights.quality.reopened")}
          value={
            <>
              {number(now.reopened, locale)}
              <Delta now={now.reopened} before={before.reopened} days={days} better="lower" />
            </>
          }
        />
      </div>
      {data.channels.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chip(null, t("insights.volume.allChannels"), now.opened)}
          {data.channels.map((c) => chip(c.id, c.address ?? c.id, c.opened))}
          {channel && (
            <Link href={inboxLink(inboxHref, { status: "all", channel: channel.id, from })} className="ms-1 text-xs font-medium text-primary underline-offset-2 hover:underline">
              {t("insights.viewTickets")}
            </Link>
          )}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Chart
          kind="bars"
          title={`${t("insights.volume.opened")}, ${t("insights.volume.solved")}`}
          labels={labels}
          series={[
            { label: t("insights.volume.opened"), values: sum((day) => day.opened), className: "fill-primary", swatch: "bg-primary" },
            { label: t("insights.volume.solved"), values: sum((day) => day.solved), className: "fill-muted-foreground/40", swatch: "bg-muted-foreground/40" },
          ]}
        />
        <Chart
          kind="line"
          title={t("insights.volume.backlogHelp")}
          labels={labels}
          series={[{ label: t("insights.volume.backlog"), values: weekly(series.map((day) => day.backlog), (week) => week.at(-1)!), className: "text-primary", swatch: "bg-primary" }]}
        />
      </div>
    </Section>
  );
}

function Team({ data, days }: { data: SupportStats; days: Days }) {
  const { t, locale, inboxHref } = useSupport();
  const cell = "px-4 py-2.5 text-end tabular-nums";
  return (
    <Section title={t("insights.team.heading")}>
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs font-medium text-muted-foreground">
              <th className="px-4 py-2 text-start font-medium">{t("insights.team.agent")}</th>
              <th className="px-4 py-2 text-end font-medium">{t("insights.team.open")}</th>
              <th className="px-4 py-2 text-end font-medium">{t("insights.team.waiting")}</th>
              <th className="px-4 py-2 text-end font-medium">{t("insights.team.solved")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.agents.map((row) => {
              const assignee = row.agent?.id ?? "none";
              const link = (status: string, count: number) =>
                count ? (
                  <Link href={inboxLink(inboxHref, { status, assignee })} className="underline-offset-2 hover:underline">
                    {number(count, locale)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">0</span>
                );
              return (
                <tr key={assignee}>
                  <td className="w-full max-w-0 truncate px-4 py-2.5 font-medium">{row.agent ? <bdi>{row.agent.name}</bdi> : <span className="font-normal text-muted-foreground">{t("insights.team.unassigned")}</span>}</td>
                  <td className={cell}>{link("open", row.open)}</td>
                  <td className={cell}>{link("waiting", row.waiting)}</td>
                  <td className={cell}>
                    <span className="me-2">
                      <Delta now={row.solved} before={row.solvedBefore} days={days} />
                    </span>
                    {number(row.solved, locale)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Customers({ data, days, from }: { data: SupportStats; days: Days; from: Date }) {
  const { t, locale, inboxHref } = useSupport();
  return (
    <Section title={t("insights.customers.heading")}>
      {data.customers.length ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {data.customers.map((row) => (
            <li key={row.customer.id}>
              <Link href={inboxLink(inboxHref, { status: "all", customer: row.customer.id, from })} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50">
                <bdi className="truncate font-medium">{row.customer.name}</bdi>
                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <Delta now={row.tickets} before={row.before} days={days} />
                  {number(row.tickets, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t("insights.customers.empty")}</Empty>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------- AI

const URGENCY_STYLES: Record<Urgency, string> = {
  urgent: "bg-red-600 dark:bg-red-500",
  high: "bg-amber-500",
  normal: "bg-muted-foreground/50",
  low: "bg-muted-foreground/20",
};

function Topics({ data, days, from }: { data: AiInsights; days: Days; from: Date }) {
  const { t, locale, inboxHref } = useSupport();
  const growing = data.topics
    // Enough tickets to mean something, and at least a fifth more than before.
    .filter((topic) => topic.topic !== "other" && topic.tickets >= 5 && topic.tickets >= topic.before * 1.2)
    .sort((a, b) => b.tickets - b.before - (a.tickets - a.before))
    .slice(0, 3);
  const name = (topic: string) => (topic === "other" ? t("insights.topics.other") : topic);
  const urgencyTotal = Object.values(data.urgency.current).reduce((a, b) => a + b, 0);
  const upset = weekly(data.mood.days, (week) => ({
    calm: week.reduce((sum, day) => sum + day.calm, 0),
    confused: week.reduce((sum, day) => sum + day.confused, 0),
    frustrated: week.reduce((sum, day) => sum + day.frustrated, 0),
    angry: week.reduce((sum, day) => sum + day.angry, 0),
  })).map((day) => {
    const all = day.calm + day.confused + day.frustrated + day.angry;
    return all ? Math.round(((day.frustrated + day.angry) / all) * 100) : 0;
  });
  const share = (mood: AiInsights["mood"]["current"]) => {
    const all = mood.calm + mood.confused + mood.frustrated + mood.angry;
    return all ? (mood.frustrated + mood.angry) / all : null;
  };
  return (
    <Section title={t("insights.topics.heading")} help={t("insights.topics.help")}>
      {!data.topics.length ? (
        <Empty>{t("insights.topics.empty")}</Empty>
      ) : (
        <>
          {growing.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t("insights.topics.growing")}</span>
              {growing.map((topic) => (
                <Link
                  key={topic.topic}
                  href={inboxLink(inboxHref, { status: "all", topic: topic.topic, from })}
                  className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted/50"
                >
                  {t("insights.topics.growth", { topic: name(topic.topic), now: number(topic.tickets, locale), before: number(topic.before, locale) })}
                </Link>
              ))}
            </p>
          )}
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium">{t("insights.topics.topic")}</th>
                  <th className="hidden px-4 py-2 text-start font-medium sm:table-cell">{t("insights.topics.trend")}</th>
                  <th className="px-4 py-2 text-end font-medium">{t("insights.topics.tickets")}</th>
                  <th className="px-4 py-2 text-end font-medium" title={t("insights.topics.acceptedHelp")}>
                    {t("insights.topics.accepted")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.topics.map((topic) => (
                  <tr key={topic.topic}>
                    <td className="w-full max-w-0 truncate px-4 py-2 font-medium">
                      <Link href={inboxLink(inboxHref, { status: "all", topic: topic.topic, from })} className="underline-offset-2 hover:underline">
                        <bdi>{name(topic.topic)}</bdi>
                      </Link>
                    </td>
                    <td className="hidden px-4 py-2 sm:table-cell">
                      <Sparkline values={topic.days} />
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums whitespace-nowrap">
                      <span className="me-2">
                        <Delta now={topic.tickets} before={topic.before} days={days} />
                      </span>
                      {number(topic.tickets, locale)}
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums whitespace-nowrap">
                      {topic.drafts ? (
                        <>
                          {percent(topic.accepted / topic.drafts, locale)} <span className="text-xs text-muted-foreground">/ {number(topic.drafts, locale)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {urgencyTotal > 0 && (
              <div className="space-y-3 rounded-xl border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t("insights.topics.urgency")}</p>
                <Parts total={urgencyTotal} parts={(["urgent", "high", "normal", "low"] as const).map((u) => ({ label: t(`insights.urgency.${u}`), count: data.urgency.current[u], className: URGENCY_STYLES[u] }))} />
              </div>
            )}
            {share(data.mood.current) !== null && (
              <div className="space-y-1">
                <Chart
                  kind="line"
                  title={t("insights.topics.mood")}
                  labels={bucketLabels(from, data.mood.days.length, locale, t)}
                  series={[{ label: `${t("insights.topics.mood")} (%)`, values: upset, className: "text-amber-500", swatch: "bg-amber-500" }]}
                />
                <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                  {t("insights.topics.moodShare", { share: percent(share(data.mood.current)!, locale) })}
                  <Delta now={share(data.mood.current)} before={share(data.mood.previous)} days={days} better="lower" format={(v) => percent(v, locale)} />
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function AiShare({ data, days }: { data: AiInsights; days: Days }) {
  const { t, locale } = useSupport();
  const now: DraftShare = data.drafts.current;
  const total = now.autopilotSent + now.usedAsIs + now.lightlyEdited + now.rewritten + now.discarded;
  const carried = (share: DraftShare) => {
    const all = share.autopilotSent + share.usedAsIs + share.lightlyEdited + share.rewritten + share.discarded;
    return all ? (share.autopilotSent + share.usedAsIs + share.lightlyEdited) / all : null;
  };
  const { withDraft, withoutDraft } = data.firstReply;
  const reply = (d: Distribution) => (d.median === null ? <span className="text-base font-normal text-muted-foreground">{t("insights.noData")}</span> : formatSpan(d.median, locale));
  return (
    <Section title={t("insights.ai.heading")}>
      {total === 0 ? (
        <Empty>{t("insights.ai.noDrafts")}</Empty>
      ) : (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("insights.ai.drafts", { count: number(total, locale) })}</p>
          <Parts
            total={total}
            parts={[
              { label: t("insights.ai.autopilotSent"), count: now.autopilotSent, className: "bg-primary" },
              { label: t("insights.ai.usedAsIs"), count: now.usedAsIs, className: "bg-emerald-600 dark:bg-emerald-500" },
              { label: t("insights.ai.lightlyEdited"), count: now.lightlyEdited, className: "bg-emerald-600/45 dark:bg-emerald-500/45" },
              { label: t("insights.ai.rewritten"), count: now.rewritten, className: "bg-amber-500" },
              { label: t("insights.ai.discarded"), count: now.discarded, className: "bg-muted-foreground/50" },
            ]}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {carried(now) !== null && (
          <Tile
            label={t("insights.ai.carried")}
            value={
              <>
                {percent(carried(now)!, locale)}
                <Delta now={carried(now)} before={carried(data.drafts.previous)} days={days} better="higher" format={(v) => percent(v, locale)} />
              </>
            }
          />
        )}
        {(now.autopilotSent > 0 || now.autopilotFlagged > 0) && <Tile label={t("insights.ai.flagged")} value={number(now.autopilotFlagged, locale)} />}
        <Tile label={t("insights.ai.withDraft")} value={reply(withDraft)}>
          {withDraft.count > 0 && t("insights.ai.medianOf", { count: number(withDraft.count, locale) })}
        </Tile>
        <Tile label={t("insights.ai.withoutDraft")} value={reply(withoutDraft)}>
          {withoutDraft.count > 0 && t("insights.ai.medianOf", { count: number(withoutDraft.count, locale) })}
        </Tile>
      </div>
    </Section>
  );
}

/** The portal's Ask box: how many conversations ended without a ticket, by a thumbs-up or by a quiet day. */
function SelfServe({ data, days }: { data: AiInsights; days: Days }) {
  const { t, locale } = useSupport();
  const now = data.selfServe?.current;
  const before = data.selfServe?.previous;
  if (!now || !before || (!now.conversations && !before.conversations)) return null;
  const rated = now.helpful + now.notHelpful;
  return (
    <Section title={t("insights.selfServe.heading")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t("insights.selfServe.deflected")}
          value={
            <>
              {number(now.deflected, locale)}
              <Delta now={now.deflected} before={before.deflected} days={days} better="higher" />
            </>
          }
        >
          {t("insights.selfServe.deflectedOf", { count: number(now.conversations, locale) })}
        </Tile>
        <Tile label={t("insights.selfServe.escalated")} value={number(now.escalated, locale)} />
        {rated > 0 && (
          <Tile label={t("insights.selfServe.helpful")} value={percent(now.helpful / rated, locale)}>
            {t("insights.selfServe.helpfulOf", { count: number(rated, locale) })}
          </Tile>
        )}
      </div>
    </Section>
  );
}

function GapList({ data }: { data: AiInsights }) {
  const { t, locale, aiSettingsHref } = useSupport();
  const href = aiSettingsHref ? `${aiSettingsHref}#support-gaps` : null;
  return (
    <Section title={t("insights.gaps.heading")} help={t("insights.gaps.help")}>
      {data.gaps.length ? (
        <>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {data.gaps.map((gap) => {
              const row = (
                <>
                  <span dir="auto" className="min-w-0 flex-1 truncate font-medium">
                    {gap.theme}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("insights.gaps.count", { count: number(gap.count, locale) })}</span>
                </>
              );
              return (
                <li key={gap.id}>
                  {href ? (
                    <Link href={href} className="flex items-baseline gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50">
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-baseline gap-3 px-4 py-2.5 text-sm">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {href && (
            <Link href={href} className="inline-block text-xs font-medium text-primary underline-offset-2 hover:underline">
              {t("insights.gaps.open")}
            </Link>
          )}
        </>
      ) : (
        <Empty>{t("insights.gaps.empty")}</Empty>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ spikes

const spikeLink = (inboxHref: string, spike: Spike) =>
  inboxLink(inboxHref, { status: "all", topic: spike.topic, from: toDate(spike.startedAt), to: spike.endedAt ? toDate(spike.endedAt) : null });

/**
 * Spikes nobody has acknowledged, as likely incidents: the topic, how many customers, since
 * when, and its latest tickets. Mounted at the top of Insights and, without the tickets (the list
 * is right below), of the inbox; renders nothing without `ai.listSpikes` or while there is none.
 */
export function SpikeAlerts({ tickets = true }: { tickets?: boolean }) {
  const { client, t, locale, inboxHref, ticketHref } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const spikes = useQuery({ queryKey: ["support", "ai", "spikes"], queryFn: () => ai!.listSpikes!(), enabled: Boolean(ai?.listSpikes), refetchInterval: 60_000 });
  const acknowledge = useMutation({
    mutationFn: (id: string) => ai!.acknowledgeSpike!({ id }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["support", "ai", "spikes"] });
      void queryClient.invalidateQueries({ queryKey: ["support", "ai", "insights"] });
    },
  });
  // Saying it is an incident and writing to the customers it affects are one step: the spike is
  // acknowledged, then the dialog shows who would be written to before anything is sent.
  const [messaging, setMessaging] = useState<Pick<Spike, "id" | "topic"> | null>(null);
  const incident = useMutation({
    mutationFn: (spike: Spike) => ai!.acknowledgeSpike!({ id: spike.id }),
    onSuccess: (_, spike) => setMessaging({ id: spike.id, topic: spike.topic }),
  });
  const dialog = messaging && (
    <BroadcastDialog
      spike={messaging}
      onClose={() => {
        setMessaging(null);
        void queryClient.invalidateQueries({ queryKey: ["support", "ai", "spikes"] });
        void queryClient.invalidateQueries({ queryKey: ["support", "ai", "insights"] });
      }}
    />
  );
  if (!spikes.data?.length) return dialog || null;
  return (
    <div className="space-y-3">
      {dialog}
      {spikes.data.map((spike) => (
        <div key={spike.id} role="alert" className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-[14rem] flex-1 gap-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div className="space-y-0.5 text-sm">
                <p className="font-medium">{t("insights.spike.title", { topic: spike.topic })}</p>
                <p className="text-muted-foreground">
                  {t(spike.usual >= 0.5 ? "insights.spike.body" : "insights.spike.bodyNew", {
                    customers: number(spike.customers, locale),
                    since: formatWhen(spike.startedAt, locale),
                    usual: t("insights.tickets", { count: number(spike.usual, locale, 1) }),
                  })}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href={spikeLink(inboxHref, spike)} className="text-sm font-medium underline underline-offset-2">
                {t("insights.viewTickets")}
              </Link>
              {ai?.acknowledgeSpike && (
                <Button type="button" variant="outline" size="sm" disabled={acknowledge.isPending || incident.isPending} onClick={() => acknowledge.mutate(spike.id)}>
                  {acknowledge.isPending && acknowledge.variables === spike.id && <Loader2 className="size-4 animate-spin" />}
                  {t("insights.spike.acknowledge")}
                </Button>
              )}
              {ai?.acknowledgeSpike && ai.previewBroadcast && ai.sendBroadcast && (
                <Button type="button" size="sm" disabled={acknowledge.isPending || incident.isPending} onClick={() => incident.mutate(spike)}>
                  {incident.isPending && incident.variables?.id === spike.id && <Loader2 className="size-4 animate-spin" />}
                  {t("broadcast.open")}
                </Button>
              )}
            </div>
          </div>
          {tickets && spike.latest.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-amber-300/50 pt-3 text-sm dark:border-amber-500/20">
              {spike.latest.map((ticket) => (
                <li key={ticket.id}>
                  <Link href={ticketHref(ticket.id)} className="flex items-baseline gap-2 underline-offset-2 hover:underline">
                    <span className="shrink-0 tabular-nums text-muted-foreground">#{ticket.number}</span>
                    <span dir="auto" className="truncate">
                      {ticket.subject || t("inbox.noSubject")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function SpikeHistory({ data }: { data: AiInsights }) {
  const { client, t, locale, inboxHref } = useSupport();
  const [messaging, setMessaging] = useState<Pick<Spike, "id" | "topic"> | null>(null);
  const canMessage = Boolean(client.ai?.previewBroadcast && client.ai.sendBroadcast);
  if (!data.spikes.length) return null;
  const when = (value: DateLike) => formatWhen(value, locale);
  return (
    <Section title={t("insights.spike.history")}>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {data.spikes.map((spike) => (
          <li key={spike.id}>
            <Link href={spikeLink(inboxHref, spike)} className="block space-y-0.5 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50">
              <span className="flex items-baseline justify-between gap-3">
                <bdi className="truncate font-medium">{spike.topic}</bdi>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{when(spike.startedAt)}</span>
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("insights.spike.line", { customers: number(spike.customers, locale), tickets: number(spike.tickets, locale) })}
                {" · "}
                {spike.endedAt ? t("insights.spike.ended", { when: when(spike.endedAt) }) : t("insights.spike.ongoing")}
                {" · "}
                {spike.acknowledgedBy ? t("insights.spike.acknowledgedBy", { name: spike.acknowledgedBy.name }) : t("insights.spike.unacknowledged")}
                {spike.messaged ? ` · ${t("insights.spike.messaged", { count: number(spike.messaged, locale) })}` : ""}
              </span>
            </Link>
            {/* An acknowledged incident whose customers haven't heard from you yet. */}
            {canMessage && spike.acknowledgedAt && !spike.messaged && (
              <div className="px-4 pb-2.5">
                <Button type="button" variant="outline" size="sm" onClick={() => setMessaging({ id: spike.id, topic: spike.topic })}>
                  {t("broadcast.open")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {messaging && <BroadcastDialog spike={messaging} onClose={() => setMessaging(null)} />}
    </Section>
  );
}
