"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Loader2, Sparkles, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSupport } from "./provider";
import type { RefineInstruction, Suggestion, TicketDetail, Urgency } from "./client";

/*
 * The AI parts of the screens. Each one renders only when the client has `ai`, so apps without
 * it never see them.
 */

const URGENCIES: Urgency[] = ["urgent", "high", "normal", "low"];

const urgencyStyles: Record<Urgency, string> = {
  urgent: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300",
  high: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300",
  normal: "",
  low: "",
};

/** "Urgent" or "High" on an inbox row. Ordinary tickets carry no mark. */
export function UrgencyMark({ urgency }: { urgency: Urgency | null | undefined }) {
  const { t } = useSupport();
  if (urgency !== "urgent" && urgency !== "high") return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", urgencyStyles[urgency])}>
      {t(`ai.urgency.${urgency}`)}
    </span>
  );
}

/** "es" → "Spanish", in the agent's language. */
export function languageName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const baseLanguage = (code: string) => code.toLowerCase().split("-")[0];

/** The customer's language when it isn't the agent's: what "Translate" works from and to. */
export function foreignLanguage(detail: TicketDetail, locale: string) {
  const language = detail.insight?.language ?? null;
  return language && baseLanguage(language) !== baseLanguage(locale) ? language : null;
}

/** Under the ticket's subject: what the customer needs, with the urgency and topic an agent can correct. */
export function TicketInsightBar({ detail }: { detail: TicketDetail }) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const insight = detail.insight ?? null;
  const ticketId = detail.ticket.id;
  const [open, setOpen] = useState<"urgency" | "topic" | null>(null);
  const settings = useQuery({
    queryKey: ["support", "ai", "settings"],
    queryFn: () => ai!.getSettings(),
    enabled: Boolean(ai && insight),
    staleTime: 5 * 60_000,
  });
  const change = useMutation({
    mutationFn: (input: { topic?: string; urgency?: Urgency }) => ai!.setInsight({ ticketId, ...input }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "ticket", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
    },
  });
  if (!ai || !insight) return null;

  const urgency = insight.urgency ?? "normal";
  const topic = insight.topic ?? "other";
  const topicLabel = (value: string) => (value === "other" ? t("ai.otherTopic") : value);
  const topics = [...new Set([...(settings.data?.topics ?? []), topic, "other"])];
  const chip = "inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs transition-colors hover:bg-muted/60 disabled:opacity-60";

  return (
    <div className="mt-2 space-y-2">
      {insight.summary && (
        <p dir="auto" className="text-sm text-muted-foreground">
          {insight.summary}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu open={open === "urgency"} onOpenChange={(next) => setOpen(next ? "urgency" : null)}>
          <DropdownMenuTrigger
            className={cn(chip, (urgency === "urgent" || urgency === "high") && cn("border-transparent ring-1 ring-inset", urgencyStyles[urgency]))}
            disabled={change.isPending}
            title={insight.urgencyReason ?? undefined}
          >
            <span className="opacity-70">{t("ai.urgencyLabel")}</span>
            <span className="font-medium">{t(`ai.urgency.${urgency}`)}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-auto min-w-36">
            <DropdownMenuRadioGroup
              value={urgency}
              onValueChange={(value) => {
                setOpen(null);
                if (value !== urgency) change.mutate({ urgency: value as Urgency });
              }}
            >
              {URGENCIES.map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {t(`ai.urgency.${value}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu open={open === "topic"} onOpenChange={(next) => setOpen(next ? "topic" : null)}>
          <DropdownMenuTrigger className={chip} disabled={change.isPending}>
            <span className="text-muted-foreground">{t("ai.topicLabel")}</span>
            <span className="font-medium">{topicLabel(topic)}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-auto min-w-36 overflow-y-auto">
            <DropdownMenuRadioGroup
              value={topic}
              onValueChange={(value) => {
                setOpen(null);
                if (value !== topic) change.mutate({ topic: String(value) });
              }}
            >
              {topics.map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {topicLabel(value)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {insight.mood && insight.mood !== "calm" && <span className="text-xs text-muted-foreground">{t(`ai.mood.${insight.mood}`)}</span>}
      </div>
    </div>
  );
}

/** Above the reply box: marks the text as a suggestion, shows what it's based on, and lets the agent drop it. */
export function DraftBar({
  suggestion,
  applied,
  onUse,
  onDiscard,
}: {
  suggestion: Suggestion;
  /** The suggestion is what's in the reply box. Otherwise it waits to be used. */
  applied: boolean;
  onUse: () => void;
  onDiscard: () => void;
}) {
  const { t } = useSupport();
  const link = "text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline";
  return (
    <div className="space-y-1.5 px-4 pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" />
          {t(applied ? "ai.draft" : "ai.draftWaiting")}
        </span>
        <span className="ms-auto flex items-center gap-3">
          {!applied && (
            <button type="button" onClick={onUse} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
              {t("ai.useDraft")}
            </button>
          )}
          <button type="button" onClick={onDiscard} className={link}>
            {t("ai.discard")}
          </button>
        </span>
      </div>
      {applied && <SuggestionSources suggestion={suggestion} />}
    </div>
  );
}

/** What a suggested reply is based on, each with its link when it has one. */
export function SuggestionSources({ suggestion }: { suggestion: Suggestion }) {
  const { t } = useSupport();
  if (!suggestion.sources.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5 text-xs">
      <li className="text-muted-foreground">{t("ai.sources")}</li>
      {suggestion.sources.map((source) => {
        const label = source.type === "guidance" ? t("ai.guidance") : source.title;
        const chip = "inline-flex max-w-56 items-center rounded-md border bg-background px-1.5 py-0.5 text-foreground";
        return (
          <li key={source.id}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer" className={cn(chip, "underline-offset-2 hover:underline")}>
                <bdi className="truncate">{label}</bdi>
              </a>
            ) : (
              <span className={chip} title={source.detail ?? undefined}>
                <bdi className="truncate">{label}</bdi>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type RefineAction = "writeUp" | RefineInstruction;

const actionKey = (action: RefineAction) => (typeof action === "string" ? action : "custom");

/** Under the reply box whenever it holds text: quick rewrites, a free instruction, and Undo. */
export function RefineRow({
  busy,
  onRun,
  onUndo,
  translateTo,
  showWriteUp,
}: {
  /** The action in flight, if any. */
  busy: string | null;
  onRun: (action: RefineAction) => void;
  /** Present after a rewrite. */
  onUndo: (() => void) | null;
  /** The customer's language, when it isn't the agent's. */
  translateTo: string | null;
  /** The text is the agent's own notes, not a suggestion or a rewrite. */
  showWriteUp: boolean;
}) {
  const { t, locale } = useSupport();
  const [instruction, setInstruction] = useState("");
  const actions: { action: RefineAction; label: string }[] = [
    ...(showWriteUp ? [{ action: "writeUp" as const, label: t("ai.writeUp") }] : []),
    { action: "shorter", label: t("ai.shorter") },
    { action: "friendlier", label: t("ai.friendlier") },
    { action: "formal", label: t("ai.formal") },
    ...(translateTo ? [{ action: "translate" as const, label: t("ai.translateTo", { language: languageName(translateTo, locale) }) }] : []),
  ];
  const submit = () => {
    const custom = instruction.trim();
    if (!custom || busy) return;
    onRun({ custom });
    setInstruction("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
      <Sparkles className="ms-1 size-3.5 shrink-0 text-primary" aria-hidden />
      {actions.map(({ action, label }) => (
        <Button key={actionKey(action)} type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={busy !== null} onClick={() => onRun(action)}>
          {busy === actionKey(action) && <Loader2 className="size-3 animate-spin" />}
          {label}
        </Button>
      ))}
      <div className="relative min-w-40 flex-1">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy !== null}
          placeholder={t("ai.instruction")}
          aria-label={t("ai.instruction")}
          dir="auto"
          className="h-7 w-full rounded-md border bg-background ps-2 pe-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
        />
        {(instruction.trim() || busy === "custom") && (
          <button
            type="button"
            onClick={submit}
            disabled={busy !== null}
            aria-label={t("ai.apply")}
            className="absolute end-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded bg-primary text-primary-foreground disabled:opacity-60"
          >
            {busy === "custom" ? <Loader2 className="size-3 animate-spin" /> : <ArrowUp className="size-3" />}
          </button>
        )}
      </div>
      {onUndo && (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy !== null} onClick={onUndo}>
          <Undo2 className="size-3" />
          {t("ai.undo")}
        </Button>
      )}
    </div>
  );
}

/** A customer's message in the agent's language, fetched once on request. */
export function useMessageTranslation(messageId: string) {
  const { client, locale } = useSupport();
  const [shown, setShown] = useState(false);
  const translation = useMutation({ mutationFn: () => client.ai!.translate({ messageId, to: locale }) });
  return {
    text: shown ? translation.data?.text ?? null : null,
    pending: translation.isPending,
    failed: translation.isError,
    toggle() {
      if (shown) return setShown(false);
      setShown(true);
      if (!translation.data) translation.mutate();
    },
  };
}
