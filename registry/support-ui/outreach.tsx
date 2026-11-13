"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupport } from "./provider";
import type { AutopilotRecord, Outreach, OutreachKind, OutreachOverview, Spike } from "./client";
import { fillPlaceholders, formatWhen } from "./format";
import { Sources } from "./ai";
import { MessageText } from "./parts";

/*
 * Proactive outreach: the queue in the inbox where messages drafted from your product's signals
 * wait for an agent, the readiness view in AI settings where a kind of message earns sending on
 * its own, and the dialog that writes to every customer an incident affects. Each part appears
 * only when the client has the methods behind it.
 */

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const percent = (rate: number) => Math.floor(rate * 100);
const clock = (value: Date | string, locale: string) => new Date(value).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
/** "payouts_failing" reads as "Payouts failing". */
const kindLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ");

/** The inbox's Outreach tab: what waits for an agent, then what was decided lately. */
export function OutreachQueue() {
  const { client, t } = useSupport();
  const ai = client.ai;
  const queue = useQuery({ queryKey: ["support", "ai", "outreach", "queue"], queryFn: () => ai!.listOutreach!(), enabled: Boolean(ai?.listOutreach), refetchInterval: 20_000 });
  const [showRecent, setShowRecent] = useState(false);
  const recent = useQuery({ queryKey: ["support", "ai", "outreach", "recent"], queryFn: () => ai!.listOutreach!({ sent: true }), enabled: Boolean(ai?.listOutreach) && showRecent });
  if (!ai?.listOutreach) return null;
  return (
    <div className="space-y-3">
      {queue.error ? (
        <div className="rounded-xl border bg-card px-4 py-12 text-center">
          <p className="text-sm text-destructive">{t("errors.load")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => queue.refetch()}>
            {t("actions.retry")}
          </Button>
        </div>
      ) : !queue.data ? (
        <Skeleton className="h-48" />
      ) : queue.data.length ? (
        <ul className="space-y-3">
          {queue.data.map((item) => (
            <ProposalCard key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border bg-card px-4 py-16 text-center text-sm text-muted-foreground">{t("ai.outreach.empty")}</p>
      )}
      <div>
        <button type="button" aria-expanded={showRecent} onClick={() => setShowRecent(!showRecent)} className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {t("ai.outreach.recent")}
        </button>
        {showRecent && (recent.data ? <RecentList items={recent.data} /> : <Skeleton className="mt-2 h-16" />)}
      </div>
    </div>
  );
}

function ProposalCard({ item }: { item: Outreach }) {
  const { client, t, locale, ticketHref } = useSupport();
  const router = useRouter();
  const queryClient = useQueryClient();
  const ai = client.ai!;
  // A message AI couldn't write opens ready to be written.
  const unwritten = item.status !== "drafting" && !item.text;
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(item.subject ?? "");
  const [text, setText] = useState(item.text ?? "");
  const writing = editing || unwritten;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["support", "ai", "outreach"] });
    void queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
    void queryClient.invalidateQueries({ queryKey: ["support", "counts"] });
  };
  const send = useMutation({
    mutationFn: () => ai.sendOutreach!({ id: item.id, ...(writing ? { subject: subject.trim(), text: text.trim() } : {}) }),
    onSuccess: ({ ticketId }) => router.push(ticketHref(ticketId)),
    onSettled: refresh,
  });
  const dismiss = useMutation({ mutationFn: () => ai.dismissOutreach!({ id: item.id }), onSettled: refresh });
  const stop = useMutation({ mutationFn: () => ai.holdOutreach!({ id: item.id }), onSettled: refresh });
  const busy = send.isPending || dismiss.isPending || stop.isPending;
  const error = send.error ?? dismiss.error ?? stop.error;
  const undelivered = item.status === "failed" && item.ticketId;

  return (
    <li className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-sm">
          <bdi className="font-semibold">{item.customer.name}</bdi>
          <span className="text-muted-foreground"> · {item.title}</span>
        </p>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatWhen(item.createdAt, locale)}</span>
      </div>
      {item.facts.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
          {item.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd dir="auto" className="min-w-0 break-words">
                {fact.url ? (
                  <a href={fact.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {fact.value}
                  </a>
                ) : (
                  fact.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {item.status === "drafting" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("ai.outreach.drafting")}
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">
            <bdi>{item.contact ? t("ai.outreach.to", { name: item.contact.name ? `${item.contact.name} · ${item.contact.address ?? ""}` : (item.contact.address ?? "") }) : t("ai.outreach.noContact")}</bdi>
          </p>
          {writing ? (
            <>
              {unwritten && item.lastError && <p className="text-sm text-muted-foreground">{t("ai.outreach.notDrafted", { reason: item.lastError })}</p>}
              <Input value={subject} dir="auto" maxLength={200} onChange={(e) => setSubject(e.target.value)} aria-label={t("ai.outreach.subject")} placeholder={t("ai.outreach.subject")} />
              <Textarea value={text} dir="auto" onChange={(e) => setText(e.target.value)} aria-label={t("ai.outreach.message")} placeholder={t("ai.outreach.write")} className="min-h-36" />
            </>
          ) : (
            <>
              {item.subject && (
                <p dir="auto" className="text-sm font-medium">
                  {item.subject}
                </p>
              )}
              <MessageText text={item.text ?? ""} />
            </>
          )}
          {!writing && <Sources sources={item.sources} />}
        </div>
      )}

      {item.status === "held" && item.sendAt && <p className="text-sm text-amber-800 dark:text-amber-300">{t("ai.outreach.held", { time: clock(item.sendAt, locale) })}</p>}
      {item.status === "pending" && item.autoBlock && <p className="text-sm text-muted-foreground">{t("ai.outreach.left", { reason: t(`ai.outreach.block.${item.autoBlock}`) })}</p>}
      {item.status === "failed" && <p className="text-sm text-destructive">{t("ai.outreach.failed", { reason: item.lastError ?? "" })}</p>}
      {error && <p className="text-sm text-destructive">{message(error, t("errors.send"))}</p>}

      {item.status !== "drafting" && item.status !== "sending" && (
        <div className="flex flex-wrap items-center gap-2">
          {undelivered ? (
            <Link href={ticketHref(item.ticketId!)} className="text-sm font-medium underline underline-offset-2">
              {t("ai.outreach.openTicket")}
            </Link>
          ) : (
            <>
              {item.status === "held" && ai.holdOutreach && (
                <Button type="button" size="sm" disabled={busy} onClick={() => stop.mutate()}>
                  {stop.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("ai.outreach.stop")}
                </Button>
              )}
              {item.status !== "held" && ai.sendOutreach && (
                <Button type="button" size="sm" disabled={busy || !item.contact || (writing ? !text.trim() : !item.text)} onClick={() => send.mutate()}>
                  {send.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("ai.outreach.send")}
                </Button>
              )}
              {item.status !== "held" && !unwritten && (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>
                  {t(editing ? "actions.cancel" : "ai.outreach.edit")}
                </Button>
              )}
            </>
          )}
          {ai.dismissOutreach && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>
              {dismiss.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("ai.outreach.dismiss")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function RecentList({ items }: { items: Outreach[] }) {
  const { t, locale, ticketHref } = useSupport();
  if (!items.length) return <p className="mt-2 text-sm text-muted-foreground">{t("ai.autopilot.noExamples")}</p>;
  return (
    <ul className="mt-2 divide-y overflow-hidden rounded-xl border bg-card">
      {items.map((item) => {
        const sent = item.auto ? t("ai.outreach.sentAuto") : t("ai.outreach.sent", { name: item.decidedBy?.name ?? "" });
        const how = item.status === "dismissed" ? t("ai.outreach.dismissed", { name: item.decidedBy?.name ?? "" }) : item.flaggedAt ? `${sent} · ${t("ai.autopilot.outcome.flagged")}` : sent;
        const line = (
          <>
            <span className="min-w-0 truncate">
              <bdi className="font-medium">{item.customer.name}</bdi>
              <span className="text-muted-foreground"> · {item.title}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {how} · {formatWhen(item.decidedAt ?? item.createdAt, locale)}
            </span>
          </>
        );
        const row = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm";
        return (
          <li key={item.id}>
            {item.ticketId ? (
              <Link href={ticketHref(item.ticketId)} className={cn(row, "transition-colors hover:bg-muted/50")}>
                {line}
              </Link>
            ) : (
              <div className={row}>{line}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const stageStyles: Record<OutreachKind["stage"], string> = {
  collecting: "bg-muted text-muted-foreground ring-border",
  eligible: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  on: "bg-primary text-primary-foreground ring-primary",
  paused: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
};

const PARTS: { key: "used" | "light" | "heavy" | "discarded" | "unhappy" | "flagged"; count: (r: AutopilotRecord) => number; className: string }[] = [
  { key: "used", count: (r) => r.usedAsIs, className: "bg-emerald-600 dark:bg-emerald-500" },
  { key: "light", count: (r) => r.lightlyEdited, className: "bg-emerald-600/45 dark:bg-emerald-500/45" },
  { key: "heavy", count: (r) => r.heavilyEdited, className: "bg-amber-500" },
  { key: "discarded", count: (r) => r.discarded, className: "bg-muted-foreground/50" },
  { key: "unhappy", count: (r) => r.cameBackUnhappy, className: "bg-red-400" },
  { key: "flagged", count: (r) => r.flagged, className: "bg-red-600" },
];

/** In AI settings: each kind of outreach with its track record, and the switch that lets it send on its own. */
export function OutreachKinds() {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const enabled = Boolean(ai?.getOutreachKinds && ai.setOutreachKind);
  const overview = useQuery({ queryKey: ["support", "ai", "outreach", "kinds"], queryFn: () => ai!.getOutreachKinds!(), enabled });
  const decide = useMutation({
    mutationFn: (input: { kind: string; on: boolean }) => ai!.setOutreachKind!(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support", "ai", "outreach"] }),
  });
  const data = overview.data;
  if (!enabled || (data && !data.autoSend)) return null;
  return (
    <section className="space-y-3 border-t pt-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{t("ai.outreach.kindsHeading")}</h2>
        <p className="text-sm text-muted-foreground">{t("ai.outreach.kindsHelp", { minutes: data?.holdMinutes ?? 10 })}</p>
      </div>
      {overview.error ? (
        <p className="text-sm text-destructive">{t("errors.load")}</p>
      ) : !data ? (
        <Skeleton className="h-24" />
      ) : data.kinds.length ? (
        <>
          <ul className="divide-y rounded-xl border bg-card">
            {data.kinds.map((kind) => (
              <KindRow
                key={kind.kind}
                kind={kind}
                overview={data}
                busy={decide.isPending && decide.variables?.kind === kind.kind}
                error={decide.isError && decide.variables?.kind === kind.kind ? message(decide.error, t("ai.failed")) : null}
                onDecide={(on) => decide.mutate({ kind: kind.kind, on })}
              />
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t("ai.outreach.kindsRule", { drafts: data.minDrafts, days: data.windowDays, rate: percent(data.minRate) })}</p>
        </>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("ai.outreach.kindsEmpty")}</p>
      )}
    </section>
  );
}

function KindRow({ kind, overview, busy, error, onDecide }: { kind: OutreachKind; overview: OutreachOverview; busy: boolean; error: string | null; onDecide: (on: boolean) => void }) {
  const { t, locale } = useSupport();
  const { record, stage } = kind;
  const counts = PARTS.map((part) => ({ ...part, value: part.count(record) })).filter((part) => part.value > 0);
  const judged = record.recent.drafts >= overview.minDrafts;
  return (
    <li className="space-y-2.5 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <bdi className="truncate text-sm font-medium">{kindLabel(kind.kind)}</bdi>
          <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", stageStyles[stage])}>{t(`ai.autopilot.stage.${stage}`)}</span>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {(stage === "eligible" || stage === "paused") && (
            <Button type="button" size="sm" disabled={busy || !kind.ready} onClick={() => onDecide(true)}>
              {t(stage === "paused" ? "ai.autopilot.resume" : "ai.autopilot.switchOn")}
            </Button>
          )}
          {(stage === "on" || stage === "paused") && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onDecide(false)}>
              {t("ai.autopilot.switchOff")}
            </Button>
          )}
        </div>
      </div>
      {kind.example && (
        <p dir="auto" className="text-sm text-muted-foreground">
          {kind.example}
        </p>
      )}
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
            ? t("ai.outreach.evidence", { good: record.recent.good, drafts: record.recent.drafts, rate: percent(record.recent.rate) })
            : t("ai.outreach.progress", { drafts: record.recent.drafts, needed: overview.minDrafts })}
        </p>
        {counts.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            {counts.map((part) => (
              <li key={part.key} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", part.className)} aria-hidden />
                {t(`ai.outreach.counts.${part.key}`, { count: part.value })}
              </li>
            ))}
            {record.sentByAutopilot > 0 && <li>{t("ai.outreach.sentOnItsOwn", { count: record.sentByAutopilot })}</li>}
          </ul>
        )}
      </div>
      {stage === "paused" && kind.pausedAt && (
        <p className="text-sm text-amber-800 dark:text-amber-300">{t(kind.pauseReason === "flagged" ? "ai.outreach.pausedFlagged" : "ai.outreach.pausedNote", { when: formatWhen(kind.pausedAt, locale) })}</p>
      )}
      {stage === "on" && kind.enabledBy && kind.enabledAt && (
        <p className="text-xs text-muted-foreground">{t("ai.autopilot.enabledBy", { name: kind.enabledBy.name, when: formatWhen(kind.enabledAt, locale) })}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}

/**
 * One message to every customer an incident affects: who gets it, how it reads for the first of
 * them, and one button. Each customer gets their own ticket.
 */
export function BroadcastDialog({ spike, onClose }: { spike: Pick<Spike, "id" | "topic">; onClose: () => void }) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai!;
  const preview = useQuery({ queryKey: ["support", "ai", "broadcast", spike.id], queryFn: () => ai.previewBroadcast!({ spikeId: spike.id }), gcTime: 0 });
  const [intent, setIntent] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const draft = useMutation({
    mutationFn: () => ai.draftBroadcast!({ spikeId: spike.id, intent }),
    onSuccess: (result) => {
      setSubject(result.subject);
      setText(result.text);
    },
  });
  const send = useMutation({
    mutationFn: () => ai.sendBroadcast!({ spikeId: spike.id, subject: subject.trim(), text: text.trim() }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["support", "ai", "spikes"] });
      void queryClient.invalidateQueries({ queryKey: ["support", "ai", "insights"] });
      void queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["support", "counts"] });
    },
  });
  const data = preview.data;
  const first = data?.recipients[0];
  const needsSubject = !data?.channel || data.channel.kind === "email";
  const skipped = data ? (Object.entries(data.skipped) as [keyof typeof data.skipped, number][]).filter(([, count]) => count > 0) : [];
  const done = send.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("broadcast.title", { topic: spike.topic })}</DialogTitle>
          <DialogDescription>{t("broadcast.description")}</DialogDescription>
        </DialogHeader>
        {done ? (
          <>
            <div className="space-y-1 text-sm">
              <p className="font-medium">{t("broadcast.done", { count: done.sent })}</p>
              {done.queued > 0 && <p className="text-muted-foreground">{t("broadcast.queued", { count: done.queued })}</p>}
              {done.failed > 0 && <p className="text-destructive">{t("broadcast.failed", { count: done.failed })}</p>}
            </div>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                {t("broadcast.close")}
              </Button>
            </DialogFooter>
          </>
        ) : preview.error ? (
          <p className="text-sm text-destructive">{message(preview.error, t("errors.load"))}</p>
        ) : !data ? (
          <Skeleton className="h-64" />
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (data.recipients.length && text.trim() && (!needsSubject || subject.trim()) && !send.isPending) send.mutate();
            }}
          >
            {data.recipients.length ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium tabular-nums">{t("broadcast.recipients", { count: data.recipients.length })}</p>
                <ul className="max-h-28 divide-y overflow-y-auto rounded-md border text-sm">
                  {data.recipients.map((recipient) => (
                    <li key={recipient.customer.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                      <bdi className="truncate font-medium">{recipient.customer.name}</bdi>
                      <bdi className="shrink-0 truncate text-muted-foreground">{recipient.contact.name ?? recipient.contact.address}</bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("broadcast.none")}</p>
            )}
            {skipped.map(([reason, count]) => (
              <p key={reason} className="text-xs text-muted-foreground tabular-nums">
                {t(`broadcast.skipped.${reason}`, { count })}
              </p>
            ))}

            {data.recipients.length > 0 && (
              <>
                {ai.draftBroadcast && (
                  <div className="space-y-1.5 rounded-lg border border-dashed p-3">
                    <label htmlFor="support-broadcast-intent" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Sparkles className="size-3.5 text-primary" aria-hidden />
                      {t("newTicket.intent")}
                    </label>
                    <div className="flex gap-2">
                      <Input id="support-broadcast-intent" value={intent} dir="auto" maxLength={2000} onChange={(e) => setIntent(e.target.value)} placeholder={t("broadcast.intentPlaceholder")} />
                      <Button type="button" variant="outline" disabled={!intent.trim() || draft.isPending} onClick={() => draft.mutate()}>
                        {draft.isPending && <Loader2 className="size-4 animate-spin" />}
                        {t("newTicket.draft")}
                      </Button>
                    </div>
                    {draft.error && <p className="text-xs text-destructive">{message(draft.error, t("ai.failed"))}</p>}
                  </div>
                )}
                {needsSubject && (
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">{t("broadcast.subject")}</span>
                    <Input value={subject} dir="auto" maxLength={200} onChange={(e) => setSubject(e.target.value)} />
                  </label>
                )}
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">{t("broadcast.message")}</span>
                  <Textarea value={text} dir="auto" onChange={(e) => setText(e.target.value)} className="min-h-32" />
                  <span className="block text-xs text-muted-foreground">{t("broadcast.placeholders", { name: "{name}", company: "{company}" })}</span>
                </label>
                {first && text.trim() && (
                  <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">{t("broadcast.preview", { name: first.contact.name ?? first.customer.name })}</p>
                    <MessageText text={fillPlaceholders(text, { name: first.contact.name?.trim().split(/\s+/)[0], company: first.customer.name })} />
                  </div>
                )}
              </>
            )}
            {send.error && <p className="text-sm text-destructive">{message(send.error, t("errors.send"))}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("actions.cancel")}
              </Button>
              {data.recipients.length > 0 && (
                <Button type="submit" disabled={!text.trim() || (needsSubject && !subject.trim()) || send.isPending}>
                  {send.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("broadcast.send", { count: data.recipients.length })}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
