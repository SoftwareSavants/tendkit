import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SupportStore, TicketCounts } from "../store";
import type { Attachment, Contact, Identity, Message, Ticket, TicketEvent } from "../types";
import {
  supportAttachments,
  supportChannelState,
  supportContactIdentities,
  supportContacts,
  supportEvents,
  supportMessages,
  supportReads,
  supportTickets,
} from "./schema";
import { periodBreakdown, periodTotals } from "./stats";

// Any Drizzle Postgres database: postgres-js, node-postgres, Neon, PGlite, …
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<PgQueryResultHKT, any, any>;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createPostgresStore(db: Db): SupportStore {
  const store: SupportStore = {
    async transaction(fn) {
      return db.transaction((tx) => fn(createPostgresStore(tx as unknown as Db)));
    },

    async findContactByIdentity(identity) {
      const [row] = await db
        .select({ contactId: supportContactIdentities.contactId })
        .from(supportContactIdentities)
        .where(and(eq(supportContactIdentities.kind, identity.kind), eq(supportContactIdentities.value, identity.value)))
        .limit(1);
      return row ? store.getContact(row.contactId) : null;
    },

    async getContact(id) {
      const [contact] = await store.getContacts([id]);
      return contact ?? null;
    },

    async getContacts(ids) {
      if (!ids.length) return [];
      const [rows, identities] = await Promise.all([
        db.select().from(supportContacts).where(inArray(supportContacts.id, ids)),
        db.select().from(supportContactIdentities).where(inArray(supportContactIdentities.contactId, ids)),
      ]);
      return rows.map((row) => toContact(row, identities.filter((i) => i.contactId === row.id)));
    },

    async listContacts(query) {
      const search = query.search?.trim().replace(/[\\%_]/g, "\\$&");
      const rows = await db
        .select({ id: supportContacts.id })
        .from(supportContacts)
        .where(
          and(
            query.customerId ? eq(supportContacts.customerId, query.customerId) : undefined,
            query.userId ? eq(supportContacts.userId, query.userId) : undefined,
            search
              ? or(
                  ilike(supportContacts.name, `%${search}%`),
                  sql`exists (select 1 from ${supportContactIdentities} i where i.contact_id = ${supportContacts.id} and i.value like ${`%${search.toLowerCase()}%`})`
                )
              : undefined
          )
        )
        .orderBy(desc(supportContacts.updatedAt), desc(supportContacts.id))
        .limit(query.limit);
      const contacts = await store.getContacts(rows.map((row) => row.id));
      const order = new Map(rows.map((row, index) => [row.id, index]));
      return contacts.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    },

    async createContact(input) {
      const [row] = await db
        .insert(supportContacts)
        .values({ name: input.name, customerId: input.customerId, userId: input.userId, locale: input.locale })
        .returning();
      for (const identity of input.identities) await store.addIdentity(row!.id, identity);
      return (await store.getContact(row!.id))!;
    },

    async updateContact(id, patch) {
      await db.update(supportContacts).set({ ...patch, updatedAt: new Date() }).where(eq(supportContacts.id, id));
    },

    async addIdentity(contactId, identity) {
      await db
        .insert(supportContactIdentities)
        .values({ contactId, kind: identity.kind, value: identity.value })
        .onConflictDoNothing();
    },

    async getTicket(id) {
      const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
      return (row as Ticket | undefined) ?? null;
    },

    async findTicketByToken(token) {
      const [row] = await db.select().from(supportTickets).where(eq(supportTickets.replyToken, token)).limit(1);
      return (row as Ticket | undefined) ?? null;
    },

    async findTicketByRfcMessageIds(ids) {
      if (!ids.length) return null;
      const [row] = await db
        .select({ ticketId: supportMessages.ticketId })
        .from(supportMessages)
        .where(inArray(supportMessages.rfcMessageId, ids))
        .orderBy(desc(supportMessages.createdAt))
        .limit(1);
      return row ? store.getTicket(row.ticketId) : null;
    },

    async findTicketByProviderThread(channelId, providerThreadId) {
      const [row] = await db
        .select()
        .from(supportTickets)
        .where(and(eq(supportTickets.channelId, channelId), eq(supportTickets.providerThreadId, providerThreadId)))
        .orderBy(desc(supportTickets.lastMessageAt))
        .limit(1);
      return (row as Ticket | undefined) ?? null;
    },

    async findLatestTicket(channelId, contactId) {
      const [row] = await db
        .select()
        .from(supportTickets)
        .where(and(eq(supportTickets.channelId, channelId), eq(supportTickets.contactId, contactId)))
        .orderBy(desc(supportTickets.lastMessageAt))
        .limit(1);
      return (row as Ticket | undefined) ?? null;
    },

    async createTicket(input) {
      const [row] = await db
        .insert(supportTickets)
        .values({ ...input, lastMessageAt: input.createdAt, createdAt: input.createdAt, updatedAt: input.createdAt })
        .returning();
      return row as Ticket;
    },

    async linkContactTickets(contactId, customerId) {
      await db
        .update(supportTickets)
        .set({ customerId, updatedAt: new Date() })
        .where(and(eq(supportTickets.contactId, contactId), isNull(supportTickets.customerId)));
    },

    async updateTicket(id, patch) {
      const [row] = await db
        .update(supportTickets)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(supportTickets.id, id))
        .returning();
      if (!row) throw new Error(`Ticket ${id} not found`);
      return row as Ticket;
    },

    async listTickets(query) {
      const where = and(...ticketFilters(query));
      const order =
        query.sort === "waiting"
          ? [sql`${supportTickets.waitingSince} asc nulls last`, desc(supportTickets.lastMessageAt)]
          : query.sort === "priority"
            ? [
                // Raw SQL, so this file doesn't depend on the AI schema. Tickets without an insight count as normal.
                sql`coalesce((select urgency_rank from support_ticket_insights where support_ticket_insights.ticket_id = ${supportTickets.id}), 2) asc`,
                sql`${supportTickets.waitingSince} asc nulls last`,
                desc(supportTickets.lastMessageAt),
              ]
          : query.sort === "solved"
            ? [sql`${supportTickets.solvedAt} desc nulls last`]
            : [desc(supportTickets.lastMessageAt)];
      const [items, [total]] = await Promise.all([
        db
          .select()
          .from(supportTickets)
          .where(where)
          .orderBy(...order, desc(supportTickets.number))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(supportTickets).where(where),
      ]);
      return { items: items as Ticket[], total: Number(total?.value ?? 0) };
    },

    async countTickets({ assigneeId }) {
      const rows = await db
        .select({
          status: supportTickets.status,
          total: count(),
          unassigned: sql<number>`count(*) filter (where ${supportTickets.assigneeId} is null)`.mapWith(Number),
          mine: assigneeId
            ? sql<number>`count(*) filter (where ${supportTickets.assigneeId} = ${assigneeId})`.mapWith(Number)
            : sql<number>`0`.mapWith(Number),
        })
        .from(supportTickets)
        .groupBy(supportTickets.status);
      const counts: TicketCounts = { open: 0, waiting: 0, solved: 0, spam: 0, unassigned: 0, mine: 0 };
      for (const row of rows) {
        counts[row.status as keyof TicketCounts] = Number(row.total);
        // Unassigned and mine count what still needs an answer.
        if (row.status === "open") {
          counts.unassigned = row.unassigned;
          counts.mine = row.mine;
        }
      }
      return counts;
    },

    async insertMessage(input) {
      const [row] = await db
        .insert(supportMessages)
        .values(input)
        .onConflictDoNothing({ target: [supportMessages.channelId, supportMessages.providerMessageId] })
        .returning();
      return row ? toMessage(row, []) : null;
    },

    async updateMessage(id, patch) {
      await db.update(supportMessages).set(patch).where(eq(supportMessages.id, id));
    },

    async getMessage(id) {
      const [row] = await db.select().from(supportMessages).where(eq(supportMessages.id, id)).limit(1);
      if (!row) return null;
      const attachments = await db.select().from(supportAttachments).where(eq(supportAttachments.messageId, id));
      return toMessage(row, attachments);
    },

    async findMessageByProviderId(channelId, providerMessageId) {
      const [row] = await db
        .select()
        .from(supportMessages)
        .where(and(eq(supportMessages.channelId, channelId), eq(supportMessages.providerMessageId, providerMessageId)))
        .limit(1);
      return row ? toMessage(row, []) : null;
    },

    async listMessages(ticketId, { includeNotes }) {
      const rows = await db
        .select()
        .from(supportMessages)
        .where(and(eq(supportMessages.ticketId, ticketId), includeNotes ? undefined : ne(supportMessages.kind, "note")))
        .orderBy(asc(supportMessages.createdAt));
      const ids = rows.map((r) => r.id);
      const attachments = ids.length
        ? await db.select().from(supportAttachments).where(inArray(supportAttachments.messageId, ids))
        : [];
      return rows.map((row) => toMessage(row, attachments.filter((a) => a.messageId === row.id)));
    },

    async listStaleQueued(before) {
      const rows = await db
        .select()
        .from(supportMessages)
        .where(and(eq(supportMessages.deliveryStatus, "queued"), lt(supportMessages.createdAt, before)))
        .limit(100);
      return rows.map((row) => toMessage(row, []));
    },

    async insertAttachment(input) {
      const [row] = await db.insert(supportAttachments).values(input).returning();
      return toAttachment(row!);
    },

    async getAttachment(id) {
      const [row] = await db.select().from(supportAttachments).where(eq(supportAttachments.id, id)).limit(1);
      return row ? { ...toAttachment(row), ticketId: row.ticketId, uploadedBy: row.uploadedBy } : null;
    },

    async linkAttachments(ids, messageId) {
      if (!ids.length) return;
      await db
        .update(supportAttachments)
        .set({ messageId })
        .where(and(inArray(supportAttachments.id, ids), isNull(supportAttachments.messageId)));
    },

    async insertEvent(input) {
      await db.insert(supportEvents).values({ ...input, createdAt: input.createdAt ?? new Date() });
    },

    async listEvents(ticketId) {
      const rows = await db
        .select()
        .from(supportEvents)
        .where(eq(supportEvents.ticketId, ticketId))
        .orderBy(asc(supportEvents.createdAt));
      return rows as TicketEvent[];
    },

    async markRead(ticketId, readerId, at) {
      await db
        .insert(supportReads)
        .values({ ticketId, readerId, readAt: at })
        .onConflictDoUpdate({
          target: [supportReads.ticketId, supportReads.readerId],
          set: { readAt: sql`greatest(${supportReads.readAt}, excluded.read_at)` },
        });
    },

    async getReadTimes(ticketIds, readerId) {
      if (!ticketIds.length) return new Map();
      const rows = await db
        .select()
        .from(supportReads)
        .where(and(inArray(supportReads.ticketId, ticketIds), eq(supportReads.readerId, readerId)));
      return new Map(rows.map((r) => [r.ticketId, r.readAt]));
    },

    periodTotals: (range) => periodTotals(db, range),
    periodBreakdown: (range) => periodBreakdown(db, range),

    async getChannelState(channelId) {
      const [row] = await db
        .select()
        .from(supportChannelState)
        .where(eq(supportChannelState.channelId, channelId))
        .limit(1);
      return row?.state ?? null;
    },

    async setChannelState(channelId, state, error = null) {
      await db
        .insert(supportChannelState)
        .values({ channelId, state, lastError: error })
        .onConflictDoUpdate({
          target: supportChannelState.channelId,
          set: { state, lastError: error, updatedAt: new Date() },
        });
    },
  };
  return store;
}

function ticketFilters(query: Parameters<SupportStore["listTickets"]>[0]): (SQL | undefined)[] {
  const filters: (SQL | undefined)[] = [];
  if (query.status) filters.push(eq(supportTickets.status, query.status));
  else filters.push(ne(supportTickets.status, "spam"));
  if (query.assigneeId === null) filters.push(isNull(supportTickets.assigneeId));
  else if (query.assigneeId) filters.push(eq(supportTickets.assigneeId, query.assigneeId));
  if (query.customerId) filters.push(eq(supportTickets.customerId, query.customerId));
  if (query.channelId) filters.push(eq(supportTickets.channelId, query.channelId));
  if (query.createdFrom) filters.push(gte(supportTickets.createdAt, query.createdFrom));
  if (query.createdTo) filters.push(lt(supportTickets.createdAt, query.createdTo));
  if (query.topic) {
    // Raw SQL, so this file doesn't depend on the AI schema.
    filters.push(
      exists(
        sql`(select 1 from support_ticket_insights where support_ticket_insights.ticket_id = ${supportTickets.id} and support_ticket_insights.topic = ${query.topic})`
      )
    );
  }
  if (query.contactUserId) {
    filters.push(
      exists(
        sql`(select 1 from ${supportContacts} where ${supportContacts.id} = ${supportTickets.contactId} and ${supportContacts.userId} = ${query.contactUserId})`
      )
    );
  }
  const search = query.search?.trim();
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    const number = /^#?(\d{1,9})$/.exec(search)?.[1];
    filters.push(
      or(
        ilike(supportTickets.subject, pattern),
        number ? eq(supportTickets.number, Number(number)) : undefined,
        query.searchCustomerIds?.length ? inArray(supportTickets.customerId, query.searchCustomerIds) : undefined,
        exists(
          sql`(select 1 from ${supportContactIdentities} where ${supportContactIdentities.contactId} = ${supportTickets.contactId} and ${supportContactIdentities.value} ilike ${pattern})`
        ),
        exists(
          sql`(select 1 from ${supportContacts} where ${supportContacts.id} = ${supportTickets.contactId} and ${supportContacts.name} ilike ${pattern})`
        ),
        exists(
          sql`(select 1 from ${supportMessages} where ${supportMessages.ticketId} = ${supportTickets.id} and ${supportMessages.kind} <> 'note' and ${supportMessages.text} ilike ${pattern})`
        )
      )
    );
  }
  return filters;
}

function toContact(
  row: typeof supportContacts.$inferSelect,
  identities: (typeof supportContactIdentities.$inferSelect)[]
): Contact {
  return {
    id: row.id,
    name: row.name,
    customerId: row.customerId,
    userId: row.userId,
    locale: row.locale,
    blockedAt: row.blockedAt,
    identities: identities.map((i): Identity => ({ kind: i.kind, value: i.value })),
  };
}

function toAttachment(row: typeof supportAttachments.$inferSelect): Attachment {
  return {
    id: row.id,
    messageId: row.messageId,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    storageKey: row.storageKey,
    contentId: row.contentId,
    inline: row.inline,
  };
}

function toMessage(
  row: typeof supportMessages.$inferSelect,
  attachments: (typeof supportAttachments.$inferSelect)[]
): Message {
  return {
    ...row,
    kind: row.kind as Message["kind"],
    deliveryStatus: row.deliveryStatus as Message["deliveryStatus"],
    source: row.source as Message["source"],
    attachments: attachments.map(toAttachment),
  };
}
