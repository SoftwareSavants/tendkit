"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupport } from "./provider";
import type { AutopilotExample, AutopilotMode, AutopilotOverview, AutopilotRecord, AutopilotTopic, Suggestion, TicketDetail, TimelineEvent, TimelineMessage } from "./client";
import { formatWhen } from "./format";
import { SuggestionSources, languageName } from "./ai";
import { MessageText } from "./parts";

/*
 * Autopilot: the readiness view in AI settings, where a team sees each topic's track record and
 * decides whether it answers on its own, and the two marks it leaves on a ticket: a held reply
 * an agent can stop, and a sent one an agent can flag. Each part appears only when the client
 * has the method behind it.
 */

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const percent = (rate: number) => Math.floor(rate * 100);

const stageStyles: Record<AutopilotTopic["stage"], string> = {
  collecting: "bg-muted text-muted-foreground ring-border",
  eligible: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  on: "bg-primary text-primary-foreground ring-primary",
  paused: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
};

/** How the window's drafts ended. What went right is green, as the "Ready" it adds up to; what didn't is amber, grey and red. */
const PARTS: { key: "used" | "light" | "heavy" | "discarded" | "unhappy" | "flagged"; count: (r: AutopilotRecord) => number; className: string }[] = [
  { key: "used", count: (r) => r.usedAsIs, className: "bg-emerald-600 dark:bg-emerald-500" },
  { key: "light", count: (r) => r.lightlyEdited, className: "bg-emerald-600/45 dark:bg-emerald-500/45" },
  { key: "heavy", count: (r) => r.heavilyEdited, className: "bg-amber-500" },
  { key: "discarded", count: (r) => r.discarded, className: "bg-muted-foreground/50" },
  { key: "unhappy", count: (r) => r.cameBackUnhappy, className: "bg-red-400" },
  { key: "flagged", count: (r) => r.flagged, className: "bg-red-600" },
];

/** The Autopilot section of AI settings. */
export function AutopilotSettings() {
  const { client, t, locale } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const enabled = Boolean(ai?.getAutopilot && ai.setAutopilotTopic);
  const overview = useQuery({ queryKey: ["support", "ai", "autopilot"], queryFn: () => ai!.getAutopilot!(), enabled });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["support", "ai", "autopilot"] });
  const stop = useMutation({ mutationFn: (stopped: boolean) => ai!.setAutopilot!({ stopped }), onSettled: refresh });
  const decide = useMutation({ mutationFn: (input: { topic: string; on: boolean; mode?: AutopilotMode }) => ai!.setAutopilotTopic!(input), onSettled: refresh });
  const [switchingOn, setSwitchingOn] = useState<AutopilotTopic | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  if (!enabled) return null;
  const data = overview.data;

  return (
    <section className="space-y-3 border-t pt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-[14rem] flex-1 space-y-1">
          <h2 className="text-sm font-medium">{t("ai.autopilot.heading")}</h2>
          <p className="text-sm text-muted-foreground">{t("ai.autopilot.help")}</p>
        </div>
        {data && !data.stopped && ai?.setAutopilot && data.topics.some((topic) => topic.stage === "on") && (
          <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={stop.isPending} onClick={() => stop.mutate(true)}>
            {stop.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("ai.autopilot.stop")}
          </Button>
        )}
      </div>

      {data?.stopped && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="text-sm">
            <p className="font-medium">{t("ai.autopilot.stopped")}</p>
            {data.stoppedBy && data.stoppedAt && (
              <p className="text-muted-foreground">{t("ai.autopilot.stoppedBy", { name: data.stoppedBy.name, when: formatWhen(data.stoppedAt, locale) })}</p>
            )}
          </div>
          {ai?.setAutopilot && (
            <Button type="button" size="sm" disabled={stop.isPending} onClick={() => stop.mutate(false)}>
              {stop.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("ai.autopilot.start")}
            </Button>
          )}
        </div>
      )}
      {stop.error && <p className="text-sm text-destructive">{message(stop.error, t("ai.failed"))}</p>}

      {overview.error ? (
        <p className="text-sm text-destructive">{t("errors.load")}</p>
      ) : !data ? (
        <Skeleton className="h-32" />
      ) : data.topics.length ? (
        <>
          <ul className="divide-y rounded-xl border bg-card">
            {data.topics.map((topic) => (
              <TopicRow
                key={topic.topic}
                topic={topic}
                overview={data}
                busy={decide.isPending && decide.variables?.topic === topic.topic}
                error={decide.isError && decide.variables?.topic === topic.topic ? message(decide.error, t("ai.failed")) : null}
                onSwitchOn={() => setSwitchingOn(topic)}
                onDecide={(input) => decide.mutate({ topic: topic.topic, ...input })}
                onRead={ai?.autopilotExamples ? () => setReading(topic.topic) : undefined}
              />
            ))}
          </ul>
          <Bar overview={data} />
        </>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("ai.autopilot.empty")}</p>
      )}

      {switchingOn && data && (
        <SwitchOnDialog
          topic={switchingOn}
          holdMinutes={data.holdMinutes}
          onClose={() => setSwitchingOn(null)}
          onConfirm={(mode) => {
            decide.mutate({ topic: switchingOn.topic, on: true, mode });
            setSwitchingOn(null);
          }}
        />
      )}
      {reading && <ExamplesDialog topic={reading} onClose={() => setReading(null)} />}
    </section>
  );
}

function TopicRow({
  topic,
  overview,
  busy,
  error,
  onSwitchOn,
  onDecide,
  onRead,
}: {
  topic: AutopilotTopic;
  overview: AutopilotOverview;
  busy: boolean;
  error: string | null;
  onSwitchOn: () => void;
  onDecide: (input: { on: boolean; mode?: AutopilotMode }) => void;
  onRead?: () => void;
}) {
  const { t, locale } = useSupport();
  const { record, stage } = topic;
  const counts = PARTS.map((part) => ({ ...part, value: part.count(record) })).filter((part) => part.value > 0);
  const aside = [
    record.sentByAutopilot > 0 && t("ai.autopilot.sentByAutopilot", { count: record.sentByAutopilot }),
    record.cannotAnswer > 0 && t("ai.autopilot.cannotAnswer", { count: record.cannotAnswer }),
    record.reopened > 0 && t("ai.autopilot.reopened", { count: record.reopened }),
  ].filter(Boolean);
  const judged = record.recent.drafts >= overview.minDrafts;

  return (
    <li className="space-y-2.5 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <bdi className="truncate text-sm font-medium">{topic.topic}</bdi>
          <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", stageStyles[stage])}>
            {t(`ai.autopilot.stage.${stage}`)}
            {stage === "on" && topic.mode && ` · ${t(`ai.autopilot.mode.${topic.mode}`)}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {stage === "eligible" && (
            <Button type="button" size="sm" disabled={busy} onClick={onSwitchOn}>
              {t("ai.autopilot.switchOn")}
            </Button>
          )}
          {stage === "paused" && (
            <Button type="button" size="sm" disabled={busy || !topic.ready} onClick={() => onDecide({ on: true })}>
              {t("ai.autopilot.resume")}
            </Button>
          )}
          {(stage === "on" || stage === "paused") && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onDecide({ on: false })}>
              {t("ai.autopilot.switchOff")}
            </Button>
          )}
        </div>
      </div>

      {record.drafts > 0 && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {counts.map((part) => (
            <span key={part.key} className={part.className} style={{ width: `${(part.value / record.drafts) * 100}%` }} />
          ))}
        </div>
      )}

      <div className="space-y-1 text-sm">
        <p className={cn("tabular-nums", !judged && "text-muted-foreground")}>
          {judged
            ? t("ai.autopilot.evidence", { good: record.recent.good, drafts: record.recent.drafts, rate: percent(record.recent.rate) })
            : t("ai.autopilot.progress", { drafts: record.recent.drafts, needed: overview.minDrafts })}
        </p>
        {counts.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {counts.map((part) => (
              <li key={part.key} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", part.className)} aria-hidden />
                {t(`ai.autopilot.counts.${part.key}`, { count: part.value })}
              </li>
            ))}
          </ul>
        )}
        {aside.length > 0 && <p className="text-xs text-muted-foreground tabular-nums">{aside.join(" · ")}</p>}
        {record.languages.length > 1 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {record.languages.map((l) => `${languageName(l.language, locale)} ${l.good}/${l.drafts}`).join(" · ")}
          </p>
        )}
      </div>

      {stage === "paused" && topic.pausedAt && (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          {topic.pauseReason === "flagged"
            ? t("ai.autopilot.pausedFlagged", { when: formatWhen(topic.pausedAt, locale) })
            : t("ai.autopilot.pausedQuality", { when: formatWhen(topic.pausedAt, locale), rate: percent(overview.minRate) })}
        </p>
      )}

      {stage === "on" && topic.mode && (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm" disabled={busy}>
          <legend className="sr-only">{t("ai.autopilot.modeLabel", { topic: topic.topic })}</legend>
          {(["hold", "immediate"] as const).map((mode) => (
            <label key={mode} className="inline-flex items-center gap-1.5">
              <input type="radio" className="accent-primary" name={`support-autopilot-mode-${topic.topic}`} checked={topic.mode === mode} onChange={() => onDecide({ on: true, mode })} />
              {t(`ai.autopilot.mode.${mode}`)}
            </label>
          ))}
        </fieldset>
      )}

      {(onRead || (stage !== "collecting" && topic.enabledBy && topic.enabledAt)) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {onRead && record.drafts > 0 && (
            <button type="button" onClick={onRead} className="underline underline-offset-2 hover:text-foreground">
              {t("ai.autopilot.examples")}
            </button>
          )}
          {stage !== "collecting" && stage !== "eligible" && topic.enabledBy && topic.enabledAt && (
            <span>{t("ai.autopilot.enabledBy", { name: topic.enabledBy.name, when: formatWhen(topic.enabledAt, locale) })}</span>
          )}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}

/** The bar a topic has to clear, and the only way a team can move it: up. */
function Bar({ overview }: { overview: AutopilotOverview }) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState(String(overview.minDrafts));
  const [rate, setRate] = useState(String(percent(overview.minRate)));
  const floor = { drafts: overview.floor.minDrafts, rate: percent(overview.floor.minRate) };
  const save = useMutation({
    mutationFn: () =>
      client.ai!.setAutopilot!({
        // The code's own minimum is stored as "no override", so raising it in code later still takes effect.
        minDrafts: Number(drafts) > floor.drafts ? Number(drafts) : null,
        minRate: Number(rate) > floor.rate ? Number(rate) / 100 : null,
      }),
    onSuccess: () => setOpen(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support", "ai", "autopilot"] }),
  });
  const valid = Number.isInteger(Number(drafts)) && Number(drafts) >= floor.drafts && Number(rate) >= floor.rate && Number(rate) <= 100;

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        {t("ai.autopilot.rule", { drafts: overview.minDrafts, days: overview.windowDays, rate: percent(overview.minRate) })}{" "}
        {client.ai?.setAutopilot && !open && (
          <button type="button" onClick={() => setOpen(true)} className="underline underline-offset-2 hover:text-foreground">
            {t("ai.autopilot.raise")}
          </button>
        )}
      </p>
      {open && (
        <form
          className="space-y-2 rounded-xl border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs">
              {t("ai.autopilot.minDrafts")}
              <Input type="number" inputMode="numeric" min={floor.drafts} max={1000} value={drafts} onChange={(e) => setDrafts(e.target.value)} className="h-8 w-24 text-foreground" />
            </label>
            <label className="grid gap-1 text-xs">
              {t("ai.autopilot.minRate")}
              <Input type="number" inputMode="numeric" min={floor.rate} max={100} value={rate} onChange={(e) => setRate(e.target.value)} className="h-8 w-24 text-foreground" />
            </label>
            <Button type="submit" size="sm" disabled={!valid || save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("ai.settings.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t("actions.cancel")}
            </Button>
          </div>
          <p className="text-xs">{t("ai.autopilot.floor", { drafts: floor.drafts, rate: floor.rate })}</p>
          {save.error && <p className="text-xs text-destructive">{message(save.error, t("ai.failed"))}</p>}
        </form>
      )}
    </div>
  );
}

/** Switching on is a decision with a name on it: the evidence once more, and how replies will go out. */
function SwitchOnDialog({ topic, holdMinutes, onClose, onConfirm }: { topic: AutopilotTopic; holdMinutes: number; onClose: () => void; onConfirm: (mode: AutopilotMode) => void }) {
  const { t } = useSupport();
  const [mode, setMode] = useState<AutopilotMode>("hold");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("ai.autopilot.switchOnTitle", { topic: topic.topic })}</DialogTitle>
          <DialogDescription>{t("ai.autopilot.switchOnDescription")}</DialogDescription>
        </DialogHeader>
        <p className="text-sm tabular-nums">
          {t("ai.autopilot.evidence", { good: topic.record.recent.good, drafts: topic.record.recent.drafts, rate: percent(topic.record.recent.rate) })}
        </p>
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t("ai.autopilot.modeLabel", { topic: topic.topic })}</legend>
          {(["hold", "immediate"] as const).map((option) => (
            <label key={option} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", mode === option && "border-primary bg-primary/[0.03]")}>
              <input type="radio" name="support-autopilot-mode" className="mt-1 accent-primary" checked={mode === option} onChange={() => setMode(option)} />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{t(`ai.autopilot.mode.${option}`)}</span>
                <span className="block text-sm text-muted-foreground">{t(`ai.autopilot.modeHelp.${option}`, { minutes: holdMinutes })}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button type="button" onClick={() => onConfirm(mode)}>
            {t("ai.autopilot.switchOn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const outcomeStyles: Record<AutopilotExample["outcome"], string> = {
  used: "text-foreground",
  light: "text-foreground",
  heavy: "text-amber-700 dark:text-amber-300",
  discarded: "text-muted-foreground",
  flagged: "text-destructive",
  unhappy: "text-destructive",
};

/** The drafts behind a topic's numbers: what was drafted, what went out instead, and the ticket. */
function ExamplesDialog({ topic, onClose }: { topic: string; onClose: () => void }) {
  const { client, t, locale, ticketHref } = useSupport();
  const [onlyChanged, setOnlyChanged] = useState(false);
  const examples = useQuery({
    queryKey: ["support", "ai", "autopilot", "examples", topic, onlyChanged],
    queryFn: () => client.ai!.autopilotExamples!({ topic, ...(onlyChanged ? { only: "changed" as const } : {}) }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("ai.autopilot.examplesTitle", { topic })}</DialogTitle>
          <DialogDescription>{t("ai.autopilot.examplesDescription")}</DialogDescription>
        </DialogHeader>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          {t("ai.autopilot.onlyChanged")}
        </label>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {examples.error ? (
            <p className="text-sm text-destructive">{t("errors.load")}</p>
          ) : !examples.data ? (
            <Skeleton className="h-40" />
          ) : examples.data.length ? (
            examples.data.map((example) => (
              <article key={example.suggestionId} className="space-y-2 rounded-xl border p-3">
                <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className={cn("font-medium", outcomeStyles[example.outcome])}>{t(`ai.autopilot.outcome.${example.outcome}`)}</span>
                  {example.byAutopilot && <span>{t("ai.autopilot.name")}</span>}
                  <Link href={ticketHref(example.ticket.id)} className="text-foreground underline-offset-2 hover:underline tabular-nums" title={example.ticket.subject ?? undefined}>
                    #{example.ticket.number}
                  </Link>
                  <time className="ms-auto tabular-nums">{formatWhen(example.at, locale)}</time>
                </header>
                <MessageText text={example.draft} className="text-sm" />
                {example.sent && (
                  <div className="space-y-1 border-t pt-2">
                    <p className="text-xs text-muted-foreground">{t("ai.autopilot.sentInstead")}</p>
                    <MessageText text={example.sent} className="text-sm" />
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("ai.autopilot.noExamples")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The event that says Autopilot sent this message, when it did, and the flag raised on it since. */
export function autopilotMark(detail: TicketDetail, message: TimelineMessage) {
  if (message.kind !== "outbound" || message.authorId) return null;
  const events = detail.timeline.flatMap((entry) => (entry.type === "event" ? [entry.event] : []));
  const sent = events.find((event) => event.type === "autopilot_sent" && event.data.messageId === message.id);
  if (!sent) return null;
  return { sent, flagged: events.find((event) => event.type === "autopilot_flagged" && event.data.messageId === message.id) ?? null };
}

/** Under a reply Autopilot sent, for agents only: that it did, for which topic, and one click to say it was wrong. */
export function AutopilotMark({ detail, sent, flagged, agentName }: { detail: TicketDetail; sent: TimelineEvent; flagged: TimelineEvent | null; agentName: (id: string | null) => string | null }) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  // One click flags. The note is for those who want to say what was wrong, and stays out of the way.
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const flag = useMutation({
    mutationFn: () => client.ai!.flagAutopilotReply!({ suggestionId: String(sent.data.suggestionId), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "ticket", detail.ticket.id] });
      queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support", "counts"] });
      queryClient.invalidateQueries({ queryKey: ["support", "ai", "autopilot"] });
    },
  });
  const topic = typeof sent.data.topic === "string" ? sent.data.topic : "";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Send className="size-3.5" />
        <bdi>{t("ai.autopilot.sentBy", { topic })}</bdi>
      </span>
      {flagged ? (
        <span className="inline-flex items-center gap-1.5 text-destructive">
          <Flag className="size-3.5" />
          {t("ai.autopilot.flaggedBy", { actor: agentName(flagged.actorId) ?? t("ticket.formerAgent") })}
          {typeof flagged.data.note === "string" && flagged.data.note && <bdi className="text-muted-foreground">{flagged.data.note}</bdi>}
        </span>
      ) : (
        client.ai?.flagAutopilotReply && (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-muted-foreground underline underline-offset-2 hover:text-destructive disabled:opacity-60"
              disabled={flag.isPending}
              onClick={() => flag.mutate()}
            >
              {t("ai.autopilot.flag")}
            </button>
            {noting ? (
              <Input
                autoFocus
                dir="auto"
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !flag.isPending) flag.mutate();
                  if (e.key === "Escape") setNoting(false);
                }}
                placeholder={t("ai.autopilot.flagNotePlaceholder")}
                aria-label={t("ai.autopilot.flagNote")}
                className="h-7 w-56 max-w-full text-xs"
              />
            ) : (
              <button type="button" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setNoting(true)}>
                {t("ai.autopilot.flagNote")}
              </button>
            )}
          </>
        )
      )}
      {flag.error && <span className="text-destructive">{message(flag.error, t("ai.failed"))}</span>}
    </span>
  );
}

/** A reply waiting out its delay: the text that will go, when, and the way to stop it. */
export function HeldReply({ ticketId, suggestion }: { ticketId: string; suggestion: Suggestion }) {
  const { client, t, locale } = useSupport();
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: () => client.ai!.holdAutopilotReply!({ suggestionId: suggestion.id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support", "ticket", ticketId] }),
  });
  return (
    <div className="mx-4 mt-3 space-y-2 rounded-lg border border-primary/25 bg-primary/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Send className="size-3.5 text-primary" />
          {t("ai.autopilot.held", { time: suggestion.sendAt ? formatWhen(suggestion.sendAt, locale) : "" })}
        </span>
        {client.ai?.holdAutopilotReply && (
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending && <Loader2 className="size-3.5 animate-spin" />}
            {t("ai.autopilot.stopHeld")}
          </Button>
        )}
      </div>
      <MessageText text={suggestion.text ?? ""} className="text-sm" />
      <SuggestionSources suggestion={suggestion} />
      {stop.error && <p className="text-xs text-destructive">{message(stop.error, t("ai.failed"))}</p>}
    </div>
  );
}

/** Why a reply on a switched-on topic was left to the agent, in one line. Null when there's nothing to say. */
export function useAutopilotReason(suggestion: Suggestion | null) {
  const { t } = useSupport();
  // The agent who stopped a held reply knows why it's theirs.
  if (!suggestion?.autopilotBlock || suggestion.autopilotBlock === "held_back") return null;
  const key = `ai.autopilot.block.${suggestion.autopilotBlock}`;
  const reason = t(key);
  return reason === key ? null : t("ai.autopilot.left", { reason });
}
