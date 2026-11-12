"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";
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

const TABS: TicketStatus[] = ["open", "waiting", "solved"];
const PAGE_SIZE = 25;

/** The shared inbox: what needs an answer, longest wait first. With AI, the most urgent come before that. */
export function SupportInbox() {
  const { client, t, viewerId } = useSupport();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = (["open", "waiting", "solved", "spam"].includes(params.get("status") ?? "") ? params.get("status") : "open") as TicketStatus;
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
    queryKey: ["support", "tickets", { status, assignee, page, search, sort }],
    queryFn: () =>
      client.listTickets({
        status,
        assignee: assignee === "any" ? undefined : assignee === "none" ? null : assignee,
        search: search || undefined,
        ...(sort ? { sort } : {}),
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });

  const tabs = counts.data?.spam || status === "spam" ? [...TABS, "spam" as const] : TABS;
  const total = list.data?.total ?? 0;
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setParams({ status: tab === "open" ? null : tab })}
              className={cn(
                "shrink-0 border-b-2 px-3 pb-2.5 text-sm font-medium transition-colors",
                tab === status ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`status.${tab}`)}
              {tab !== "solved" && counts.data?.[tab] ? (
                <span className="ms-1.5 tabular-nums text-xs text-muted-foreground">{counts.data[tab]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-2">
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
        </div>
      </div>

      {list.error ? (
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
                <TicketRow key={ticket.id} ticket={ticket} status={status} agents={agents.data ?? []} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-16 text-center text-sm text-muted-foreground">
              {search ? t("inbox.empty.search") : t(`inbox.empty.${status}`)}
            </p>
          )}
        </div>
      )}

      {total > PAGE_SIZE && (
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
