"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSupport } from "./provider";
import type { Address, FileInfo, TicketDetail } from "./client";
import { contactLabel, formatBytes } from "./format";

type Mode = "reply" | "note";

export function SupportComposer({ detail }: { detail: TicketDetail }) {
  const { client, t, locale } = useSupport();
  const queryClient = useQueryClient();
  const ticketId = detail.ticket.id;
  const blocked = detail.replyBlockedReason;
  const [mode, setMode] = useState<Mode>(blocked ? "note" : "reply");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const limits = detail.channel?.capabilities;
  const maxLength = mode === "reply" ? limits?.maxTextLength ?? null : null;
  const attachmentsAllowed = mode === "note" || Boolean(limits?.attachments);
  const to = detail.recipients.to;
  const recipient = to ? to.name || to.address : contactLabel(detail.contact);
  const isEmail = detail.channel?.kind === "email";
  // null until the agent changes who's copied; the server's default applies until then.
  const [ccEdit, setCcEdit] = useState<Address[] | null>(null);
  const cc = ccEdit ?? detail.recipients.cc;
  const [ccDraft, setCcDraft] = useState<string | null>(null);

  const addCc = () => {
    const value = (ccDraft ?? "").trim();
    if (!value) return setCcDraft(null);
    if (!EMAIL.test(value)) return setError(t("composer.invalidCc", { address: value }));
    setError(null);
    const known = value.toLowerCase();
    if (!cc.some((a) => a.address.toLowerCase() === known) && known !== to?.address.toLowerCase()) setCcEdit([...cc, { address: value }]);
    setCcDraft(null);
  };

  const send = useMutation({
    mutationFn: (status: "waiting" | "solved" | null) => {
      const attachmentIds = files.map((f) => f.id);
      return mode === "note"
        ? client.addNote({ ticketId, text, attachmentIds })
        : client.reply({ ticketId, text, attachmentIds, status: status ?? "waiting", ...(ccEdit ? { cc: ccEdit } : {}) });
    },
    onSuccess: () => {
      setText("");
      setFiles([]);
      setError(null);
      setCcEdit(null);
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : t("errors.send")),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "ticket", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
      queryClient.invalidateQueries({ queryKey: ["support", "counts"] });
    },
  });

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    for (const file of Array.from(list)) {
      setUploading((n) => n + 1);
      try {
        const saved = await client.upload({ ticketId, file });
        setFiles((current) => [...current, saved]);
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : t("errors.upload"));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const tooLong = maxLength !== null && text.length > maxLength;
  const canSend = text.trim().length > 0 && !tooLong && uploading === 0 && !send.isPending && (mode === "note" || !blocked);

  return (
    <div className={cn("rounded-xl border bg-card", mode === "note" && "border-amber-300/60 dark:border-amber-500/30")}>
      <div className="flex items-center gap-1 border-b px-2 pt-1" role="tablist">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              mode === m
                ? m === "note"
                  ? "border-amber-500 text-amber-700 dark:text-amber-300"
                  : "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t(m === "reply" ? "composer.reply" : "composer.note")}
          </button>
        ))}
      </div>

      {mode === "reply" && blocked ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{t(`composer.blocked.${blocked}`)}</p>
      ) : (
        <>
          {mode === "reply" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3 text-xs text-muted-foreground">
              <span>
                {t("composer.to")} <bdi className="text-foreground">{recipient}</bdi>
              </span>
              {isEmail && (
                <span className="flex flex-wrap items-center gap-1.5">
                  {(cc.length > 0 || ccDraft !== null) && <span>{t("composer.cc")}</span>}
                  {cc.map((a) => (
                    <span key={a.address} className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-foreground">
                      <bdi title={a.address}>{a.name || a.address}</bdi>
                      <button
                        type="button"
                        onClick={() => setCcEdit(cc.filter((c) => c.address !== a.address))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t("composer.removeCc", { name: a.name || a.address })}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {ccDraft !== null ? (
                    <input
                      autoFocus
                      type="email"
                      dir="ltr"
                      value={ccDraft}
                      onChange={(e) => setCcDraft(e.target.value)}
                      onBlur={addCc}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "," || e.key === " ") {
                          e.preventDefault();
                          addCc();
                        } else if (e.key === "Escape") {
                          setCcDraft(null);
                        }
                      }}
                      placeholder={t("composer.ccPlaceholder")}
                      aria-label={t("composer.addCc")}
                      className="h-6 w-48 rounded-md border bg-background px-1.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCcDraft("")}
                      className="inline-flex items-center gap-0.5 hover:text-foreground"
                    >
                      <Plus className="size-3" />
                      {cc.length ? <span className="sr-only">{t("composer.addCc")}</span> : t("composer.cc")}
                    </button>
                  )}
                </span>
              )}
            </div>
          )}
          <Textarea
            value={text}
            dir="auto"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) {
                e.preventDefault();
                send.mutate(null);
              }
            }}
            placeholder={t(mode === "reply" ? "composer.replyPlaceholder" : "composer.notePlaceholder")}
            className="min-h-28 resize-y border-0 bg-transparent px-4 shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label={t(mode === "reply" ? "composer.reply" : "composer.note")}
          />
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-4 pb-2">
              {files.map((file) => (
                <li key={file.id} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs">
                  <bdi className="max-w-48 truncate">{file.filename}</bdi>
                  <span className="text-muted-foreground tabular-nums">{formatBytes(file.size, locale)}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("composer.removeFile", { name: file.filename })}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="px-4 pb-2 text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <div className="flex items-center gap-3">
              {attachmentsAllowed && (
                <>
                  <input ref={fileInput} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                    {t("composer.attach")}
                  </Button>
                </>
              )}
              {maxLength !== null && (
                <span className={cn("text-xs tabular-nums", tooLong ? "text-destructive" : "text-muted-foreground")}>
                  {text.length}/{maxLength}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {mode === "reply" ? (
                <>
                  <Button type="button" variant="outline" size="sm" disabled={!canSend} onClick={() => send.mutate("solved")}>
                    {t("composer.sendAndSolve")}
                  </Button>
                  <Button type="button" size="sm" disabled={!canSend} onClick={() => send.mutate("waiting")}>
                    {send.isPending && <Loader2 className="size-4 animate-spin" />}
                    {t("composer.send")}
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" disabled={!canSend} onClick={() => send.mutate(null)}>
                  {send.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("composer.addNote")}
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
