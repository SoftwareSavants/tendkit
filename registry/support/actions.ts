import type { ActionField, ActionRun, ActionRunStatus, ProposedAction } from "./types";

/**
 * The parts of actions that need no model and no database: turning an action's input schema into
 * a small form, keeping a run within its time limit, and reading how a run ended.
 */

/** What your `run` answers. `summary` is one line for the agent and the timeline; `data` is what a draft may quote. */
export type ActionResult = { ok: boolean; summary: string; data?: Record<string, unknown> };

/** JSON Schema, as far as a form needs to read it. */
type Property = {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  format?: string;
  anyOf?: Property[];
  oneOf?: Property[];
};
export type ObjectSchema = { type?: unknown; properties?: Record<string, unknown>; required?: string[] };

const NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** Tool names every provider accepts: lowercase letters, digits and underscores. */
export const validActionName = (name: string) => NAME.test(name);

/** "extend_by_days" → "Extend by days". */
const labelOf = (name: string) => {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
};

/** Optional values arrive as `anyOf: [T, null]` from most schema libraries: the form reads T. */
function unwrap(property: Property): Property {
  const options = (property.anyOf ?? property.oneOf)?.filter((option) => option.type !== "null");
  if (options?.length === 1) return { ...options[0], title: property.title ?? options[0]!.title, description: property.description ?? options[0]!.description };
  return property;
}

/**
 * One field per top-level property: text, number, switch, select (for an enum) and date. Lists and
 * nested objects fall back to a JSON field, so every action can be run by hand.
 */
export function fieldsFromSchema(schema: ObjectSchema | null | undefined): ActionField[] {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([name, raw]) => {
    const property = unwrap((raw && typeof raw === "object" ? raw : {}) as Property);
    const type = Array.isArray(property.type) ? property.type.find((t) => t !== "null") : property.type;
    const options = property.enum?.filter((value): value is string => typeof value === "string");
    const kind: ActionField["kind"] =
      options?.length && options.length === property.enum?.length
        ? "select"
        : type === "string"
          ? property.format === "date"
            ? "date"
            : "text"
          : type === "number" || type === "integer"
            ? "number"
            : type === "boolean"
              ? "boolean"
              : "json";
    return {
      name,
      label: property.title?.trim() || labelOf(name),
      description: property.description?.trim() || null,
      kind,
      required: required.has(name),
      ...(kind === "select" ? { options } : {}),
    };
  });
}

export class ActionTimeout extends Error {
  constructor() {
    super("The action timed out");
    this.name = "ActionTimeout";
  }
}

/** Runs `work` and stops waiting after `ms`. The signal tells your code to stop too. */
export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ActionTimeout());
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A run still marked as running long after its time limit never reported back: its process stopped. */
export function runStatus(run: Pick<ActionRun, "status" | "createdAt">, now: Date, timeoutMs: number): ActionRunStatus {
  return run.status === "running" && now.getTime() - run.createdAt.getTime() > timeoutMs + 60_000 ? "errored" : run.status;
}

/** Where a proposal stands, from its latest run. */
export function proposalState(proposal: ProposedAction, run: ActionRun | null, now: Date, timeoutMs: number) {
  if (!run) return proposal.declined ? ("declined" as const) : ("proposed" as const);
  const status = runStatus(run, now, timeoutMs);
  if (status === "succeeded") return "done" as const;
  if (status === "running") return "running" as const;
  return proposal.declined ? ("declined" as const) : ("failed" as const);
}

/** Whether two inputs are the same, whatever the order of their keys. */
export function sameInput(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const [ka, kb] = [Object.keys(a).sort(), Object.keys(b).sort()];
  return ka.length === kb.length && ka.every((key, i) => key === kb[i] && sameInput((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** `data` goes into the log and into prompts: anything that isn't plain JSON, or is very large, is left out. */
export function plainData(data: unknown, maxLength = 20_000): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  try {
    const json = JSON.stringify(data);
    return json.length <= maxLength ? (JSON.parse(json) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
