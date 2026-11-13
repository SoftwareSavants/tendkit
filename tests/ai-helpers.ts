import { MockLanguageModelV4 } from "ai/test";
import { supportAi, type SupportAiOptions } from "../registry/support/ai";
import type { KnowledgeArticle, KnowledgeSource } from "../registry/support/knowledge";
import { createSupport, type SupportOptions } from "../registry/support/service";
import type { AccountFact } from "../registry/support/types";
import { createTestStores, fakeChannel, inbound, memoryStorage, testDirectory } from "./helpers";

/* What the AI suites share: a scripted model, and a support service wired to it. */

export type Call = { system: string; prompt: string; json: boolean };

/** A model that answers from a function and remembers what it was asked. */
export function scripted(id: string, reply: (call: Call) => unknown) {
  const calls: Call[] = [];
  const model = new MockLanguageModelV4({
    modelId: id,
    doGenerate: async (options) => {
      const text = (role: string) =>
        options.prompt
          .filter((m) => m.role === role)
          .map((m) => (typeof m.content === "string" ? m.content : m.content.map((part) => (part.type === "text" ? part.text : "")).join("")))
          .join("\n");
      const call = { system: text("system"), prompt: text("user"), json: options.responseFormat?.type === "json" };
      calls.push(call);
      const value = reply(call);
      return {
        content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 60, text: 60, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}

export const UNDERSTOOD = {
  topic: "payouts",
  urgency: "high",
  urgencyReason: "Money hasn't arrived",
  mood: "frustrated",
  language: "en",
  summary: "Last week's payout hasn't reached their bank",
};
export const DRAFT = {
  kind: "draft",
  text: "Hi Emma,\n\nPayouts take up to 3 business days to reach your bank. Yours left on Monday.",
  reason: "",
  sources: ["docs/payouts.md", "fact:1", "guidance"],
};

export const articles: KnowledgeArticle[] = [
  { id: "payouts.md", title: "Payout timing", url: "https://acme.test/docs/payouts", text: "Payouts take up to 3 business days to reach your bank." },
  { id: "refunds.md", title: "Refunds", text: "Refunds go back to the original payment method." },
];

export const facts: Record<string, AccountFact[]> = {
  cus_northwind: [
    { label: "Last payout", value: "$1,240.00, sent Monday", url: "https://app.acme.test/northwind/payouts" },
    { label: "Plan", value: "Growth" },
  ],
  cus_lumen: [{ label: "Plan", value: "Starter, secret-lumen-detail" }],
};

export async function setupAi(
  overrides: {
    fast?: (call: Call) => unknown;
    main?: (call: Call) => unknown;
    ai?: Partial<SupportAiOptions>;
    support?: Partial<SupportOptions>;
    knowledge?: KnowledgeSource[];
  } = {}
) {
  const { store, aiStore } = await createTestStores();
  const email = fakeChannel();
  const fast = scripted("fast-1", overrides.fast ?? (() => UNDERSTOOD));
  const main = scripted("main-1", overrides.main ?? (() => DRAFT));
  let clock = new Date("2026-11-03T09:00:00Z");
  const described: string[] = [];
  const support = createSupport({
    store,
    storage: memoryStorage(),
    channels: [email.channel],
    directory: {
      ...testDirectory,
      async describeCustomer(customerId) {
        described.push(customerId);
        return facts[customerId] ?? [];
      },
    },
    fromName: "Acme Support",
    portalChannelId: "email",
    now: () => clock,
    log: () => {},
    ...overrides.support,
    ai: supportAi({
      model: main.model,
      fastModel: fast.model,
      store: aiStore,
      knowledge: overrides.knowledge ?? [{ id: "docs", load: async () => articles }],
      ...overrides.ai,
    }),
  });
  await support.ai.updateSettings({ guidance: "Never promise a payout date we can't see.", topics: ["payouts", "billing"] });
  await support.ai.syncKnowledge();
  const receive = async (partial: Parameters<typeof inbound>[0] = {}) => {
    const result = await support.ingest("email", { type: "message", message: inbound({ receivedAt: clock, ...partial }) });
    return (result as { ticketId: string }).ticketId;
  };
  return {
    support,
    aiStore,
    email,
    fast,
    main,
    described,
    receive,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
    now: () => clock,
  };
}
