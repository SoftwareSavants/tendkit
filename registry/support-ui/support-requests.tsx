"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePortal } from "./provider";
import type { PortalTicket, TicketStatus } from "./client";
import { formatTimestamp, formatWhen } from "./format";
import { AttachmentChip, MessageText } from "./parts";
import { SupportAsk } from "./support-ask";

/** A customer's own requests, inside your app. Conversations also continue by email. */
export function SupportRequests({ newRequestOpen, onNewRequestOpenChange }: { newRequestOpen: boolean; onNewRequestOpenChange: (open: boolean) => void }) {
  const { client, t } = usePortal();
  const list = useQuery({ queryKey: ["support-portal", "list"], queryFn: () => client.list(), refetchInterval: 30_000 });

  return (
    <>
      {client.ask && list.data?.ask && (
        <div className="mb-4">
          <SupportAsk />
        </div>
      )}
      {list.error ? (
        <div className="rounded-xl border bg-card px-4 py-12 text-center">
          <p className="text-sm text-destructive">{t("errors.load")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => list.refetch()}>
            {t("actions.retry")}
          </Button>
        </div>
      ) : list.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : list.data.items.length ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {list.data.items.map((item) => (
            <RequestRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <p className="text-sm font-medium">{t("portal.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("portal.emptyBody")}</p>
          <Button className="mt-4" size="sm" onClick={() => onNewRequestOpenChange(true)}>
            {t("portal.newRequest")}
          </Button>
        </div>
      )}
      <NewRequestDialog open={newRequestOpen} onOpenChange={onNewRequestOpenChange} />
    </>
  );
}

/** The customer's view of a status: whose turn it is. */
const portalStatus = (status: TicketStatus) => (status === "waiting" ? "awaitingYou" : status === "solved" ? "solved" : "open");

const portalStatusStyles = {
  open: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300",
  awaitingYou: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  solved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
};

function PortalStatus({ status }: { status: TicketStatus }) {
  const { t } = usePortal();
  const key = portalStatus(status);
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", portalStatusStyles[key])}>
      {t(`portal.status.${key}`)}
    </span>
  );
}

function RequestRow({ item }: { item: PortalTicket }) {
  const { t, locale, requestHref } = usePortal();
  return (
    <li>
      <Link href={requestHref(item.id)} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/50">
        <span className={cn("size-2 shrink-0 rounded-full", item.unread ? "bg-primary" : "bg-transparent")} aria-label={item.unread ? t("portal.newReply") : undefined} />
        <div className="min-w-0 flex-1">
          <p dir="auto" className={cn("truncate text-sm", item.unread ? "font-semibold" : "font-medium")}>
            {item.subject || t("inbox.noSubject")}
          </p>
          {item.preview && (
            <p dir="auto" className="truncate text-sm text-muted-foreground">
              {item.previewKind === "outbound" && item.previewAuthor && <bdi className="text-foreground/70">{item.previewAuthor}: </bdi>}
              {item.preview}
            </p>
          )}
        </div>
        <PortalStatus status={item.status} />
        <span className="w-14 shrink-0 text-end text-xs text-muted-foreground tabular-nums">{formatWhen(item.lastMessageAt, locale)}</span>
      </Link>
    </li>
  );
}

function NewRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { client, t, requestHref } = usePortal();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const create = useMutation({
    mutationFn: () => client.create({ subject, text }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["support-portal"] });
      onOpenChange(false);
      setSubject("");
      setText("");
      router.push(requestHref(id));
    },
  });
  const ready = subject.trim() && text.trim() && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("portal.newRequest")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) create.mutate();
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("portal.subject")}</span>
            <Input value={subject} dir="auto" maxLength={200} onChange={(e) => setSubject(e.target.value)} autoFocus />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("portal.message")}</span>
            <Textarea value={text} dir="auto" maxLength={10_000} onChange={(e) => setText(e.target.value)} className="min-h-36" />
          </label>
          {create.error && <p className="text-sm text-destructive">{t("errors.send")}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={!ready}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("portal.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One request: the conversation and a reply box. */
export function SupportRequest({ id }: { id: string }) {
  const { client, t, locale, listHref } = usePortal();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const request = useQuery({ queryKey: ["support-portal", "request", id], queryFn: () => client.get(id), refetchInterval: 20_000 });
  const reply = useMutation({
    mutationFn: () => client.reply({ ticketId: id, text }),
    onSuccess: () => setText(""),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support-portal"] }),
  });

  if (request.error) {
    return <p className="rounded-xl border bg-card px-4 py-12 text-center text-sm text-muted-foreground">{t("portal.notFound")}</p>;
  }
  if (!request.data) return <Skeleton className="h-96" />;
  const { ticket, messages } = request.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href={listHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("portal.back")}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 dir="auto" className="text-2xl font-semibold tracking-tight break-words">
            {ticket.subject || t("inbox.noSubject")}
          </h1>
          <PortalStatus status={ticket.status} />
        </div>
      </div>

      <ol className="space-y-3">
        {messages.map((message) => (
          <li key={message.id}>
            <article className={cn("rounded-xl border p-4", message.kind === "outbound" ? "border-primary/20 bg-primary/[0.03]" : "bg-card")}>
              <header className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <bdi className="text-sm font-medium text-foreground">
                  {message.kind === "inbound" ? message.author ?? t("portal.you") : message.author ?? t("portal.team")}
                </bdi>
                <time className="ms-auto tabular-nums">{formatTimestamp(message.createdAt, locale)}</time>
              </header>
              <MessageText text={message.text} />
              {message.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.attachments.map((file) => (
                    <AttachmentChip key={file.id} file={file} locale={locale} getUrl={() => client.attachmentUrl({ id: file.id })} />
                  ))}
                </div>
              )}
            </article>
          </li>
        ))}
      </ol>

      <form
        className="rounded-xl border bg-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !reply.isPending) reply.mutate();
        }}
      >
        <Textarea
          value={text}
          dir="auto"
          onChange={(e) => setText(e.target.value)}
          placeholder={t("portal.replyPlaceholder")}
          aria-label={t("portal.replyPlaceholder")}
          className="min-h-28 resize-y border-0 bg-transparent px-4 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <p className="text-xs text-muted-foreground">{reply.error ? <span className="text-destructive">{t("errors.send")}</span> : t("portal.emailNote")}</p>
          <Button type="submit" size="sm" disabled={!text.trim() || reply.isPending}>
            {reply.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("portal.send")}
          </Button>
        </div>
      </form>
    </div>
  );
}
