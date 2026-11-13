"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupport } from "./provider";
import type { Customer, FileInfo, NewTicketStart, Recipient, StartChannel, SuggestionSource } from "./client";
import { Sources } from "./ai";

/*
 * Writing first: the dialog an agent opens a ticket from, and the button that carries it to
 * wherever a customer or a person is shown. Both render nothing unless the client has `startTicket`.
 */

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const channelName = (channel: StartChannel) => `${channel.kind === "sms" ? "SMS" : channel.kind === "whatsapp" ? "WhatsApp" : channel.kind.charAt(0).toUpperCase() + channel.kind.slice(1)} · ${channel.address}`;

type To = { contactId?: string; name: string | null; address: string };

/**
 * New ticket, or Message next to a customer: opens the dialog, already addressed when `start`
 * names who. Mount it on your own customer and user pages too.
 */
export function NewTicketButton({
  start,
  children,
  variant = "outline",
  size = "sm",
  className,
}: {
  start?: NewTicketStart;
  children?: ReactNode;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm";
  className?: string;
}) {
  const { client, t } = useSupport();
  const [open, setOpen] = useState(false);
  if (!client.startTicket) return null;
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {children ?? t(start ? "ticket.message" : "inbox.newTicket")}
      </Button>
      {open && <NewTicketDialog open onOpenChange={setOpen} start={start} />}
    </>
  );
}

export function NewTicketDialog({ open, onOpenChange, start }: { open: boolean; onOpenChange: (open: boolean) => void; start?: NewTicketStart }) {
  const { client, t, ticketHref } = useSupport();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [customer, setCustomer] = useState<Customer | null>(start?.customer ?? null);
  const [to, setTo] = useState<To | null>(
    start?.contact ? { contactId: start.contact.id, name: start.contact.name, address: start.contact.address } : start?.address ? { name: null, address: start.address } : null
  );
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [cc, setCc] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [intent, setIntent] = useState("");
  const [sources, setSources] = useState<SuggestionSource[]>([]);
  const [files, setFiles] = useState<FileInfo[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const channels = useQuery({ queryKey: ["support", "channels"], queryFn: () => client.listChannels!(), enabled: open && Boolean(client.listChannels), staleTime: 5 * 60_000 });
  const able = channels.data?.filter((c) => !c.startBlockedReason) ?? [];
  const blocked = channels.data?.filter((c) => c.startBlockedReason) ?? [];
  const channel = able.find((c) => c.id === channelId) ?? able.find((c) => c.default) ?? able[0] ?? null;
  // Without `listChannels`, the server's default channel decides: email, with a subject.
  const email = !channel || channel.kind === "email";
  const hasSubject = channel ? channel.capabilities.subject : true;
  const canAttach = Boolean(client.uploadForNewTicket) && (!channel || channel.capabilities.attachments !== false);

  const searching = !to && debounced.length >= 2;
  const customers = useQuery({ queryKey: ["support", "customers", debounced], queryFn: () => client.searchCustomers(debounced), enabled: open && searching && !customer });
  const found = useQuery({ queryKey: ["support", "contacts", "search", debounced], queryFn: () => client.listContacts!({ search: debounced }), enabled: open && searching && !customer && Boolean(client.listContacts) });
  const people = useQuery({ queryKey: ["support", "contacts", "customer", customer?.id], queryFn: () => client.listContacts!({ customerId: customer!.id }), enabled: open && Boolean(customer) && !to && Boolean(client.listContacts) });
  const addressOf = (person: Recipient) => person.identities.find((i) => (email ? i.kind === "email" : i.kind !== "email"))?.value ?? null;
  const typed = query.trim();
  const typedIsAddress = email ? EMAIL.test(typed) : /^\+?[\d\s().-]{7,}$/.test(typed);

  const draft = useMutation({
    mutationFn: () => client.ai!.draftOpening!({ intent, customerId: customer?.id, contactId: to?.contactId, channelId: channel?.id }),
    onSuccess: (result) => {
      if (hasSubject && result.subject) setSubject(result.subject);
      setText(result.text);
      setSources(result.sources);
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => client.uploadForNewTicket!({ file }),
    onSuccess: (file) => setFiles((current) => [...current, file]),
  });
  const copied = (cc ?? "").split(/[,;\s]+/).map((a) => a.trim()).filter(Boolean);
  const send = useMutation({
    mutationFn: () =>
      client.startTicket!({
        ...(channel ? { channelId: channel.id } : {}),
        to: to!.contactId ? { contactId: to!.contactId } : { address: to!.address, ...(to!.name ? { name: to!.name } : {}) },
        ...(customer ? { customerId: customer.id } : {}),
        ...(email && copied.length ? { cc: copied.map((address) => ({ address })) } : {}),
        ...(hasSubject ? { subject: subject.trim() } : {}),
        text: text.trim(),
        ...(files.length ? { attachmentIds: files.map((f) => f.id) } : {}),
      }),
    onSuccess: ({ ticketId }) => {
      void queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["support", "counts"] });
      onOpenChange(false);
      router.push(ticketHref(ticketId));
    },
  });
  const ready = Boolean(to) && text.trim() && (!hasSubject || subject.trim()) && copied.every((a) => EMAIL.test(a)) && !send.isPending && !upload.isPending;

  const choose = (person: Recipient) => {
    const address = addressOf(person);
    if (!address) return;
    setTo({ contactId: person.id, name: person.name, address });
    if (person.customer) setCustomer(person.customer);
    setQuery("");
  };
  const option = "flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-muted/50";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("newTicket.title")}</DialogTitle>
          <DialogDescription>{t("newTicket.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) send.mutate();
          }}
        >
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t("newTicket.to")}</span>
            {(customer || to) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {customer && (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-sm">
                    <bdi className="truncate font-medium">{customer.name}</bdi>
                    {!start?.customer && (
                      <button type="button" aria-label={t("newTicket.change")} className="text-muted-foreground hover:text-foreground" onClick={() => (setCustomer(null), setTo(null))}>
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                )}
                {to && (
                  <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-sm">
                    <bdi className="truncate">{to.name ? `${to.name} · ${to.address}` : to.address}</bdi>
                    <button type="button" aria-label={t("newTicket.change")} className="text-muted-foreground hover:text-foreground" onClick={() => setTo(null)}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                )}
              </div>
            )}
            {!to && (
              <>
                <Input
                  autoFocus
                  value={query}
                  dir="auto"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || !typedIsAddress) return;
                    e.preventDefault();
                    setTo({ name: null, address: typed });
                    setQuery("");
                  }}
                  placeholder={t("newTicket.toPlaceholder")}
                  aria-label={t("newTicket.to")}
                />
                {(typedIsAddress || customer || searching) && (
                  <div className="max-h-52 divide-y overflow-y-auto rounded-md border">
                    {typedIsAddress && (
                      <button type="button" className={option} onClick={() => (setTo({ name: null, address: typed }), setQuery(""))}>
                        <bdi className="truncate">{t("newTicket.writeTo", { address: typed })}</bdi>
                      </button>
                    )}
                    {customer ? (
                      people.isPending && client.listContacts ? (
                        <Loader2 className="mx-auto my-3 size-4 animate-spin text-muted-foreground" />
                      ) : people.data?.some(addressOf) ? (
                        people.data.filter(addressOf).map((person) => (
                          <button key={person.id} type="button" className={option} onClick={() => choose(person)}>
                            <bdi className="truncate font-medium">{person.name ?? addressOf(person)}</bdi>
                            {person.name && <bdi className="shrink-0 text-muted-foreground">{addressOf(person)}</bdi>}
                          </button>
                        ))
                      ) : (
                        !typedIsAddress && <p className="px-3 py-2 text-sm text-muted-foreground">{t("newTicket.noPeople", { name: customer.name })}</p>
                      )
                    ) : (
                      <>
                        {found.data?.filter(addressOf).map((person) => (
                          <button key={person.id} type="button" className={option} onClick={() => choose(person)}>
                            <bdi className="truncate font-medium">{person.name ?? addressOf(person)}</bdi>
                            <bdi className="shrink-0 truncate text-muted-foreground">{person.customer?.name ?? addressOf(person)}</bdi>
                          </button>
                        ))}
                        {customers.data?.map((item) => (
                          <button key={item.id} type="button" className={option} onClick={() => (setCustomer(item), setQuery(""))}>
                            <bdi className="truncate font-medium">{item.name}</bdi>
                            <span className="shrink-0 text-xs text-muted-foreground">{t("newTicket.customers")}</span>
                          </button>
                        ))}
                        {(customers.isFetching || found.isFetching) && <Loader2 className="mx-auto my-3 size-4 animate-spin text-muted-foreground" />}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {(able.length > 1 || blocked.length > 0) && channel && (
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t("newTicket.channel")}</span>
              {able.length > 1 && (
                <Select value={channel.id} onValueChange={(value) => value && (setChannelId(String(value)), setTo(null))}>
                  <SelectTrigger className="w-full" aria-label={t("newTicket.channel")}>
                    <SelectValue>{channelName(channel)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {able.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {channelName(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {blocked.map((item) => (
                <p key={item.id} className="text-xs text-muted-foreground">
                  {t(`newTicket.blocked.${item.startBlockedReason}`, { channel: channelName(item) })}
                </p>
              ))}
            </div>
          )}

          {email &&
            (cc === null ? (
              <button type="button" onClick={() => setCc("")} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                {t("newTicket.addCc")}
              </button>
            ) : (
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t("newTicket.cc")}</span>
                <Input value={cc} dir="ltr" onChange={(e) => setCc(e.target.value)} placeholder={t("newTicket.ccPlaceholder")} aria-invalid={!copied.every((a) => EMAIL.test(a))} />
              </label>
            ))}

          {client.ai?.draftOpening && (
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <label htmlFor="support-new-ticket-intent" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                {t("newTicket.intent")}
              </label>
              <div className="flex gap-2">
                <Input
                  id="support-new-ticket-intent"
                  value={intent}
                  dir="auto"
                  maxLength={2000}
                  onChange={(e) => setIntent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (intent.trim() && !draft.isPending) draft.mutate();
                  }}
                  placeholder={t("newTicket.intentPlaceholder")}
                />
                <Button type="button" variant="outline" disabled={!intent.trim() || draft.isPending} onClick={() => draft.mutate()}>
                  {draft.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("newTicket.draft")}
                </Button>
              </div>
              {draft.error && <p className="text-xs text-destructive">{message(draft.error, t("ai.failed"))}</p>}
            </div>
          )}

          {hasSubject && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">{t("newTicket.subject")}</span>
              <Input value={subject} dir="auto" maxLength={200} onChange={(e) => setSubject(e.target.value)} />
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("newTicket.message")}</span>
            <Textarea
              value={text}
              dir="auto"
              maxLength={channel?.capabilities.maxTextLength ?? 20_000}
              onChange={(e) => {
                setText(e.target.value);
                setSources([]);
              }}
              className="min-h-40"
            />
          </label>
          <Sources sources={sources} />

          {files.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {files.map((file) => (
                <li key={file.id} className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs">
                  <bdi className="truncate">{file.filename}</bdi>
                  <button type="button" aria-label={t("newTicket.remove", { name: file.filename })} className="text-muted-foreground hover:text-foreground" onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}>
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {upload.error && <p className="text-sm text-destructive">{t("errors.upload")}</p>}
          {send.error && <p className="text-sm text-destructive">{message(send.error, t("errors.send"))}</p>}

          <DialogFooter className="items-center gap-2 sm:justify-between">
            {canAttach ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    for (const file of Array.from(e.target.files ?? [])) upload.mutate(file);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="ghost" size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
                  {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                  {t("newTicket.attach")}
                </Button>
              </>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={!ready}>
                {send.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("newTicket.send")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
