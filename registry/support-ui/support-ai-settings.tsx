"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSupport } from "./provider";
import type { ActionSetting, ApprovedAnswer, Gap, GuidanceSuggestion } from "./client";
import { formatWhen } from "./format";
import { languageName } from "./ai";
import { ApprovedAnswerDialog, ArticleDialog } from "./memory";
import { AutopilotSettings } from "./autopilot";

type Form = { guidance: string; topics: string[]; draftOnArrival: boolean };

/**
 * Where a team tells AI how they answer: guidance, topics, whether to suggest replies, and what it
 * knows. With memory, also what it learned from them: rules their edits suggest, the answers they
 * approved, and the questions that went unanswered. With Autopilot, which topics it answers alone.
 */
export function SupportAiSettings() {
  const { client, t, locale } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const settings = useQuery({ queryKey: ["support", "ai", "settings"], queryFn: () => ai!.getSettings(), enabled: Boolean(ai) });
  const [form, setForm] = useState<Form | null>(null);
  const [topic, setTopic] = useState("");

  const saved = settings.data;
  useEffect(() => {
    if (saved) setForm((current) => current ?? { guidance: saved.guidance, topics: saved.topics, draftOnArrival: saved.draftOnArrival });
  }, [saved]);

  const save = useMutation({
    mutationFn: (input: Form) => ai!.updateSettings(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["support", "ai", "settings"] }),
  });
  const sync = useMutation({
    mutationFn: () => ai!.syncKnowledge(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support", "ai", "settings"] }),
  });

  if (!ai) return null;
  if (settings.error) {
    return (
      <div className="rounded-xl border bg-card px-4 py-12 text-center">
        <p className="text-sm text-destructive">{t("errors.load")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => settings.refetch()}>
          {t("actions.retry")}
        </Button>
      </div>
    );
  }
  if (!saved || !form) return <Skeleton className="h-96 max-w-2xl" />;

  const dirty =
    form.guidance.trim() !== saved.guidance.trim() || form.draftOnArrival !== saved.draftOnArrival || form.topics.join("\n") !== saved.topics.join("\n");
  const change = (patch: Partial<Form>) => {
    save.reset();
    setForm({ ...form, ...patch });
  };
  const addTopic = () => {
    const value = topic.trim().replace(/\s+/g, " ");
    if (value && !form.topics.some((existing) => existing.toLowerCase() === value.toLowerCase())) change({ topics: [...form.topics, value] });
    setTopic("");
  };

  return (
    <div className="max-w-2xl space-y-6">
      <section className="space-y-2">
        <label htmlFor="support-ai-guidance" className="text-sm font-medium">
          {t("ai.settings.guidance")}
        </label>
        <p className="text-sm text-muted-foreground">{t("ai.settings.guidanceHelp")}</p>
        <Textarea
          id="support-ai-guidance"
          dir="auto"
          value={form.guidance}
          onChange={(e) => change({ guidance: e.target.value })}
          placeholder={t("ai.settings.guidancePlaceholder")}
          className="min-h-40"
        />
        <GuidanceSuggestions
          onAccepted={(rule) => {
            save.reset();
            // The server added the rule to the saved guidance; the form follows, keeping what's being typed.
            setForm((current) => current && { ...current, guidance: current.guidance.trim() ? `${current.guidance.trim()}\n${rule}` : rule });
            queryClient.invalidateQueries({ queryKey: ["support", "ai", "settings"] });
          }}
        />
      </section>

      <section className="space-y-2">
        <label htmlFor="support-ai-topic" className="text-sm font-medium">
          {t("ai.settings.topics")}
        </label>
        <p className="text-sm text-muted-foreground">{t("ai.settings.topicsHelp")}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {form.topics.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm">
              <bdi>{name}</bdi>
              <button
                type="button"
                onClick={() => change({ topics: form.topics.filter((existing) => existing !== name) })}
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("ai.settings.removeTopic", { name })}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <Input
            id="support-ai-topic"
            value={topic}
            maxLength={40}
            onChange={(e) => setTopic(e.target.value)}
            onBlur={addTopic}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTopic();
              }
            }}
            placeholder={t("ai.settings.addTopic")}
            className="h-8 w-40"
          />
        </div>
      </section>

      <section className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <label htmlFor="support-ai-arrival" className="text-sm font-medium">
            {t("ai.settings.draftOnArrival")}
          </label>
          <p className="text-sm text-muted-foreground">{t("ai.settings.draftOnArrivalHelp")}</p>
        </div>
        <Switch id="support-ai-arrival" checked={form.draftOnArrival} onCheckedChange={(checked) => change({ draftOnArrival: Boolean(checked) })} />
      </section>

      <div className="flex items-center gap-3">
        <Button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate({ ...form, guidance: form.guidance.trim() })}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          {t("ai.settings.save")}
        </Button>
        {save.isSuccess && !dirty && (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" />
            {t("ai.settings.saved")}
          </span>
        )}
        {save.error && <span className="text-sm text-destructive">{save.error instanceof Error && save.error.message ? save.error.message : t("errors.send")}</span>}
      </div>

      <section className="space-y-2 border-t pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">{t("ai.settings.knowledge")}</h2>
            <p className="text-sm text-muted-foreground">{t("ai.settings.knowledgeHelp")}</p>
          </div>
          {saved.sources.length > 0 && (
            <Button type="button" variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t("ai.settings.sync")}
            </Button>
          )}
        </div>
        {saved.sources.length ? (
          <ul className="divide-y rounded-xl border bg-card">
            {saved.sources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <bdi className="font-medium">{source.id}</bdi>
                <span className="text-muted-foreground tabular-nums">
                  {t("ai.settings.articles", { count: source.articles })}
                  {" · "}
                  {source.syncedAt ? t("ai.settings.synced", { when: formatWhen(source.syncedAt, locale) }) : t("ai.settings.neverSynced")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("ai.settings.noSources")}</p>
        )}
        {sync.error && <p className="text-sm text-destructive">{t("ai.failed")}</p>}
      </section>

      <AutopilotSettings />
      <Actions actions={saved.actions ?? []} />
      <ApprovedAnswers />
      <Gaps />
    </div>
  );
}

/**
 * What AI can do in your product, as declared in code. A lookup can be kept from running on its
 * own; whether an action needs approval is not a setting.
 */
function Actions({ actions }: { actions: ActionSetting[] }) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const toggle = useMutation({
    mutationFn: (input: { name: string; enabled: boolean }) => ai!.setActionEnabled!(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support", "ai", "settings"] }),
  });
  if (!actions.length) return null;

  return (
    <section className="space-y-2 border-t pt-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{t("ai.actions.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("ai.actions.help")}</p>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {actions.map((action) => {
          const lookup = action.approval === "never";
          // While the change is on its way, the switch shows where it's going.
          const enabled = toggle.isPending && toggle.variables?.name === action.name ? toggle.variables.enabled : action.enabled;
          return (
            <li key={action.name} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                {lookup && ai?.setActionEnabled ? (
                  <label htmlFor={`support-action-${action.name}`} className="text-sm font-medium">
                    {action.title}
                  </label>
                ) : (
                  <p className="text-sm font-medium">{action.title}</p>
                )}
                <p className="text-sm text-muted-foreground">{t(!lookup ? "ai.actions.needsApproval" : enabled ? "ai.actions.runsAlone" : "ai.actions.runsByHand")}</p>
              </div>
              {lookup && ai?.setActionEnabled && (
                <Switch
                  id={`support-action-${action.name}`}
                  checked={enabled}
                  disabled={toggle.isPending}
                  onCheckedChange={(checked) => toggle.mutate({ name: action.name, enabled: Boolean(checked) })}
                />
              )}
            </li>
          );
        })}
      </ul>
      {toggle.error && <p className="text-sm text-destructive">{toggle.error instanceof Error && toggle.error.message ? toggle.error.message : t("ai.failed")}</p>}
    </section>
  );
}

const ticketLink = "text-foreground underline-offset-2 hover:underline tabular-nums";

/** Rules the team's own edits suggest, under the guidance they would join. Nothing is added until someone accepts. */
function GuidanceSuggestions({ onAccepted }: { onAccepted: (rule: string) => void }) {
  const { client, t, ticketHref } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const suggestions = useQuery({
    queryKey: ["support", "ai", "guidance-suggestions"],
    queryFn: () => ai!.listGuidanceSuggestions!(),
    enabled: Boolean(ai?.listGuidanceSuggestions && ai.decideGuidanceSuggestion),
  });
  const [rules, setRules] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (input: { id: string; accept: boolean; rule?: string }) => ai!.decideGuidanceSuggestion!(input),
    onSuccess: (_, input) => {
      if (input.accept && input.rule) onAccepted(input.rule);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support", "ai", "guidance-suggestions"] }),
  });
  if (!suggestions.data?.length) return null;

  return (
    <ul className="space-y-2 pt-1">
      {suggestions.data.map((suggestion: GuidanceSuggestion) => {
        const rule = rules[suggestion.id] ?? suggestion.rule;
        const busy = decide.isPending && decide.variables?.id === suggestion.id;
        return (
          <li key={suggestion.id} className="space-y-2 rounded-xl border bg-card p-3">
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              {t("ai.guidanceSuggestions.label")}
            </p>
            <Textarea
              dir="auto"
              value={rule}
              onChange={(e) => setRules({ ...rules, [suggestion.id]: e.target.value })}
              aria-label={t("ai.guidanceSuggestions.rule")}
              className="min-h-0"
              rows={2}
            />
            <p dir="auto" className="text-sm text-muted-foreground">
              {suggestion.reason}
              {suggestion.tickets.length > 0 && (
                <>
                  {" "}
                  {t("ai.guidanceSuggestions.seenIn")}{" "}
                  {suggestion.tickets.map((ticket, index) => (
                    <span key={ticket.id}>
                      {index > 0 && ", "}
                      <Link href={ticketHref(ticket.id)} className={ticketLink}>
                        #{ticket.number}
                      </Link>
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" disabled={!rule.trim() || decide.isPending} onClick={() => decide.mutate({ id: suggestion.id, accept: true, rule: rule.trim() })}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {t("ai.guidanceSuggestions.accept")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: suggestion.id, accept: false })}>
                {t("ai.guidanceSuggestions.dismiss")}
              </Button>
              {decide.isError && decide.variables?.id === suggestion.id && (
                <span className="text-sm text-destructive">{decide.error instanceof Error && decide.error.message ? decide.error.message : t("ai.failed")}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The answers the team approved: listed, changed and removed here; saved from replies on the ticket. */
function ApprovedAnswers() {
  const { client, t, locale } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const enabled = Boolean(ai?.listApprovedAnswers && ai.saveApprovedAnswer);
  const answers = useQuery({ queryKey: ["support", "ai", "answers"], queryFn: () => ai!.listApprovedAnswers!(), enabled });
  const [editing, setEditing] = useState<ApprovedAnswer | "new" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => ai!.deleteApprovedAnswer!({ id }),
    onSettled: () => {
      setRemoving(null);
      queryClient.invalidateQueries({ queryKey: ["support", "ai", "answers"] });
    },
  });
  if (!enabled) return null;

  return (
    <section className="space-y-2 border-t pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">{t("ai.answers.heading")}</h2>
          <p className="text-sm text-muted-foreground">{t("ai.answers.help")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          {t("ai.answers.new")}
        </Button>
      </div>
      {answers.data?.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {answers.data.map((answer) => (
            <li key={answer.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <bdi className="truncate">{answer.title}</bdi>
                  {answer.language && (
                    <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                      {t("ai.answers.languageOnly", { language: languageName(answer.language, locale) })}
                    </span>
                  )}
                </p>
                <p dir="auto" className="truncate text-sm text-muted-foreground">
                  {answer.text.replace(/\s+/g, " ")}
                </p>
              </div>
              {removing === answer.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Button type="button" size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(answer.id)}>
                    {remove.isPending && <Loader2 className="size-4 animate-spin" />}
                    {t("ai.answers.confirmDelete")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                    {t("actions.cancel")}
                  </Button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center">
                  <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setEditing(answer)} aria-label={t("ai.answers.edit", { title: answer.title })}>
                    <Pencil className="size-4" />
                  </Button>
                  {ai?.deleteApprovedAnswer && (
                    <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setRemoving(answer.id)} aria-label={t("ai.answers.delete", { title: answer.title })}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : answers.data ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("ai.answers.empty")}</p>
      ) : (
        <Skeleton className="h-16" />
      )}
      <ApprovedAnswerDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} answer={editing && editing !== "new" ? editing : undefined} />
    </section>
  );
}

/** What the knowledge is missing: each gap is closed by writing its answer, drafting an article from the tickets, or dismissing it. */
function Gaps() {
  const { client, t, locale, ticketHref } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai;
  const gaps = useQuery({ queryKey: ["support", "ai", "gaps"], queryFn: () => ai!.listGaps!(), enabled: Boolean(ai?.listGaps) });
  const [writing, setWriting] = useState<Gap | null>(null);
  const [drafting, setDrafting] = useState<Gap | null>(null);
  const dismiss = useMutation({
    mutationFn: (id: string) => ai!.dismissGap!({ id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support", "ai", "gaps"] }),
  });
  if (!ai?.listGaps) return null;

  return (
    <section id="support-gaps" className="scroll-mt-6 space-y-2 border-t pt-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{t("ai.gaps.heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("ai.gaps.help")}</p>
      </div>
      {gaps.data?.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {gaps.data.map((gap) => (
            <li key={gap.id} className="space-y-2 px-4 py-3">
              <div>
                <p dir="auto" className="text-sm font-medium">
                  {gap.theme}
                </p>
                <p className="text-sm text-muted-foreground">
                  {gap.count === 1 ? t("ai.gaps.askedOnce") : t("ai.gaps.asked", { count: gap.count })}
                  {gap.lastSeenAt && <> · {t("ai.gaps.lastSeen", { when: formatWhen(gap.lastSeenAt, locale) })}</>}
                  {gap.tickets.map((ticket) => (
                    <span key={ticket.id}>
                      {" · "}
                      <Link href={ticketHref(ticket.id)} className={ticketLink} title={ticket.subject ?? undefined}>
                        #{ticket.number}
                      </Link>
                    </span>
                  ))}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {ai.saveApprovedAnswer && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setWriting(gap)}>
                    {t("ai.gaps.write")}
                  </Button>
                )}
                {ai.draftArticle && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setDrafting(gap)}>
                    {t("ai.article.draft")}
                  </Button>
                )}
                {ai.dismissGap && (
                  <Button type="button" size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(gap.id)}>
                    {t("ai.gaps.dismiss")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : gaps.data ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("ai.gaps.empty")}</p>
      ) : (
        <Skeleton className="h-16" />
      )}
      <ApprovedAnswerDialog open={writing !== null} onOpenChange={(open) => !open && setWriting(null)} gap={writing ?? undefined} />
      {drafting && <ArticleDialog open onOpenChange={(open) => !open && setDrafting(null)} from={{ gapId: drafting.id }} />}
    </section>
  );
}
