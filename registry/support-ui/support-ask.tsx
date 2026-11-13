"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePortal } from "./provider";
import type { AskResult, SuggestionSource } from "./client";
import { MessageText } from "./parts";

type Turn = { question: string; result: AskResult };

/**
 * The portal's Ask box: a signed-in customer asks, and gets an answer from your knowledge and
 * their own account, with what it is based on. When there is no reliable answer, or they want a
 * person, the same box sends the conversation to your team as a request. `SupportRequests`
 * mounts it when the client has `ask` and your team switched instant answers on.
 */
export function SupportAsk() {
  const { client, t, requestHref } = usePortal();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [rated, setRated] = useState<boolean | null>(null);
  // The customer's message to the team, once they are handing off. Null while they aren't.
  const [handoff, setHandoff] = useState<string | null>(null);
  const sessionId = [...turns].reverse().find((turn) => turn.result.sessionId)?.result.sessionId ?? null;
  const latest = turns.at(-1);

  const ask = useMutation({
    mutationFn: (asked: string) => client.ask!({ question: asked, sessionId }),
    onSuccess: (result, asked) => {
      setTurns((current) => [...current, { question: asked, result }]);
      setRated(null);
      setHandoff(result.kind === "handoff" ? asked : null);
      setQuestion("");
    },
  });
  const rate = useMutation({ mutationFn: (helpful: boolean) => client.rateAnswer!({ sessionId: sessionId!, helpful }) });
  const escalate = useMutation({
    mutationFn: () => client.escalate!({ sessionId: sessionId!, text: handoff?.trim() || undefined }),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["support-portal"] });
      router.push(requestHref(id));
    },
  });
  if (!client.ask) return null;

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      {turns.length > 0 && (
        <ol className="space-y-4">
          {turns.map((turn, index) => (
            <li key={index} className="space-y-1.5">
              <p dir="auto" className="text-sm font-medium">
                {turn.question}
              </p>
              {turn.result.kind === "answer" ? (
                <div className="space-y-2">
                  <MessageText text={turn.result.text} />
                  <AnswerSources sources={turn.result.sources} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t(`portal.ask.handoff.${turn.result.reason}`)}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {latest?.result.kind === "answer" && handoff === null && sessionId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 text-sm text-muted-foreground">
          {rated === true ? (
            <span>{t("portal.ask.thanks")}</span>
          ) : (
            <>
              {client.rateAnswer && (
                <span className="inline-flex items-center gap-1.5">
                  {t("portal.ask.helpful")}
                  {([true, false] as const).map((helpful) => (
                    <button
                      key={String(helpful)}
                      type="button"
                      aria-label={t(helpful ? "portal.ask.yes" : "portal.ask.no")}
                      aria-pressed={rated === helpful}
                      onClick={() => {
                        setRated(helpful);
                        rate.mutate(helpful);
                      }}
                      className={cn("rounded-md border p-1.5 transition-colors hover:text-foreground", rated === helpful && "border-primary text-primary")}
                    >
                      {helpful ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
                    </button>
                  ))}
                </span>
              )}
              {client.escalate && (
                <button type="button" onClick={() => setHandoff(latest.question)} className="ms-auto underline underline-offset-2 hover:text-foreground">
                  {t("portal.ask.person")}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {handoff !== null && client.escalate && sessionId ? (
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (handoff.trim() && !escalate.isPending) escalate.mutate();
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("portal.ask.handoffLabel")}</span>
            <Textarea value={handoff} dir="auto" maxLength={10_000} onChange={(e) => setHandoff(e.target.value)} className="min-h-24" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{escalate.error ? <span className="text-destructive">{t("errors.send")}</span> : t("portal.ask.handoffNote")}</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setHandoff(null)}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={!handoff.trim() || escalate.isPending}>
                {escalate.isPending && <Loader2 className="size-4 animate-spin" />}
                {t("portal.ask.send")}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim() && !ask.isPending) ask.mutate(question.trim());
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Sparkles className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-primary" aria-hidden />
            <Input value={question} dir="auto" maxLength={2000} onChange={(e) => setQuestion(e.target.value)} placeholder={t("portal.ask.placeholder")} aria-label={t("portal.ask.label")} className="ps-8" />
          </div>
          <Button type="submit" disabled={!question.trim() || ask.isPending}>
            {ask.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("portal.ask.submit")}
          </Button>
        </form>
      )}
      {ask.isPending && <p className="text-sm text-muted-foreground">{t("portal.ask.thinking")}</p>}
      {ask.error && <p className="text-sm text-destructive">{t("portal.ask.failed")}</p>}
    </section>
  );
}

/** What an answer stands on: an article links to itself, an account fact says it is the customer's own. */
function AnswerSources({ sources }: { sources: SuggestionSource[] }) {
  const { t } = usePortal();
  const shown = sources.filter((source) => source.type !== "guidance");
  if (!shown.length) return null;
  const chip = "inline-flex max-w-64 items-center rounded-md border bg-background px-1.5 py-0.5 text-foreground";
  return (
    <ul className="flex flex-wrap items-center gap-1.5 text-xs">
      <li className="text-muted-foreground">{t("portal.ask.sources")}</li>
      {shown.map((source) => {
        const label = source.type === "fact" ? t("portal.ask.account", { label: source.title }) : source.title;
        return (
          <li key={source.id}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer" className={cn(chip, "underline-offset-2 hover:underline")}>
                <bdi className="truncate">{label}</bdi>
              </a>
            ) : (
              <span className={chip}>
                <bdi className="truncate">{label}</bdi>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
