import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DatabaseSync } from "node:sqlite";
import { drizzle as drizzleProxy } from "drizzle-orm/sqlite-proxy";
import { createPostgresStore } from "../registry/support/postgres/store";
import { createD1Store } from "../registry/support/d1/store";
import { createSupport, type AttachmentStorage, type SupportNotification, type SupportOptions } from "../registry/support/service";
import type { Channel, ChannelCapabilities, InboundMessage, OutboundMessage, SendResult } from "../registry/support/channel";

const migrationsDir = new URL("../registry/support/postgres/migrations/", import.meta.url);
const d1MigrationsDir = new URL("../registry/support/d1/migrations/", import.meta.url);

/** TENDKIT_STORE=d1 runs the suite against SQLite (the D1 store) instead of Postgres. */
export const storeKind = process.env.TENDKIT_STORE === "d1" ? "d1" : "postgres";

/** A fresh SQLite database through Drizzle's proxy driver, behaving like D1 (async, foreign keys on). */
export function createSqliteDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(d1MigrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(file, d1MigrationsDir), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
  }
  return drizzleProxy(async (query, params, method) => {
    const statement = sqlite.prepare(query);
    const args = params as (string | number | null | bigint | Uint8Array)[];
    if (method === "run") {
      statement.run(...args);
      return { rows: [] };
    }
    statement.setReturnArrays(true);
    if (method === "get") return { rows: (statement.get(...args) as unknown as unknown[] | undefined) ?? [] };
    return { rows: statement.all(...args) as unknown as unknown[][] };
  });
}

export async function createTestStore() {
  return storeKind === "d1" ? createD1Store(createSqliteDb()) : createPostgresStore(await createTestDb());
}

let template: Promise<PGlite> | undefined;

/** A migrated database. Migrations run once per test file; each test gets a fresh clone. */
export async function createTestDb() {
  template ??= (async () => {
    const client = new PGlite();
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = readFileSync(new URL(file, migrationsDir), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) await client.exec(statement);
    }
    return client;
  })();
  return drizzle((await (await template).clone()) as PGlite);
}

export const emailCapabilities: ChannelCapabilities = {
  subject: true,
  attachments: { maxBytes: 10_000_000, maxCount: 10 },
  maxTextLength: null,
  conversation: "thread",
  replyWindowHours: null,
  deliveryReceipts: true,
};

/** A channel that records what it sends instead of calling a provider. */
export function fakeChannel(overrides: Partial<Channel> & { fail?: boolean } = {}) {
  const sent: OutboundMessage[] = [];
  let n = 0;
  const channel: Channel = {
    id: "email",
    kind: "email",
    identityKind: "email",
    address: "support@acme.test",
    replyAddress: "support@in.acme.test",
    capabilities: emailCapabilities,
    async send(message): Promise<SendResult> {
      if (overrides.fail) throw new Error("provider is down");
      sent.push(message);
      n++;
      return { providerMessageId: `out-${n}`, rfcMessageId: `<out-${n}@acme.test>` };
    },
    ...overrides,
  };
  return { channel, sent };
}

export function memoryStorage(): AttachmentStorage & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(key, body) {
      files.set(key, body);
    },
    async get(key) {
      const file = files.get(key);
      if (!file) throw new Error(`missing ${key}`);
      return file;
    },
    async url(key) {
      return `https://files.test/${key}`;
    },
  };
}

export const customers = [
  { id: "cus_northwind", name: "Northwind Coffee" },
  { id: "cus_lumen", name: "Lumen Labs" },
];

export const people: Record<string, { customerId: string; userId: string; name: string; locale: string }> = {
  "emma@northwind.test": { customerId: "cus_northwind", userId: "usr_emma", name: "Emma Clarke", locale: "en" },
  "yusuf@northwind.test": { customerId: "cus_northwind", userId: "usr_yusuf", name: "Yusuf", locale: "ar" },
  "lucas@lumen.test": { customerId: "cus_lumen", userId: "usr_lucas", name: "Lucas", locale: "fr" },
};

export async function setup(options: Partial<SupportOptions> = {}, channels?: Channel[]) {
  const store = await createTestStore();
  const storage = memoryStorage();
  const email = fakeChannel();
  const notifications: SupportNotification[] = [];
  let clock = new Date("2026-11-03T09:00:00Z");
  const support = createSupport({
    store,
    storage,
    channels: channels ?? [email.channel],
    directory: {
      async identify(identity) {
        return people[identity.value] ?? null;
      },
      async searchCustomers(query) {
        return customers.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
      },
      async getCustomers(ids) {
        return customers.filter((c) => ids.includes(c.id));
      },
      async listAgents() {
        return [
          { id: "agent_a", name: "Daniel Kim", email: "daniel@acme.test" },
          { id: "agent_k", name: "Priya", email: "priya@acme.test" },
        ];
      },
    },
    notify: async (n) => void notifications.push(n),
    acknowledgement: () => ({ text: "We've received your message and will reply to this email." }),
    fromName: "Acme Support",
    portalChannelId: "email",
    now: () => clock,
    log: () => {},
    ...options,
  });
  return {
    support,
    store,
    storage,
    email,
    notifications,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
      return clock;
    },
    now: () => clock,
  };
}

let seq = 0;
export function inbound(partial: Partial<Omit<InboundMessage, "from">> & { from?: string } = {}): InboundMessage {
  seq++;
  const { from, ...rest } = partial;
  return {
    providerMessageId: `in-${seq}`,
    rfcMessageId: `<in-${seq}@mail.test>`,
    from: { address: from ?? "emma@northwind.test", name: "Emma" },
    to: [{ address: "support@acme.test" }],
    subject: "Payout not received",
    text: "Hi, we haven't received last week's payout.",
    receivedAt: new Date("2026-11-03T09:00:00Z"),
    ...rest,
  };
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
