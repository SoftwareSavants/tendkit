"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSupport } from "./provider";
import { formatWhen } from "./format";

type Form = { guidance: string; topics: string[]; draftOnArrival: boolean };

/** Where a team tells AI how they answer: guidance, topics, whether to suggest replies, and what it knows. */
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
    </div>
  );
}
