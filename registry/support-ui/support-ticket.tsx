"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Ban, FileText, Link2, MoreHorizontal, RotateCw, UserPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { useSupport } from "./provider";
import type { Agent, TicketDetail, TicketStatus, TimelineEvent, TimelineMessage } from "./client";
import { contactLabel, formatTimestamp, formatWhen } from "./format";
import { AgentAvatar, AttachmentChip, EmailFrame, MessageText, StatusBadge, UnknownSenderBadge } from "./parts";
import { SupportComposer } from "./support-composer";
import { LinkCustomerDialog } from "./link-customer-dialog";
import { ChangeContactDialog } from "./change-contact-dialog";
import { TicketInsightBar, foreignLanguage, languageName, useMessageTranslation } from "./ai";
import { ApprovedAnswerDialog, ArticleDialog } from "./memory";

/** One ticket: the conversation, the reply box, and the customer next to it. */
export function SupportTicket({ ticketId }: { ticketId: string }) {
  const { client, t, inboxHref } = useSupport();
  const ticket = useQuery({
    queryKey: ["support", "ticket", ticketId],
    queryFn: () => client.getTicket(ticketId),
    refetchInterval: 15_000,
  });
  const agents = useQuery({ queryKey: ["support", "agents"], queryFn: () => client.listAgents(), staleTime: 5 * 60_000 });

  if (ticket.error) {
    return (
      <div className="rounded-xl border bg-card px-4 py-12 text-center">
        <p className="text-sm text-destructive">{t("errors.load")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => ticket.refetch()}>
          {t("actions.retry")}
        </Button>
      </div>
    );
  }
  if (!ticket.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-80" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <Skeleton className="h-96" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const detail = ticket.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={inboxHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {t("ticket.back")}
          </Link>
          <h1 dir="auto" className="mt-1 text-2xl font-semibold tracking-tight break-words">
            {detail.ticket.subject || t("inbox.noSubject")}
          </h1>
          <TicketInsightBar detail={detail} />
        </div>
        <TicketControls detail={detail} agents={agents.data ?? []} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <Timeline detail={detail} agents={agents.data ?? []} />
          {detail.ticket.status === "spam" ? (
            <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">{t("ticket.spamNotice")}</p>
          ) : (
            <SupportComposer detail={detail} />
          )}
        </div>
        <CustomerSidebar detail={detail} />
      </div>
    </div>
  );
}

function useTicketMutation<T>(ticketId: string, fn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "ticket", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support", "counts"] });
    },
  });
}

function TicketControls({ detail, agents }: { detail: TicketDetail; agents: Agent[] }) {
  const { client, t, viewerId } = useSupport();
  const id = detail.ticket.id;
  const setStatus = useTicketMutation(id, (status: TicketStatus) => client.setStatus({ ticketId: id, status }));
  const assign = useTicketMutation(id, (assigneeId: string | null) => client.assign({ ticketId: id, assigneeId }));
  const [linking, setLinking] = useState(false);
  const [changingContact, setChangingContact] = useState(false);
  const [draftingArticle, setDraftingArticle] = useState(false);
  // Controlled, so picking an option closes the menu with Radix and Base UI alike.
  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const assigneeName = detail.assignee ? (detail.assignee.id === viewerId ? t("inbox.you") : detail.assignee.name) : t("inbox.unassigned");
  const trigger = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {detail.ticket.status !== "spam" && (
        <DropdownMenu open={statusOpen} onOpenChange={setStatusOpen}>
          <DropdownMenuTrigger className={trigger} disabled={setStatus.isPending}>
            <span className="text-muted-foreground">{t("ticket.statusLabel")}</span>
            <span>{t(`status.${detail.ticket.status}`)}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            <DropdownMenuRadioGroup
              value={detail.ticket.status}
              onValueChange={(v) => {
                setStatusOpen(false);
                setStatus.mutate(v as TicketStatus);
              }}
            >
              {(["open", "waiting", "solved"] as const).map((status) => (
                <DropdownMenuRadioItem key={status} value={status}>
                  {t(`status.${status}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DropdownMenu open={assignOpen} onOpenChange={setAssignOpen}>
        <DropdownMenuTrigger className={trigger} disabled={assign.isPending}>
          <span className="text-muted-foreground">{t("ticket.assigneeLabel")}</span>
          <span>{assigneeName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-auto min-w-44 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={detail.ticket.assigneeId ?? ""}
            onValueChange={(v) => {
              setAssignOpen(false);
              assign.mutate(v || null);
            }}
          >
            <DropdownMenuRadioItem value={viewerId}>{t("ticket.assignToMe")}</DropdownMenuRadioItem>
            {agents
              .filter((a) => a.id !== viewerId)
              .map((agent) => (
                <DropdownMenuRadioItem key={agent.id} value={agent.id}>
                  {agent.name}
                </DropdownMenuRadioItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuRadioItem value="">{t("inbox.unassigned")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "outline", size: "icon" }) + " size-8"} aria-label={t("ticket.more")}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuItem onClick={() => setLinking(true)}>
            <Link2 className="size-4" />
            {detail.customer ? t("ticket.changeCustomer") : t("ticket.linkCustomer")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setChangingContact(true)}>
            <UserPen className="size-4" />
            {t("ticket.changeContact")}
          </DropdownMenuItem>
          {client.ai?.draftArticle && detail.ticket.status === "solved" && (
            <DropdownMenuItem onClick={() => setDraftingArticle(true)}>
              <FileText className="size-4" />
              {t("ai.article.draft")}
            </DropdownMenuItem>
          )}
          {detail.ticket.status === "spam" ? (
            <DropdownMenuItem onClick={() => setStatus.mutate("open")}>
              <RotateCw className="size-4" />
              {t("ticket.notSpam")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setStatus.mutate("spam")}>
              <Ban className="size-4" />
              {t("ticket.markSpam")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <LinkCustomerDialog detail={detail} open={linking} onOpenChange={setLinking} />
      <ChangeContactDialog detail={detail} open={changingContact} onOpenChange={setChangingContact} />
      <ArticleDialog open={draftingArticle} onOpenChange={setDraftingArticle} from={{ ticketIds: [detail.ticket.id] }} />
    </div>
  );
}

function Timeline({ detail, agents }: { detail: TicketDetail; agents: Agent[] }) {
  const { t, locale, viewerId } = useSupport();
  const agentName = (id: string | null) =>
    !id ? null : id === viewerId ? t("inbox.you") : agents.find((a) => a.id === id)?.name ?? t("ticket.formerAgent");

  // A reply already says who took the ticket and that it now waits on the customer; don't repeat it.
  const replies = detail.timeline.flatMap((e) =>
    e.type === "message" && e.message.kind === "outbound" && e.message.authorId ? [e.message] : []
  );
  const impliedByReply = (event: TimelineEvent) => {
    const selfAssigned = event.type === "assigned" && event.data.to === event.actorId;
    const nowWaiting = event.type === "status_changed" && event.data.to === "waiting";
    return (
      (selfAssigned || nowWaiting) &&
      replies.some(
        (m) => m.authorId === event.actorId && Math.abs(new Date(m.createdAt).getTime() - new Date(event.createdAt).getTime()) < 10_000
      )
    );
  };

  return (
    <ol className="space-y-3">
      {detail.timeline.filter((entry) => entry.type === "message" || !impliedByReply(entry.event)).map((entry) =>
        entry.type === "message" ? (
          <li key={entry.message.id}>
            <MessageCard message={entry.message} detail={detail} agents={agents} agentName={agentName} />
          </li>
        ) : (
          <li key={entry.event.id} className="px-2 py-1 text-center text-xs text-muted-foreground">
            {describeEvent(entry.event, t, agentName)} · {formatWhen(entry.event.createdAt, locale)}
          </li>
        )
      )}
    </ol>
  );
}

function describeEvent(event: TimelineEvent, t: ReturnType<typeof useSupport>["t"], agentName: (id: string | null) => string | null) {
  const actor = agentName(event.actorId) ?? t("ticket.events.system");
  switch (event.type) {
    case "assigned": {
      const to = event.data.to as string | null;
      if (!to) return t("ticket.events.unassigned", { actor });
      if (to === event.actorId) return t("ticket.events.took", { actor });
      return t("ticket.events.assigned", { actor, assignee: agentName(to) ?? "" });
    }
    case "status_changed":
      return t("ticket.events.status", { actor, status: t(`status.${event.data.to as TicketStatus}`) });
    case "customer_linked":
      return event.data.to ? t("ticket.events.linked", { actor }) : t("ticket.events.unlinked", { actor });
    case "reopened":
      return t("ticket.events.reopened");
    case "follow_up":
      return t("ticket.events.followUp", { number: String(event.data.number) });
    case "contact_changed":
      return t("ticket.events.contactChanged", { actor, address: String(event.data.address ?? "") });
    case "insight_changed": {
      const urgency = (event.data.urgency as { to?: string } | undefined)?.to;
      const topic = (event.data.topic as { to?: string } | undefined)?.to;
      if (urgency) return t("ticket.events.urgencyChanged", { actor, urgency: t(`ai.urgency.${urgency}`) });
      return t("ticket.events.topicChanged", { actor, topic: !topic || topic === "other" ? t("ai.otherTopic") : topic });
    }
    case "forwarded": {
      const from = event.data.from as { address: string; name?: string | null } | undefined;
      return t("ticket.events.forwarded", { actor: agentName(event.actorId) ?? from?.name ?? from?.address ?? actor });
    }
    default:
      return event.type;
  }
}

function MessageCard({
  message,
  detail,
  agents,
  agentName,
}: {
  message: TimelineMessage;
  detail: TicketDetail;
  agents: Agent[];
  agentName: (id: string | null) => string | null;
}) {
  const { client, t, locale } = useSupport();
  const [original, setOriginal] = useState(false);
  const retry = useTicketMutation(detail.ticket.id, () => client.retry({ messageId: message.id }));
  const translation = useMessageTranslation(message.id);
  const [saving, setSaving] = useState(false);

  if (message.auto && message.kind === "outbound") {
    return <p className="px-2 py-1 text-center text-xs text-muted-foreground">{t("ticket.autoReplySent")} · {formatWhen(message.createdAt, locale)}</p>;
  }

  const author =
    message.kind === "inbound"
      ? message.from?.name || message.from?.address || contactLabel(detail.contact)
      : agentName(message.authorId) ?? message.from?.name ?? t("ticket.formerAgent");
  // Initials come from the real name even when the label says "You".
  const avatarName =
    message.kind === "inbound" ? author : agents.find((a) => a.id === message.authorId)?.name ?? author;
  // Only offer the full message when it shows something more: quoted history, or layout and images.
  const hasMore =
    message.kind === "inbound" &&
    ((message.fullText !== null && message.fullText.trim() !== message.text.trim()) ||
      (message.html !== null && /<(table|img)\b/i.test(message.html)));
  const failed = message.deliveryStatus === "failed";
  // Offered only when the customer writes in another language than the agent reads.
  const foreign = client.ai && message.kind === "inbound" ? foreignLanguage(detail, locale) : null;
  // A reply that reached the customer can become an answer the whole team reuses.
  const reusable = Boolean(client.ai?.saveApprovedAnswer) && message.kind === "outbound" && !failed && message.text.trim().length > 0;

  return (
    <article
      className={cn(
        "rounded-xl border p-4",
        message.kind === "note" && "border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
        message.kind === "outbound" && "border-primary/20 bg-primary/[0.03]",
        message.kind === "inbound" && "bg-card",
        failed && "border-destructive/40"
      )}
    >
      <header className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <AgentAvatar name={avatarName} className={message.kind === "inbound" ? "bg-muted text-foreground/70" : undefined} />
        <bdi className="text-sm font-medium text-foreground">{author}</bdi>
        {message.kind === "note" && <span className="font-medium text-amber-700 dark:text-amber-300">{t("ticket.note")}</span>}
        {message.kind === "inbound" && message.from && message.from.name && <bdi dir="ltr">{message.from.address}</bdi>}
        {message.source === "portal" && <span>{t("ticket.viaPortal")}</span>}
        <time className="ms-auto tabular-nums" dateTime={new Date(message.createdAt).toISOString()}>
          {formatTimestamp(message.createdAt, locale)}
        </time>
      </header>

      {translation.text !== null ? (
        <MessageText text={translation.text} />
      ) : original && message.html ? (
        <EmailFrame html={message.html} showImagesLabel={t("ticket.showImages")} />
      ) : (
        <MessageText text={original && message.fullText ? message.fullText : message.text} />
      )}

      {message.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.attachments.map((file) => (
            <AttachmentChip key={file.id} file={file} locale={locale} getUrl={() => client.attachmentUrl({ id: file.id })} />
          ))}
        </div>
      )}

      {(hasMore || failed || foreign || reusable) && (
        <footer className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          {reusable && (
            <>
              <button type="button" className="text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setSaving(true)}>
                {t("ai.answers.saveReply")}
              </button>
              <ApprovedAnswerDialog open={saving} onOpenChange={setSaving} from={{ ticketId: detail.ticket.id, text: message.text }} />
            </>
          )}
          {foreign && (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              {translation.text !== null && <span>{t("ai.translatedFrom", { language: languageName(foreign, locale) })}</span>}
              <button type="button" className="underline underline-offset-2 hover:text-foreground disabled:opacity-60" disabled={translation.pending} onClick={translation.toggle}>
                {translation.text !== null ? t("ai.showUntranslated") : t("ai.translate")}
              </button>
              {translation.failed && <span className="text-destructive">{t("ai.failed")}</span>}
            </span>
          )}
          {hasMore && translation.text === null && (
            <button type="button" className="text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setOriginal((v) => !v)}>
              {original ? t("ticket.showReply") : t("ticket.showOriginal")}
            </button>
          )}
          {failed && (
            <span className="inline-flex flex-wrap items-center gap-2 text-destructive">
              <AlertCircle className="size-3.5" />
              {t("ticket.notDelivered")}
              {message.deliveryError && <span className="text-muted-foreground">{message.deliveryError}</span>}
              <Button variant="outline" size="sm" className="h-7" disabled={retry.isPending} onClick={() => retry.mutate(undefined)}>
                {t("actions.retry")}
              </Button>
            </span>
          )}
        </footer>
      )}
    </article>
  );
}

function CustomerSidebar({ detail }: { detail: TicketDetail }) {
  const { t, locale, customerPanel, ticketHref } = useSupport();
  const [linking, setLinking] = useState(false);
  const [changing, setChanging] = useState(false);

  return (
    <aside className="space-y-4 lg:sticky lg:top-6">
      {customerPanel?.(detail)}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">{t("ticket.contact")}</h2>
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t("ticket.changeContact")}
          </button>
          <ChangeContactDialog detail={detail} open={changing} onOpenChange={setChanging} />
        </div>
        <p className="mt-2 text-sm font-medium">
          <bdi>{contactLabel(detail.contact)}</bdi>
        </p>
        <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
          {detail.contact.identities.map((identity) => (
            <li key={`${identity.kind}:${identity.value}`} dir="ltr" lang="en" className="truncate text-start">
              {identity.value}
            </li>
          ))}
        </ul>
        {!detail.customer && (
          <div className="mt-3 space-y-2">
            <UnknownSenderBadge />
            <p className="text-sm text-muted-foreground">{t("ticket.unknownSenderHelp")}</p>
            <Button variant="outline" size="sm" onClick={() => setLinking(true)}>
              {t("ticket.linkCustomer")}
            </Button>
            <LinkCustomerDialog detail={detail} open={linking} onOpenChange={setLinking} />
          </div>
        )}
      </section>

      {detail.accountFacts && detail.accountFacts.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-xs font-medium text-muted-foreground">{detail.customer?.name ?? t("ticket.account")}</h2>
          <dl className="mt-2 space-y-1.5 text-sm">
            {detail.accountFacts.map((fact) => (
              <div key={fact.label} className="flex justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
                <dd dir="auto" className="min-w-0 text-end break-words tabular-nums">
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
        </section>
      )}

      {detail.previousTickets.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-xs font-medium text-muted-foreground">{t("ticket.previous")}</h2>
          <ul className="mt-2 space-y-2">
            {detail.previousTickets.map((previous) => (
              <li key={previous.id}>
                <Link href={ticketHref(previous.id)} className="flex items-center justify-between gap-2 text-sm hover:underline">
                  <span dir="auto" className="truncate">
                    {previous.subject || t("inbox.noSubject")}
                  </span>
                  <StatusBadge status={previous.status} label={t(`status.${previous.status}`)} />
                </Link>
                <p className="text-xs text-muted-foreground">{formatWhen(previous.lastMessageAt, locale)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
