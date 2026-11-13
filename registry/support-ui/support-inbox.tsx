"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSupport } from "./provider";
import type { TicketListItem, TicketStatus } from "./client";
import { contactLabel, formatDuration, formatWhen, waitLevel } from "./format";
import { AgentAvatar, UnknownSenderBadge } from "./parts";
import { UrgencyMark } from "./ai";
import { SpikeAlerts } from "./support-insights";
import { NewTicketButton } from "./new-ticket-dialog";
import { OutreachQueue } from "./outreach";

const TABS: TicketStatus[] = ["open", "waiting", "solved"];
const PAGE_SIZE = 25;

/** The shared inbox: what needs an answer, longest wait first. With AI, the most urgent come before that. */
export function SupportInbox() {
  const { client, t, viewerId, locale } = useSupport();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Links from Insights narrow the list to a topic, a channel, a customer or the days tickets were opened in.
  const date = (key: string) => {
    const value = params.get(key) ? new Date(params.get(key)!) : null;
    return value && Number.isFinite(value.getTime()) ? value : null;
  };
  const filters = { topic: params.get("topic"), channel: params.get("channel"), customer: params.get("customer"), from: date("from"), to: date("to") };
  const filtered = Boolean(filters.topic || filters.channel || filters.customer || filters.from || filters.to);
  // Outreach is a queue of its own next to the ticket lists: messages waiting to be sent, not tickets yet.
  const hasOutreach = Boolean(client.ai?.listOutreach);
  const outreach = hasOutreach && !filtered && params.get("status") === "outreach";
  const status = (["open", "waiting", "solved", "spam", ...(filtered ? ["all"] : [])].includes(params.get("status") ?? "") ? params.get("status") : "open") as TicketStatus | "all";
  const assignee = params.get("assignee") ?? "any";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const search = params.get("q") ?? "";
  const [draft, setDraft] = useState(search);

  const setParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in updates)) next.delete("page");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  useEffect(() => setDraft(search), [search]);
  useEffect(() => {
    if (draft === search) return;
    const timer = setTimeout(() => setParams({ q: draft.trim() || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const counts = useQuery({ queryKey: ["support", "counts"], queryFn: () => client.counts(), refetchInterval: 30_000 });
  const agents = useQuery({ queryKey: ["support", "agents"], queryFn: () => client.listAgents(), staleTime: 5 * 60_000 });
  const assigneeLabel =
    assignee === "any"
      ? t("inbox.anyone")
      : assignee === "me"
        ? t("inbox.me")
        : assignee === "none"
          ? t("inbox.unassigned")
          : (agents.data?.find((a) => a.id === assignee)?.name ?? t("inbox.anyone"));
  const sort = client.ai && status === "open" ? ("priority" as const) : undefined;
  const list = useQuery({
    queryKey: ["support", "tickets", { status, assignee, page, search, sort, ...filters, from: filters.from?.getTime(), to: filters.to?.getTime() }],
    queryFn: () =>
      client.listTickets({
        ...(status === "all" ? {} : { status }),
        ...(filters.topic ? { topic: filters.topic } : {}),
        ...(filters.channel ? { channel: filters.channel } : {}),
        ...(filters.customer ? { customerId: filters.customer } : {}),
        ...(filters.from ? { createdFrom: filters.from } : {}),
        ...(filters.to ? { createdTo: filters.to } : {}),
        assignee: assignee === "any" ? undefined : assignee === "none" ? null : assignee,
        search: search || undefined,
        ...(sort ? { sort } : {}),
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
    enabled: !outreach,
  });
  const proposals = useQuery({ queryKey: ["support", "ai", "outreach", "queue"], queryFn: () => client.ai!.listOutreach!(), enabled: hasOutreach, refetchInterval: 30_000 });

  const tabs: (TicketStatus | "all" | "outreach")[] = [
    ...(filtered ? ["all" as const] : []),
    ...TABS,
    ...(hasOutreach && !filtered ? ["outreach" as const] : []),
    ...(counts.data?.spam || status === "spam" ? ["spam" as const] : []),
  ];
  const current = outreach ? "outreach" : status;
  // Scrolls the tab strip, and nothing else, until the current tab shows. Counts arriving change its width.
  const strip = useRef<HTMLDivElement>(null);
  const tabCounts = `${counts.data?.open}/${counts.data?.waiting}/${counts.data?.spam}/${proposals.data?.length}`;
  useEffect(() => {
    const tab = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!tab || !strip.current) return;
    const [button, box] = [tab.getBoundingClientRect(), strip.current.getBoundingClientRect()];
    if (button.left < box.left || button.right > box.right) strip.current.scrollLeft += button.left - box.left - 12;
  }, [current, tabCounts]);
  const day = (value: Date) => value.toLocaleDateString(locale, { day: "numeric", month: "short" });
  const chips = [
    filters.topic && t("inbox.filters.topic", { value: filters.topic }),
    filters.channel && t("inbox.filters.channel", { value: filters.channel }),
    filters.customer && t("inbox.filters.customer", { value: list.data?.items.find((item) => item.customer?.id === filters.customer)?.customer?.name ?? filters.customer }),
    filters.from && (filters.to ? t("inbox.filters.opened", { from: day(filters.from), to: day(filters.to) }) : t("inbox.filters.openedSince", { from: day(filters.from) })),
  ].filter((chip): chip is string => Boolean(chip));
  const total = list.data?.total ?? 0;
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {!filtered && <SpikeAlerts tickets={false} />}
      {filtered && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span key={chip} className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium">
              <bdi>{chip}</bdi>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setParams({ topic: null, channel: null, customer: null, from: null, to: null, status: status === "all" ? null : status })}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
            {t("inbox.filters.clear")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        {/* On a phone the tabs scroll sideways, and the one you're on is brought into view. */}
        <div ref={strip} className="-mb-px flex min-w-0 max-w-full gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setParams({ status: tab === "open" ? null : tab })}
              aria-pressed={tab === current}
              className={cn(
                "shrink-0 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors",
                tab === current ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`status.${tab}`)}
              {/* The counts are the whole inbox's, so they'd mislead next to a filtered list. */}
              {tab === "outreach" ? (
                proposals.data?.length ? <span className="ms-1.5 tabular-nums text-xs text-muted-foreground">{proposals.data.length}</span> : null
              ) : !filtered && tab !== "solved" && tab !== "all" && counts.data?.[tab] ? (
                <span className="ms-1.5 tabular-nums text-xs text-muted-foreground">{counts.data[tab]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className={cn("flex flex-wrap items-center gap-2 pb-2", outreach && "hidden")}>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("inbox.search")}
              className="h-9 w-56 ps-8"
              aria-label={t("inbox.search")}
            />
          </div>
          {/* Works with Radix and Base UI selects: the label is rendered here, and an empty value means "anyone". */}
          <Select value={assignee} onValueChange={(value) => setParams({ assignee: !value || value === "any" ? null : String(value) })}>
            <SelectTrigger className="h-9 w-44" aria-label={t("inbox.assignee")}>
              <SelectValue>{assigneeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t("inbox.anyone")}</SelectItem>
              <SelectItem value="me">{t("inbox.me")}</SelectItem>
              <SelectItem value="none">{t("inbox.unassigned")}</SelectItem>
              {agents.data?.some((a) => a.id !== viewerId) && <SelectSeparator />}
              {agents.data
                ?.filter((a) => a.id !== viewerId)
                .map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <NewTicketButton variant="default" className="h-9" />
        </div>
      </div>

      {outreach ? (
        <OutreachQueue />
      ) : list.error ? (
        <div className="rounded-xl border bg-card px-4 py-12 text-center">
          <p className="text-sm text-destructive">{t("errors.load")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => list.refetch()}>
            {t("actions.retry")}
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden grid-cols-[8px_minmax(0,13rem)_minmax(0,1fr)_9rem_6rem] gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span />
            <span>{t("inbox.columns.customer")}</span>
            <span>{t("inbox.columns.subject")}</span>
            <span>{t("inbox.columns.assignee")}</span>
            <span className="text-end">{t(status === "open" ? "inbox.columns.waiting" : status === "solved" ? "inbox.columns.solved" : "inbox.columns.updated")}</span>
          </div>
          {list.isPending ? (
            <div className="divide-y">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex gap-4 px-4 py-3.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : list.data?.items.length ? (
            <ul className="divide-y">
              {list.data.items.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} status={ticket.status} agents={agents.data ?? []} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-16 text-center text-sm text-muted-foreground">
              {search ? t("inbox.empty.search") : t(`inbox.empty.${filtered ? "all" : status}`)}
            </p>
          )}
        </div>
      )}

      {!outreach && total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">{t("inbox.range", { from, to, total })}</span>
          <Button variant="outline" size="icon" className="size-8" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })} aria-label={t("actions.previous")}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <Button variant="outline" size="icon" className="size-8" disabled={to >= total} onClick={() => setParams({ page: String(page + 1) })} aria-label={t("actions.next")}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      )}
    </div>
  );
}

function TicketRow({ ticket, status, agents }: { ticket: TicketListItem; status: TicketStatus; agents: { id: string; name: string }[] }) {
  const { t, locale, ticketHref, responseTargetMinutes, viewerId } = useSupport();
  const who = contactLabel(ticket.contact);
  const previewAuthor =
    ticket.previewKind === "outbound"
      ? ticket.previewAuthorId === viewerId
        ? t("inbox.you")
        : agents.find((a) => a.id === ticket.previewAuthorId)?.name.split(" ")[0]
      : null;
  const level = ticket.waitingSince ? waitLevel(ticket.waitingSince, responseTargetMinutes) : "normal";
  // Once your team has answered, their reply says more than a summary of the question.
  const summary = ticket.previewKind !== "outbound" ? ticket.summary : null;

  return (
    <li>
      <Link
        href={ticketHref(ticket.id)}
        className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/50 md:grid-cols-[8px_minmax(0,13rem)_minmax(0,1fr)_9rem_6rem]"
      >
        <span className={cn("size-2 rounded-full", ticket.unread ? "bg-primary" : "bg-transparent")} aria-label={ticket.unread ? t("inbox.unread") : undefined} />
        <div className="min-w-0">
          <p className={cn("truncate text-sm", ticket.unread ? "font-semibold" : "font-medium")}>
            <bdi>{ticket.customer?.name ?? who}</bdi>
          </p>
          <div className="flex min-w-0 items-center gap-1.5">
            {ticket.customer ? (
              <p className="truncate text-xs text-muted-foreground">
                <bdi>{who}</bdi>
              </p>
            ) : (
              <UnknownSenderBadge />
            )}
          </div>
        </div>
        <div className="col-span-2 col-start-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p dir="auto" className={cn("truncate text-sm", ticket.unread ? "font-semibold" : "font-medium")}>
              {ticket.subject || t("inbox.noSubject")}
            </p>
            {ticket.draftReady && (
              <span className="shrink-0 text-primary" title={t("ai.draftReady")}>
                <Sparkles className="size-3.5" aria-label={t("ai.draftReady")} />
              </span>
            )}
          </div>
          {/* What the customer needs, when AI has read their message; else the message itself. */}
          <div className="flex min-w-0 items-center gap-1.5">
            {status === "open" && <UrgencyMark urgency={ticket.urgency} />}
            {summary ? (
              <p dir="auto" className="truncate text-sm text-muted-foreground">
                {summary}
              </p>
            ) : (
              ticket.preview && (
                <p dir="auto" className="truncate text-sm text-muted-foreground">
                  {previewAuthor && <span className="text-foreground/70">{previewAuthor}: </span>}
                  {ticket.preview}
                </p>
              )
            )}
          </div>
        </div>
        <div className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground md:col-start-4 md:row-start-1 md:flex">
          {ticket.assignee ? (
            <>
              <AgentAvatar name={ticket.assignee.name} />
              <span className="truncate">{ticket.assignee.id === viewerId ? t("inbox.you") : ticket.assignee.name.split(" ")[0]}</span>
            </>
          ) : (
            <span>{t("inbox.unassigned")}</span>
          )}
        </div>
        <div
          className={cn(
            "col-start-3 row-start-1 text-end text-xs tabular-nums whitespace-nowrap md:col-start-5 md:text-sm",
            level === "late" ? "font-semibold text-red-600 dark:text-red-400" : level === "soon" ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          )}
        >
          {status === "open" && ticket.waitingSince ? formatDuration(ticket.waitingSince, locale) : formatWhen(ticket.lastMessageAt, locale)}
        </div>
      </Link>
    </li>
  );
}
