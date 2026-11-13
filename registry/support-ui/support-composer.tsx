"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSupport } from "./provider";
import type { Address, FileInfo, TicketDetail } from "./client";
import { contactLabel, formatBytes } from "./format";
import { DraftBar, RefineRow, foreignLanguage, type RefineAction } from "./ai";
import { VoiceButton, VoicePanel, useVoice, useVoiceEngine, type VoiceIntent } from "./voice";

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

  // AI, when the client has it: the suggested reply, rewrites of what's in the box, and Undo.
  const ai = client.ai;
  const suggestion = ai && !blocked ? detail.suggestion ?? null : null;
  const [discarded, setDiscarded] = useState<string | null>(null);
  const draft = suggestion?.kind === "draft" && suggestion.text && suggestion.id !== discarded ? suggestion : null;
  /** The suggestion the text in the box started from. */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const offered = useRef<string | null>(null);
  const applied = Boolean(draft && draftId === draft.id && text.trim());
  const lastMessage = detail.timeline.filter((e) => e.type === "message" && e.message.kind !== "note" && !e.message.auto).at(-1);
  const canSuggest = Boolean(ai && !blocked && !suggestion && lastMessage?.type === "message" && lastMessage.message.kind === "inbound");

  const applyDraft = () => {
    if (!draft) return;
    if (text.trim()) setHistory((h) => [...h, text]);
    setText(draft.text ?? "");
    setDraftId(draft.id);
    setMode("reply");
  };
  // A suggestion fills an empty reply box once. Text the agent already wrote is never replaced.
  useEffect(() => {
    if (!draft || offered.current === draft.id) return;
    offered.current = draft.id;
    if (!text.trim() && mode === "reply") {
      setText(draft.text ?? "");
      setDraftId(draft.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  const discardDraft = () => {
    if (!draft || !ai) return;
    if (applied) {
      setHistory((h) => [...h, text]);
      setText("");
    }
    setDiscarded(draft.id);
    setDraftId(null);
    ai.discardSuggestion({ id: draft.id })
      .catch(() => setDiscarded(null))
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: ["support", "ticket", ticketId] });
        queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
      });
  };

  const runAi = async (action: RefineAction | "suggest") => {
    if (!ai || busy) return;
    setBusy(typeof action === "string" ? action : "custom");
    setError(null);
    try {
      if (action === "suggest") {
        await ai.draft({ ticketId });
        await queryClient.invalidateQueries({ queryKey: ["support", "ticket", ticketId] });
        return;
      }
      const before = text;
      const result =
        action === "writeUp"
          ? await ai.writeUp({ ticketId, notes: before })
          : await ai.refine({ ticketId, text: before, instruction: action, ...(action === "translate" && translateTo ? { language: translateTo } : {}) });
      setHistory((h) => [...h, before]);
      setText(result.text);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("ai.failed"));
    } finally {
      setBusy(null);
    }
  };
  const translateTo = foreignLanguage(detail, locale);
  const undo = () => {
    setText(history.at(-1) ?? "");
    setHistory((h) => h.slice(0, -1));
  };

  // Voice, when there's a way to listen. An empty reply box takes what's said as notes to write up;
  // one with text takes it as a change to make. Either way the agent can have their words inserted as spoken.
  const { engine, shortcut } = useVoiceEngine();
  const caret = useRef<number | null>(null);
  const [plainVoice, setPlainVoice] = useState(false);
  useEffect(() => {
    try {
      setPlainVoice(localStorage.getItem(PLAIN_VOICE) === "1");
    } catch {
      // No storage: the choice lasts for this ticket.
    }
  }, []);
  const smartIntent: VoiceIntent | null = mode !== "reply" ? null : text.trim() ? "instruction" : "writeUp";
  const voiceIntents: VoiceIntent[] = smartIntent ? [smartIntent, "insert"] : ["insert"];
  const voiceIntent: VoiceIntent = smartIntent && !plainVoice ? smartIntent : "insert";
  const chooseVoiceIntent = (intent: VoiceIntent) => {
    setPlainVoice(intent === "insert");
    try {
      localStorage.setItem(PLAIN_VOICE, intent === "insert" ? "1" : "0");
    } catch {
      // See above.
    }
  };
  const voice = useVoice({
    engine: ai ? engine : null,
    async resolve(said) {
      const before = text;
      if (voiceIntent === "insert") {
        const at = Math.min(caret.current ?? before.length, before.length);
        const head = before.slice(0, at);
        const tail = before.slice(at);
        const inserted = `${head}${head && !/\s$/.test(head) ? " " : ""}${said}`;
        return () => {
          if (before.trim()) setHistory((h) => [...h, before]);
          setText(`${inserted}${tail && !/^\s/.test(tail) ? " " : ""}${tail}`);
          caret.current = inserted.length;
        };
      }
      const result =
        voiceIntent === "writeUp"
          ? await ai!.writeUp({ ticketId, notes: said })
          : await ai!.refine({ ticketId, text: before, instruction: { custom: said } });
      return () => {
        setHistory((h) => [...h, before]);
        setText(result.text);
      };
    },
  });
  const voiceOn = voice.phase !== "idle";
  const canSpeak = Boolean(ai && engine) && !(mode === "reply" && blocked);
  const voiceKeys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    voiceKeys.current = (event) => {
      if (event.key === "Escape" && voiceOn) {
        event.preventDefault();
        voice.cancel();
      } else if (event.code === "Space" && event.shiftKey && (event.metaKey || event.ctrlKey) && !event.repeat) {
        event.preventDefault();
        if (voice.phase === "listening") voice.stop();
        else if (busy === null && !send.isPending) voice.start();
      }
    };
  });
  useEffect(() => {
    if (!canSpeak) return;
    const onKey = (event: KeyboardEvent) => voiceKeys.current(event);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canSpeak]);

  const send = useMutation({
    mutationFn: (status: "waiting" | "solved" | null) => {
      const attachmentIds = files.map((f) => f.id);
      return mode === "note"
        ? client.addNote({ ticketId, text, attachmentIds })
        : client.reply({
            ticketId,
            text,
            attachmentIds,
            status: status ?? "waiting",
            ...(ccEdit ? { cc: ccEdit } : {}),
            ...(applied && draft ? { suggestionId: draft.id } : {}),
          });
    },
    onSuccess: () => {
      setText("");
      setFiles([]);
      setError(null);
      setCcEdit(null);
      setDraftId(null);
      setHistory([]);
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
  const canSend = text.trim().length > 0 && !tooLong && uploading === 0 && !send.isPending && busy === null && !voiceOn && (mode === "note" || !blocked);

  return (
    <div className={cn("rounded-xl border bg-card", mode === "note" && "border-amber-300/60 dark:border-amber-500/30")}>
      <div className="flex items-center gap-1 border-b px-2 pt-1" role="tablist">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={voiceOn}
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
          {mode === "reply" && draft && <DraftBar suggestion={draft} applied={applied} onUse={applyDraft} onDiscard={discardDraft} />}
          {mode === "reply" && suggestion?.kind === "cannot_answer" && !text.trim() && (
            <p dir="auto" className="px-4 pt-3 text-xs text-muted-foreground">
              {t("ai.noDraft", { reason: suggestion.reason ?? "" })}
            </p>
          )}
          <Textarea
            value={text}
            dir="auto"
            readOnly={(busy !== null && busy !== "suggest") || voiceOn}
            onChange={(e) => setText(e.target.value)}
            onSelect={(e) => (caret.current = e.currentTarget.selectionStart)}
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
          {canSpeak && <VoicePanel voice={voice} intent={voiceIntent} intents={voiceIntents} onIntent={chooseVoiceIntent} />}
          {ai && mode === "reply" && !voiceOn && (text.trim() || history.length > 0) && (
            <RefineRow
              busy={busy}
              onRun={runAi}
              onUndo={history.length ? undo : null}
              // A suggestion is already in the customer's language until the agent rewrites it.
              translateTo={draft && text === draft.text ? null : translateTo}
              showWriteUp={!applied && history.length === 0}
            />
          )}
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
              {canSpeak && busy === null && <VoiceButton voice={voice} shortcut={shortcut} />}
              {mode === "reply" && canSuggest && !text.trim() && !voiceOn && (
                <Button type="button" variant="ghost" size="sm" onClick={() => runAi("suggest")} disabled={busy !== null}>
                  {busy === "suggest" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {t("ai.suggest")}
                </Button>
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

const PLAIN_VOICE = "tendkit:voice:plain";
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
