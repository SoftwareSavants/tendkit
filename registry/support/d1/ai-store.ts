import { and, asc, count, desc, eq, inArray, isNotNull, lt, max, notInArray, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { DEFAULT_AI_SETTINGS, URGENCY_RANK, type AiSettings, type AiStore, type InsightRow, type SuggestionRow } from "../ai-store";
import type { Mood, Suggestion, SuggestionStatus, Urgency } from "../types";
import { supportAiSettings, supportKnowledge, supportSuggestions, supportTicketInsights } from "./ai-schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<"async", any, any>;

/** Copilot's store for SQLite and Cloudflare D1. Each method is a few short queries. */
export function createD1AiStore(db: Db): AiStore {
  const store: AiStore = {
    async getSettings() {
      const [row] = await db.select().from(supportAiSettings).where(eq(supportAiSettings.id, "default")).limit(1);
      return row ? toSettings(row) : { ...DEFAULT_AI_SETTINGS };
    },

    async updateSettings(patch) {
      const values = { ...(await store.getSettings()), ...patch };
      await db
        .insert(supportAiSettings)
        .values({ id: "default", ...values, updatedAt: new Date() })
        .onConflictDoUpdate({ target: supportAiSettings.id, set: { ...values, updatedAt: new Date() } });
      return values;
    },

    async listKnowledge() {
      return db.select().from(supportKnowledge).orderBy(asc(supportKnowledge.sourceId), asc(supportKnowledge.articleId));
    },

    async replaceKnowledge(sourceId, articles, at) {
      const existing = await db
        .select({ articleId: supportKnowledge.articleId, contentHash: supportKnowledge.contentHash })
        .from(supportKnowledge)
        .where(eq(supportKnowledge.sourceId, sourceId));
      const hashes = new Map(existing.map((r) => [r.articleId, r.contentHash]));
      const keep = new Set(articles.map((a) => a.id));
      let added = 0;
      let updated = 0;
      for (const article of articles) {
        const known = hashes.get(article.id);
        if (known === article.contentHash) continue;
        const row = { sourceId, articleId: article.id, title: article.title, url: article.url, text: article.text, contentHash: article.contentHash, syncedAt: at };
        await db
          .insert(supportKnowledge)
          .values(row)
          .onConflictDoUpdate({ target: [supportKnowledge.sourceId, supportKnowledge.articleId], set: row });
        if (known === undefined) added++;
        else updated++;
      }
      const gone = existing.map((r) => r.articleId).filter((id) => !keep.has(id));
      // D1 allows 100 bound parameters per query.
      for (let i = 0; i < gone.length; i += 50) {
        await db
          .delete(supportKnowledge)
          .where(and(eq(supportKnowledge.sourceId, sourceId), inArray(supportKnowledge.articleId, gone.slice(i, i + 50))));
      }
      // Unchanged articles were checked too.
      await db.update(supportKnowledge).set({ syncedAt: at }).where(eq(supportKnowledge.sourceId, sourceId));
      return { added, updated, removed: gone.length };
    },

    async deleteKnowledgeExcept(sourceIds) {
      await db.delete(supportKnowledge).where(sourceIds.length ? notInArray(supportKnowledge.sourceId, sourceIds) : undefined);
    },

    async knowledgeStats() {
      const rows = await db
        .select({ sourceId: supportKnowledge.sourceId, articles: count(), syncedAt: max(supportKnowledge.syncedAt) })
        .from(supportKnowledge)
        .groupBy(supportKnowledge.sourceId);
      return rows.map((r) => ({ sourceId: r.sourceId, articles: Number(r.articles), syncedAt: r.syncedAt ? new Date(r.syncedAt) : null }));
    },

    async getInsight(ticketId) {
      const [row] = await store.getInsights([ticketId]);
      return row ?? null;
    },

    async getInsights(ticketIds) {
      if (!ticketIds.length) return [];
      const rows = await db.select().from(supportTicketInsights).where(inArray(supportTicketInsights.ticketId, ticketIds));
      return rows.map(toInsight);
    },

    async queueInsight(ticketId, messageId, at) {
      await db
        .insert(supportTicketInsights)
        .values({ ticketId, pendingMessageId: messageId, attempts: 0, lastError: null, updatedAt: at })
        .onConflictDoUpdate({
          target: supportTicketInsights.ticketId,
          set: { pendingMessageId: messageId, attempts: 0, lastError: null, updatedAt: at },
        });
    },

    async saveInsight(ticketId, patch, at) {
      const set = {
        ...patch,
        ...(patch.urgency !== undefined ? { urgencyRank: patch.urgency ? URGENCY_RANK[patch.urgency] : null } : {}),
        updatedAt: at,
      };
      await db
        .insert(supportTicketInsights)
        .values({ ticketId, ...set })
        .onConflictDoUpdate({ target: supportTicketInsights.ticketId, set });
    },

    async finishInsight(ticketId, messageId, at) {
      await db
        .update(supportTicketInsights)
        .set({ pendingMessageId: null, attempts: 0, lastError: null, updatedAt: at })
        .where(and(eq(supportTicketInsights.ticketId, ticketId), eq(supportTicketInsights.pendingMessageId, messageId)));
    },

    async failInsight(ticketId, error, at) {
      await db
        .update(supportTicketInsights)
        .set({ attempts: sql`${supportTicketInsights.attempts} + 1`, lastError: error.slice(0, 500), updatedAt: at })
        .where(eq(supportTicketInsights.ticketId, ticketId));
    },

    async listQueuedInsights({ before, maxAttempts, limit }) {
      const rows = await db
        .select({ ticketId: supportTicketInsights.ticketId, messageId: supportTicketInsights.pendingMessageId })
        .from(supportTicketInsights)
        .where(
          and(
            isNotNull(supportTicketInsights.pendingMessageId),
            lt(supportTicketInsights.attempts, maxAttempts),
            lt(supportTicketInsights.updatedAt, before)
          )
        )
        .orderBy(asc(supportTicketInsights.updatedAt))
        .limit(limit);
      return rows.map((r) => ({ ticketId: r.ticketId, messageId: r.messageId! }));
    },

    async insertSuggestion(input) {
      const [row] = await db.insert(supportSuggestions).values({ ...input, status: "pending" }).returning();
      return toSuggestion(row!);
    },

    async getSuggestion(id) {
      const [row] = await db.select().from(supportSuggestions).where(eq(supportSuggestions.id, id)).limit(1);
      return row ? toSuggestionRow(row) : null;
    },

    async pendingSuggestion(ticketId) {
      const [row] = await db
        .select()
        .from(supportSuggestions)
        .where(and(eq(supportSuggestions.ticketId, ticketId), eq(supportSuggestions.status, "pending")))
        .orderBy(desc(supportSuggestions.createdAt))
        .limit(1);
      return row ? toSuggestion(row) : null;
    },

    async ticketsWithDraft(ticketIds) {
      if (!ticketIds.length) return new Set();
      const rows = await db
        .selectDistinct({ ticketId: supportSuggestions.ticketId })
        .from(supportSuggestions)
        .where(
          and(inArray(supportSuggestions.ticketId, ticketIds), eq(supportSuggestions.status, "pending"), eq(supportSuggestions.kind, "draft"))
        );
      return new Set(rows.map((r) => r.ticketId));
    },

    async closeSuggestions(ticketId, status, at) {
      await db
        .update(supportSuggestions)
        .set({ status, decidedAt: at })
        .where(and(eq(supportSuggestions.ticketId, ticketId), eq(supportSuggestions.status, "pending")));
    },

    async decideSuggestion(id, patch, at) {
      await db
        .update(supportSuggestions)
        .set({ ...patch, decidedAt: at })
        .where(and(eq(supportSuggestions.id, id), eq(supportSuggestions.status, "pending")));
    },
  };
  return store;
}

function toSettings(row: typeof supportAiSettings.$inferSelect): AiSettings {
  return { guidance: row.guidance, topics: row.topics, draftOnArrival: row.draftOnArrival, knowledgeSyncedAt: row.knowledgeSyncedAt };
}

function toInsight(row: typeof supportTicketInsights.$inferSelect): InsightRow {
  return {
    ...row,
    urgency: row.urgency as Urgency | null,
    mood: row.mood as Mood | null,
  };
}

function toSuggestion(row: typeof supportSuggestions.$inferSelect): Suggestion {
  return {
    id: row.id,
    ticketId: row.ticketId,
    basedOnMessageId: row.basedOnMessageId,
    kind: row.kind as Suggestion["kind"],
    text: row.text,
    reason: row.reason,
    sources: row.sources,
    status: row.status as SuggestionStatus,
    createdAt: row.createdAt,
  };
}

function toSuggestionRow(row: typeof supportSuggestions.$inferSelect): SuggestionRow {
  return {
    ...toSuggestion(row),
    modelId: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    sentMessageId: row.sentMessageId,
    finalText: row.finalText,
    decidedAt: row.decidedAt,
  };
}
