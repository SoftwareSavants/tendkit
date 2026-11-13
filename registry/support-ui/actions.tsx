"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupport, type Translate } from "./provider";
import type { ActionField, ActionRun, ProposedAction, TicketAction, TicketDetail } from "./client";

/*
 * Actions: what AI and agents can do in your product from a ticket. The cards under a suggested
 * reply (approve or skip what it assumes), the dialog that runs one by hand, and the small form
 * both share. Each part appears only when the client has `runAction`.
 */

type Values = Record<string, string | boolean>;

/** An action's input as what its form fields hold. */
export function toValues(fields: ActionField[], input: Record<string, unknown> = {}): Values {
  return Object.fromEntries(
    fields.map((field) => {
      const value = input[field.name];
      if (field.kind === "boolean") return [field.name, value === true];
      if (field.kind === "json") return [field.name, value === undefined ? "" : JSON.stringify(value, null, 2)];
      return [field.name, value === undefined || value === null ? "" : String(value)];
    })
  );
}

/** What the form holds as the action's input, or the field that still needs a valid value. */
export function fromValues(fields: ActionField[], values: Values): { input: Record<string, unknown> } | { invalid: ActionField } {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.kind === "boolean") {
      input[field.name] = value === true;
      continue;
    }
    const text = String(value ?? "").trim();
    if (!text) {
      if (field.required) return { invalid: field };
      continue;
    }
    if (field.kind === "number") {
      const number = Number(text);
      if (!Number.isFinite(number)) return { invalid: field };
      input[field.name] = number;
    } else if (field.kind === "json") {
      try {
        input[field.name] = JSON.parse(text);
      } catch {
        return { invalid: field };
      }
    } else input[field.name] = text;
  }
  return { input };
}

const control = "h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";

/** One control per input: text, number, date, a switch, a select for fixed choices, JSON for anything else. */
export function ActionFields({
  id,
  fields,
  values,
  onChange,
  disabled,
  className,
}: {
  /** Makes each control's id unique on the page. */
  id: string;
  fields: ActionField[];
  values: Values;
  onChange: (values: Values) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (!fields.length) return null;
  const set = (name: string, value: string | boolean) => onChange({ ...values, [name]: value });
  return (
    <div className={cn("grid gap-3", className)}>
      {fields.map((field) => {
        const fieldId = `${id}-${field.name}`;
        const value = values[field.name];
        const label = (
          <label htmlFor={fieldId} className="text-xs font-medium">
            {field.label}
          </label>
        );
        if (field.kind === "boolean") {
          return (
            <div key={field.name} className="flex items-center justify-between gap-3" title={field.description ?? undefined}>
              {label}
              <Switch id={fieldId} checked={value === true} disabled={disabled} onCheckedChange={(checked) => set(field.name, Boolean(checked))} />
            </div>
          );
        }
        return (
          <div key={field.name} className={cn("grid gap-1", field.kind === "json" && "sm:col-span-full")} title={field.description ?? undefined}>
            {label}
            {field.kind === "select" ? (
              // A native select: the same in Radix and Base UI projects, and at home on a phone.
              <select id={fieldId} value={String(value ?? "")} disabled={disabled} onChange={(e) => set(field.name, e.target.value)} className={control}>
                {(!field.required || !value) && <option value="" />}
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.kind === "json" ? (
              <Textarea id={fieldId} dir="ltr" value={String(value ?? "")} disabled={disabled} onChange={(e) => set(field.name, e.target.value)} className="min-h-20 font-mono text-xs" spellCheck={false} />
            ) : (
              <Input
                id={fieldId}
                type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
                dir="auto"
                value={String(value ?? "")}
                disabled={disabled}
                onChange={(e) => set(field.name, e.target.value)}
                className="h-8"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Why a run didn't go through, in words an agent can act on. Null when it did. */
export function runProblem(run: Pick<ActionRun, "status" | "summary">, title: string, t: Translate): string | null {
  if (run.status === "succeeded" || run.status === "running") return null;
  if (run.status === "failed") return run.summary ? t("ai.actions.errors.failedWith", { title, summary: run.summary }) : t("ai.actions.errors.failed", { title });
  return t(`ai.actions.errors.${run.status === "timed_out" ? "timedOut" : "errored"}`, { title });
}

const problem = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

/** The proposed actions an agent hasn't decided on: what sending the reply should ask about first. */
export const undecidedActions = (actions: ProposedAction[] | undefined) => (actions ?? []).filter((action) => action.state === "proposed" || action.state === "failed");

/**
 * Under a suggested reply: each change the reply assumes, with what it will do, its inputs,
 * Approve and Skip. Approving runs it for this ticket's customer; skipping rewrites the reply.
 */
export function ProposedActions({
  ticketId,
  suggestionId,
  actions,
  text,
  onText,
}: {
  ticketId: string;
  suggestionId: string;
  actions: ProposedAction[];
  /** The reply box, when it holds the suggested reply: rewritten when an action is skipped or its inputs change. */
  text: string | null;
  onText: (text: string) => void;
}) {
  const { client } = useSupport();
  if (!client.ai?.runAction || !actions.length) return null;
  return (
    <ul className="space-y-2 px-4 pt-3">
      {actions.map((action) => (
        <ProposedActionCard key={action.name} ticketId={ticketId} suggestionId={suggestionId} action={action} text={text} onText={onText} />
      ))}
    </ul>
  );
}

function ProposedActionCard({
  ticketId,
  suggestionId,
  action,
  text,
  onText,
}: {
  ticketId: string;
  suggestionId: string;
  action: ProposedAction;
  text: string | null;
  onText: (text: string) => void;
}) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const ai = client.ai!;
  const [values, setValues] = useState(() => toValues(action.fields, action.input));
  const [invalid, setInvalid] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["support", "ticket", ticketId] });

  const approve = useMutation({
    mutationFn: (input: Record<string, unknown>) => ai.runAction!({ ticketId, suggestionId, action: action.name, input, ...(text ? { text } : {}) }),
    onSuccess: (result) => {
      if (result.text) onText(result.text);
    },
    onSettled: refresh,
  });
  const skip = useMutation({
    mutationFn: () => ai.declineAction!({ ticketId, suggestionId, action: action.name, ...(text ? { text } : {}) }),
    onSuccess: (result) => {
      if (result.text) onText(result.text);
    },
    onSettled: refresh,
  });

  // What this agent just did shows at once; what the server says takes over when the ticket reloads.
  const run = approve.data?.run ?? action.run;
  const state: ProposedAction["state"] =
    approve.isPending || action.state === "running"
      ? "running"
      : run?.status === "succeeded"
        ? "done"
        : skip.isSuccess || action.state === "declined"
          ? "declined"
          : run && run.status !== "running"
            ? "failed"
            : "proposed";
  const busy = approve.isPending || skip.isPending;
  const failure = approve.isError ? problem(approve.error, t("ai.actions.errors.request")) : skip.isError ? problem(skip.error, t("ai.failed")) : state === "failed" && run ? runProblem(run, action.title, t) : null;

  const submit = () => {
    const parsed = fromValues(action.fields, values);
    if ("invalid" in parsed) return setInvalid(t("ai.actions.invalidField", { field: parsed.invalid.label }));
    setInvalid(null);
    approve.mutate(parsed.input);
  };

  if (state === "done" || state === "declined") {
    return (
      <li className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
        {state === "done" ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <Zap className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <p className={cn("min-w-0", state === "declined" && "text-muted-foreground")}>
          <span className="font-medium">{action.title}</span>
          <span dir="auto" className="text-muted-foreground">
            {" · "}
            {state === "done" ? run?.summary || t("ai.actions.done") : t("ai.actions.skipped")}
          </span>
        </p>
      </li>
    );
  }

  return (
    <li className="space-y-3 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 items-start gap-2">
          <Zap className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">{action.title}</p>
            {action.reason && (
              <p dir="auto" className="text-xs text-muted-foreground">
                {action.reason}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {ai.declineAction && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy || state === "running"} onClick={() => skip.mutate()}>
              {skip.isPending && <Loader2 className="size-3 animate-spin" />}
              {t("ai.actions.skip")}
            </Button>
          )}
          <Button type="button" size="sm" className="h-7 px-2.5 text-xs" disabled={busy || state === "running"} onClick={submit}>
            {(approve.isPending || state === "running") && <Loader2 className="size-3 animate-spin" />}
            {t(state === "failed" ? "actions.retry" : "ai.actions.approve")}
          </Button>
        </div>
      </div>
      <ActionFields
        id={`support-action-${suggestionId}-${action.name}`}
        fields={action.fields}
        values={values}
        onChange={setValues}
        disabled={busy || state === "running"}
        className="sm:grid-cols-2"
      />
      {(invalid || failure) && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span dir="auto">{invalid ?? failure}</span>
        </p>
      )}
    </li>
  );
}

/** What a lookup returned, when it's a flat list of values worth showing. */
function ResultData({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value));
  if (!rows.length) return null;
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([key, value]) => (
        <div key={key} className="flex justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{key}</dt>
          <dd dir="auto" className="min-w-0 text-end break-words tabular-nums">
            {String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Runs one action by hand, from the ticket's menu: its inputs, then what happened. */
export function RunActionDialog({ detail, action, onClose }: { detail: TicketDetail; action: TicketAction | null; onClose: () => void }) {
  const { client, t } = useSupport();
  const queryClient = useQueryClient();
  const ticketId = detail.ticket.id;
  const [values, setValues] = useState<Values>({});
  const [invalid, setInvalid] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (input: Record<string, unknown>) => client.ai!.runAction!({ ticketId, action: action!.name, input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["support", "ticket", ticketId] }),
  });

  useEffect(() => {
    if (!action) return;
    run.reset();
    setInvalid(null);
    setValues(toValues(action.fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.name]);

  if (!action) return null;
  const result = run.data?.run ?? null;
  const failure = run.isError ? problem(run.error, t("ai.actions.errors.request")) : result ? runProblem(result, action.title, t) : null;
  const done = result?.status === "succeeded";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{action.title}</DialogTitle>
          <DialogDescription>{t("ai.actions.runFor", { customer: detail.customer?.name ?? "" })}</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <span dir="auto">{result.summary || t("ai.actions.done")}</span>
            </p>
            {result.data && <ResultData data={result.data} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("ai.actions.close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = fromValues(action.fields, values);
              if ("invalid" in parsed) return setInvalid(t("ai.actions.invalidField", { field: parsed.invalid.label }));
              setInvalid(null);
              run.mutate(parsed.input);
            }}
          >
            <ActionFields id={`support-run-${action.name}`} fields={action.fields} values={values} onChange={setValues} disabled={run.isPending} />
            {(invalid || failure) && (
              <p className="flex items-start gap-1.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span dir="auto">{invalid ?? failure}</span>
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={run.isPending}>
                {run.isPending && <Loader2 className="size-4 animate-spin" />}
                {t(result ? "actions.retry" : "ai.actions.run")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
