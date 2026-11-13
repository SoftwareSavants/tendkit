"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupport } from "./provider";
import type { ApprovedAnswer } from "./client";
import { markdownToText } from "./format";
import { languageName } from "./ai";

/*
 * Memory: what the team teaches AI while answering. The dialog that saves an approved answer,
 * the one that drafts an article, and the list an agent picks an answer from in the reply box.
 * Each part appears only when the client has the method behind it.
 */

const base = (code: string) => code.toLowerCase().split("-")[0]!;
/** The languages an answer can be kept to. One that isn't listed still shows when an answer already has it. */
const LANGUAGES = ["ar", "cs", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "id", "it", "ja", "ko", "nb", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "zh"];

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/**
 * Saves an approved answer: from a reply (its customer details are taken out first, for the agent
 * to review), for a gap, from an article, or an existing one to change.
 */
export function ApprovedAnswerDialog({
  open,
  onOpenChange,
  from,
  answer,
  gap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A sent reply or a draft, generalised when the dialog opens. */
  from?: { ticketId: string; text: string };
  /** The answer to change. */
  answer?: ApprovedAnswer;
  /** The gap this answer resolves. Its theme starts as the title. */
  gap?: { id: string; theme: string };
}) {
  const { client, t, locale } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  /** Null: for customers writing in any language. */
  const [language, setLanguage] = useState<string | null>(null);

  const generalise = useMutation({
    mutationFn: (input: { ticketId: string; text: string }) => ai!.generaliseAnswer!(input),
    onSuccess: (result) => {
      setTitle(result.title);
      setText(result.text);
      // An answer in a language the team doesn't work in is most likely for the customers who write in it.
      setLanguage(result.language && base(result.language) !== base(locale) ? base(result.language) : null);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      ai!.saveApprovedAnswer!({
        ...(answer ? { id: answer.id } : {}),
        title: title.trim(),
        text: text.trim(),
        language,
        ...(from ? { ticketId: from.ticketId } : {}),
        ...(gap ? { gapId: gap.id } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "ai", "answers"] });
      queryClient.invalidateQueries({ queryKey: ["support", "ai", "gaps"] });
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    save.reset();
    generalise.reset();
    setTitle(answer?.title ?? gap?.theme ?? "");
    setText(answer?.text ?? from?.text ?? "");
    setLanguage(answer?.language ?? null);
    if (from && ai?.generaliseAnswer) generalise.mutate(from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!ai?.saveApprovedAnswer) return null;
  const preparing = generalise.isPending;
  const languages = [...new Set([...LANGUAGES, ...(language ? [language] : [])])]
    .map((code) => ({ code, name: languageName(code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(answer ? "ai.answers.editTitle" : from ? "ai.answers.saveTitle" : "ai.answers.newTitle")}</DialogTitle>
          <DialogDescription>{t(from ? "ai.answers.fromReplyDescription" : "ai.answers.description")}</DialogDescription>
        </DialogHeader>
        {preparing ? (
          <div className="grid gap-3" aria-busy>
            <Skeleton className="h-9" />
            <Skeleton className="h-40" />
            <p className="text-sm text-muted-foreground">{t("ai.answers.preparing")}</p>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim() && text.trim()) save.mutate();
            }}
          >
            {generalise.isError && <p className="text-sm text-amber-700 dark:text-amber-300">{t("ai.answers.notGeneralised")}</p>}
            <div className="grid gap-1.5">
              <label htmlFor="support-answer-title" className="text-sm font-medium">
                {t("ai.answers.title")}
              </label>
              <Input id="support-answer-title" dir="auto" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("ai.answers.titlePlaceholder")} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="support-answer-text" className="text-sm font-medium">
                {t("ai.answers.text")}
              </label>
              <Textarea id="support-answer-text" dir="auto" value={text} onChange={(e) => setText(e.target.value)} className="max-h-[45vh] min-h-40" />
              <p className="text-xs text-muted-foreground">{t("ai.answers.placeholders", { name: "{name}", company: "{company}", agent: "{agent}" })}</p>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="support-answer-language" className="text-sm font-medium">
                {t("ai.answers.language")}
              </label>
              {/* A native select: the same in Radix and Base UI projects, and at home on a phone. */}
              <select
                id="support-answer-language"
                value={language ?? ""}
                onChange={(e) => setLanguage(e.target.value || null)}
                className="h-9 max-w-56 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">{t("ai.answers.anyLanguage")}</option>
                {languages.map(({ code, name }) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            {save.error && <p className="text-sm text-destructive">{message(save.error, t("errors.send"))}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={!title.trim() || !text.trim() || save.isPending}>
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                {t(answer ? "ai.settings.save" : "ai.answers.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Drafts a help article from how agents answered: a gap's tickets, or the tickets given. The team copies it to its docs or saves it as an approved answer. */
export function ArticleDialog({
  open,
  onOpenChange,
  from,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: { gapId: string } | { ticketIds: string[] };
}) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [copied, setCopied] = useState(false);

  const draft = useMutation({
    mutationFn: () => ai!.draftArticle!(from),
    onSuccess: (article) => {
      setTitle(article.title);
      setMarkdown(article.markdown);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      ai!.saveApprovedAnswer!({ title: title.trim(), text: markdownToText(markdown), language: null, ...("gapId" in from ? { gapId: from.gapId } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "ai", "answers"] });
      queryClient.invalidateQueries({ queryKey: ["support", "ai", "gaps"] });
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    save.reset();
    setCopied(false);
    draft.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!ai?.draftArticle) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`# ${title.trim()}\n\n${markdown.trim()}\n`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access: the text is selectable in the box.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("ai.article.title")}</DialogTitle>
          <DialogDescription>{t("ai.article.description")}</DialogDescription>
        </DialogHeader>
        {draft.isPending ? (
          <div className="grid gap-3" aria-busy>
            <Skeleton className="h-9" />
            <Skeleton className="h-56" />
            <p className="text-sm text-muted-foreground">{t("ai.article.writing")}</p>
          </div>
        ) : draft.isError ? (
          <>
            <p className="text-sm text-destructive">{message(draft.error, t("ai.failed"))}</p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("actions.cancel")}
              </Button>
              <Button type="button" onClick={() => draft.mutate()}>
                {t("actions.retry")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="grid gap-4">
            <Input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("ai.article.heading")} />
            <Textarea dir="auto" value={markdown} onChange={(e) => setMarkdown(e.target.value)} aria-label={t("ai.article.body")} className="max-h-[50vh] min-h-56 font-mono text-xs" />
            {save.error && <p className="text-sm text-destructive">{message(save.error, t("errors.send"))}</p>}
            <DialogFooter>
              {ai.saveApprovedAnswer && (
                <Button type="button" variant="outline" disabled={!title.trim() || !markdown.trim() || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending && <Loader2 className="size-4 animate-spin" />}
                  {t("ai.answers.saveReply")}
                </Button>
              )}
              <Button type="button" disabled={!markdown.trim()} onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t(copied ? "ai.article.copied" : "ai.article.copy")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The approved answers that fit what an agent typed after "/", best first. */
export function matchAnswers(answers: ApprovedAnswer[], query: string, language: string | null) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return answers
    .filter((answer) => !answer.language || !language || base(answer.language) === base(language))
    .map((answer) => {
      const title = answer.title.toLowerCase();
      const body = answer.text.toLowerCase();
      if (!words.every((word) => title.includes(word) || body.includes(word))) return null;
      // A match in the title counts for more, and an answer written for this language comes first.
      return { answer, score: words.filter((word) => title.includes(word)).length * 2 + (answer.language ? 1 : 0) };
    })
    .filter((match): match is { answer: ApprovedAnswer; score: number } => match !== null)
    .sort((a, b) => b.score - a.score || a.answer.title.localeCompare(b.answer.title))
    .map((match) => match.answer);
}

export const answerOptionId = (id: string) => `support-answer-${id}`;

/** The list above the reply box while an agent types "/". The reply box keeps the focus and the keys. */
export function AnswerPicker({
  answers,
  active,
  onActive,
  onChoose,
}: {
  answers: ApprovedAnswer[];
  /** The highlighted answer's index. */
  active: number;
  onActive: (index: number) => void;
  onChoose: (answer: ApprovedAnswer) => void;
}) {
  const { t } = useSupport();
  useEffect(() => {
    const id = answers[active]?.id;
    if (id) document.getElementById(answerOptionId(id))?.scrollIntoView({ block: "nearest" });
  }, [active, answers]);
  return (
    <div className="absolute inset-x-3 bottom-full z-20 mb-1 max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
      {answers.length ? (
        <ul role="listbox" id="support-answers" aria-label={t("ai.answers.heading")} className="max-h-64 overflow-y-auto p-1">
          {answers.map((answer, index) => (
            <li
              key={answer.id}
              id={answerOptionId(answer.id)}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => onActive(index)}
              // The reply box must not lose focus to the click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChoose(answer)}
              className={cn("cursor-pointer rounded-md px-2.5 py-1.5", index === active && "bg-accent text-accent-foreground")}
            >
              <p dir="auto" className="truncate text-sm font-medium">
                {answer.title}
              </p>
              <p dir="auto" className="truncate text-xs text-muted-foreground">
                {answer.text.replace(/\s+/g, " ")}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-2.5 text-sm text-muted-foreground">{t("ai.answers.noMatch")}</p>
      )}
    </div>
  );
}
