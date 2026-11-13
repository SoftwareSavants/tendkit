import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, max, notInArray, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { DEFAULT_AI_SETTINGS, URGENCY_RANK, type AiSettings, type AiStore, type AutopilotTopic, type ExampleRow, type InsightRow, type SuggestionRow } from "../ai-store";
import type { OutcomeRow } from "../autopilot";
import type { ActionRun, ApprovedAnswer, AutopilotBlock, AutopilotState, Gap, GuidanceSuggestion, Mood, Suggestion, SuggestionStatus, Urgency } from "../types";
import {
  supportActionRuns,
  supportAiSettings,
  supportApprovedAnswers,
  supportAutopilotTopics,
  supportExamples,
  supportExampleTerms,
  supportGaps,
  supportGapTickets,
  supportGuidanceSuggestions,
  supportKnowledge,
  supportSuggestions,
  supportTicketInsights,
} from "./ai-schema";
import { supportTickets } from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<PgQueryResultHKT, any, any>;

/** Copilot's store for Postgres. Each method is one or two short queries; none holds a transaction. */
export function createPostgresAiStore(db: Db): AiStore {
  /** Examples with the customer their ticket belongs to today. */
  const examples = () =>
    db
      .select({ example: supportExamples, customerId: supportTickets.customerId })
      .from(supportExamples)
      .innerJoin(supportTickets, eq(supportTickets.id, supportExamples.ticketId))
      .$dynamic();

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
      if (gone.length) {
        await db.delete(supportKnowledge).where(and(eq(supportKnowledge.sourceId, sourceId), inArray(supportKnowledge.articleId, gone)));
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

    async listAnswers() {
      const rows = await db.select().from(supportApprovedAnswers).orderBy(asc(supportApprovedAnswers.createdAt), asc(supportApprovedAnswers.id));
      return rows.map(toAnswer);
    },

    async getAnswer(id) {
      const [row] = await db.select().from(supportApprovedAnswers).where(eq(supportApprovedAnswers.id, id)).limit(1);
      return row ? toAnswer(row) : null;
    },

    async insertAnswer(input, at) {
      const [row] = await db.insert(supportApprovedAnswers).values({ ...input, createdAt: at, updatedAt: at }).returning();
      return toAnswer(row!);
    },

    async updateAnswer(id, patch, at) {
      const [row] = await db
        .update(supportApprovedAnswers)
        .set({ title: patch.title, text: patch.text, language: patch.language, updatedAt: at })
        .where(eq(supportApprovedAnswers.id, id))
        .returning();
      return row ? toAnswer(row) : null;
    },

    async deleteAnswer(id) {
      await db.delete(supportApprovedAnswers).where(eq(supportApprovedAnswers.id, id));
    },

    async insertExample({ terms, ...input }) {
      const [row] = await db
        .insert(supportExamples)
        .values(input)
        .onConflictDoNothing({ target: supportExamples.suggestionId })
        .returning({ id: supportExamples.id });
      if (!row) return;
      const words = [...new Set(terms)];
      for (let i = 0; i < words.length; i += 100) {
        await db
          .insert(supportExampleTerms)
          .values(words.slice(i, i + 100).map((term) => ({ term, exampleId: row.id })))
          .onConflictDoNothing();
      }
    },

    async searchExamples({ terms, limit }) {
      const words = [...new Set(terms)].slice(0, 40);
      if (!words.length) return [];
      const shared = count();
      const hits = await db
        .select({ exampleId: supportExampleTerms.exampleId, shared })
        .from(supportExampleTerms)
        .where(inArray(supportExampleTerms.term, words))
        .groupBy(supportExampleTerms.exampleId)
        .orderBy(desc(shared), asc(supportExampleTerms.exampleId))
        .limit(limit);
      if (!hits.length) return [];
      const rows = await examples().where(
        inArray(
          supportExamples.id,
          hits.map((h) => h.exampleId)
        )
      );
      const order = new Map(hits.map((h, i) => [h.exampleId, i]));
      return rows.map(toExample).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    },

    async recentExamples({ customerId, topic, limit }) {
      const rows = await examples()
        .where(and(customerId !== undefined ? eq(supportTickets.customerId, customerId) : undefined, topic !== undefined ? eq(supportExamples.topic, topic) : undefined))
        .orderBy(desc(supportExamples.createdAt))
        .limit(limit);
      return rows.map(toExample);
    },

    async listExamplesToLearn({ minChange, maxAttempts, limit }) {
      const rows = await examples()
        .where(and(isNull(supportExamples.lesson), gte(supportExamples.change, minChange), lt(supportExamples.lessonAttempts, maxAttempts)))
        .orderBy(asc(supportExamples.createdAt))
        .limit(limit);
      return rows.map(toExample);
    },

    async setExampleLesson(id, lesson) {
      await db
        .update(supportExamples)
        .set(lesson === null ? { lessonAttempts: sql`${supportExamples.lessonAttempts} + 1` } : { lesson })
        .where(eq(supportExamples.id, id));
    },

    async listEditedExamples({ since, minChange, limit }) {
      const rows = await examples()
        .where(and(gte(supportExamples.createdAt, since), gte(supportExamples.change, minChange)))
        .orderBy(desc(supportExamples.createdAt))
        .limit(limit);
      return rows.map(toExample);
    },

    async listGuidanceSuggestions({ status, limit }) {
      const rows = await db
        .select()
        .from(supportGuidanceSuggestions)
        .where(status ? eq(supportGuidanceSuggestions.status, status) : undefined)
        .orderBy(desc(supportGuidanceSuggestions.createdAt), asc(supportGuidanceSuggestions.id))
        .limit(limit);
      return rows.map(toGuidanceSuggestion);
    },

    async insertGuidanceSuggestion(input, at) {
      await db.insert(supportGuidanceSuggestions).values({ ...input, status: "pending", createdAt: at });
    },

    async decideGuidanceSuggestion(id, patch, at) {
      const [row] = await db
        .update(supportGuidanceSuggestions)
        .set({ status: patch.status, decidedBy: patch.decidedBy, decidedAt: at, ...(patch.rule !== undefined ? { rule: patch.rule } : {}) })
        .where(and(eq(supportGuidanceSuggestions.id, id), eq(supportGuidanceSuggestions.status, "pending")))
        .returning();
      return row ? toGuidanceSuggestion(row) : null;
    },

    async listUnanswered({ after, until, limit }) {
      const rows = await db
        .select({
          suggestionId: supportSuggestions.id,
          ticketId: supportSuggestions.ticketId,
          messageId: supportSuggestions.basedOnMessageId,
          kind: supportSuggestions.kind,
          reason: supportSuggestions.reason,
          createdAt: supportSuggestions.createdAt,
          decidedAt: supportSuggestions.decidedAt,
          flaggedAt: supportSuggestions.flaggedAt,
          flagNote: supportSuggestions.flagNote,
        })
        .from(supportSuggestions)
        .where(
          or(
            and(eq(supportSuggestions.kind, "cannot_answer"), gte(supportSuggestions.createdAt, after), lt(supportSuggestions.createdAt, until)),
            and(
              eq(supportSuggestions.kind, "draft"),
              eq(supportSuggestions.status, "discarded"),
              gte(supportSuggestions.decidedAt, after),
              lt(supportSuggestions.decidedAt, until)
            ),
            and(gte(supportSuggestions.flaggedAt, after), lt(supportSuggestions.flaggedAt, until))
          )
        )
        .orderBy(
          sql`case when ${supportSuggestions.flaggedAt} is not null then ${supportSuggestions.flaggedAt} when ${supportSuggestions.kind} = 'cannot_answer' then ${supportSuggestions.createdAt} else ${supportSuggestions.decidedAt} end`
        )
        .limit(limit);
      return rows.map((r) => ({
        suggestionId: r.suggestionId,
        ticketId: r.ticketId,
        messageId: r.messageId,
        reason: r.flaggedAt ? `An agent flagged the reply Autopilot sent as wrong${r.flagNote ? `: ${r.flagNote}` : "."}` : r.kind === "cannot_answer" ? r.reason : null,
        at: r.flaggedAt ?? (r.kind === "cannot_answer" ? r.createdAt : r.decidedAt ?? r.createdAt),
      }));
    },

    async listGaps({ statuses }) {
      if (!statuses.length) return [];
      const gaps = await db.select().from(supportGaps).where(inArray(supportGaps.status, statuses)).orderBy(asc(supportGaps.createdAt), asc(supportGaps.id)).limit(200);
      const tickets = new Map<string, { id: string; number: number; subject: string | null; seenAt: Date }[]>();
      for (let i = 0; i < gaps.length; i += 50) {
        const rows = await db
          .select({ gapId: supportGapTickets.gapId, id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject, seenAt: supportGapTickets.seenAt })
          .from(supportGapTickets)
          .innerJoin(supportTickets, eq(supportTickets.id, supportGapTickets.ticketId))
          .where(
            inArray(
              supportGapTickets.gapId,
              gaps.slice(i, i + 50).map((g) => g.id)
            )
          )
          .orderBy(desc(supportGapTickets.seenAt), desc(supportTickets.number))
          .limit(2000);
        for (const { gapId, ...ticket } of rows) tickets.set(gapId, [...(tickets.get(gapId) ?? []), ticket]);
      }
      return gaps
        .map((gap) => {
          const asked = tickets.get(gap.id) ?? [];
          return {
            id: gap.id,
            theme: gap.theme,
            status: gap.status as Gap["status"],
            count: asked.length,
            lastSeenAt: asked[0]?.seenAt ?? null,
            tickets: asked.slice(0, 3).map(({ id, number, subject }) => ({ id, number, subject })),
            createdAt: gap.createdAt,
          };
        })
        .sort((a, b) => b.count - a.count || (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0) || a.theme.localeCompare(b.theme));
    },

    async getGap(id) {
      const [row] = await db.select().from(supportGaps).where(eq(supportGaps.id, id)).limit(1);
      return row ? { id: row.id, theme: row.theme, status: row.status as Gap["status"] } : null;
    },

    async insertGap(input, at) {
      const [row] = await db.insert(supportGaps).values({ theme: input.theme, status: "open", createdAt: at }).returning({ id: supportGaps.id });
      return row!;
    },

    async addGapTicket(gapId, ticketId, at) {
      await db
        .insert(supportGapTickets)
        .values({ gapId, ticketId, seenAt: at })
        .onConflictDoUpdate({ target: [supportGapTickets.gapId, supportGapTickets.ticketId], set: { seenAt: at } });
    },

    async gapTicketIds(gapId, limit) {
      const rows = await db
        .select({ ticketId: supportGapTickets.ticketId })
        .from(supportGapTickets)
        .where(eq(supportGapTickets.gapId, gapId))
        .orderBy(desc(supportGapTickets.seenAt))
        .limit(limit);
      return rows.map((r) => r.ticketId);
    },

    async setGapStatus(id, status, decidedBy, at) {
      await db.update(supportGaps).set({ status, decidedBy, decidedAt: at }).where(eq(supportGaps.id, id));
    },

    async setSuggestionActions(id, actions) {
      await db.update(supportSuggestions).set({ actions }).where(eq(supportSuggestions.id, id));
    },

    async insertActionRun(input) {
      const [row] = await db
        .insert(supportActionRuns)
        .values({ ...input, status: "running" })
        .onConflictDoNothing({ target: supportActionRuns.idempotencyKey })
        .returning();
      return row ? toActionRun(row) : null;
    },

    async finishActionRun(id, patch, at) {
      await db
        .update(supportActionRuns)
        .set({ ...patch, error: patch.error?.slice(0, 500) ?? null, finishedAt: at })
        .where(and(eq(supportActionRuns.id, id), eq(supportActionRuns.status, "running")));
    },

    async linkActionRuns(ids, suggestionId) {
      if (ids.length) await db.update(supportActionRuns).set({ suggestionId }).where(inArray(supportActionRuns.id, ids));
    },

    async listActionRuns(input) {
      const rows = await db
        .select()
        .from(supportActionRuns)
        .where("suggestionId" in input ? eq(supportActionRuns.suggestionId, input.suggestionId) : eq(supportActionRuns.ticketId, input.ticketId))
        .orderBy(desc(supportActionRuns.createdAt), desc(supportActionRuns.id))
        .limit("limit" in input ? input.limit : 100);
      return rows.map(toActionRun);
    },

    async listAutopilotTopics() {
      const rows = await db.select().from(supportAutopilotTopics).orderBy(asc(supportAutopilotTopics.topic));
      return rows.map(toAutopilotTopic);
    },

    async saveAutopilotTopic(topic) {
      const row = { ...topic, updatedAt: new Date() };
      await db.insert(supportAutopilotTopics).values(row).onConflictDoUpdate({ target: supportAutopilotTopics.topic, set: row });
    },

    async pauseAutopilotTopic(topic, reason, at) {
      const rows = await db
        .update(supportAutopilotTopics)
        .set({ status: "paused", pauseReason: reason, pausedAt: at, updatedAt: at })
        .where(and(eq(supportAutopilotTopics.topic, topic), eq(supportAutopilotTopics.status, "on")))
        .returning({ topic: supportAutopilotTopics.topic });
      return rows.length > 0;
    },

    async listOutcomes({ since, topic, limit }) {
      const rows = await db
        .select({
          suggestionId: supportSuggestions.id,
          ticketId: supportSuggestions.ticketId,
          topic: supportSuggestions.topic,
          language: supportSuggestions.language,
          kind: supportSuggestions.kind,
          status: supportSuggestions.status,
          change: supportSuggestions.change,
          autopilot: supportSuggestions.autopilot,
          followUp: supportSuggestions.followUp,
          flaggedAt: supportSuggestions.flaggedAt,
          flagReviewedAt: supportSuggestions.flagReviewedAt,
          createdAt: supportSuggestions.createdAt,
          decidedAt: supportSuggestions.decidedAt,
        })
        .from(supportSuggestions)
        .where(and(gte(supportSuggestions.createdAt, since), topic !== undefined ? eq(supportSuggestions.topic, topic) : isNotNull(supportSuggestions.topic)))
        .orderBy(desc(supportSuggestions.createdAt), desc(supportSuggestions.id))
        .limit(limit);
      return rows.map((r) => ({
        ...r,
        kind: r.kind as OutcomeRow["kind"],
        status: r.status as SuggestionStatus,
        autopilot: r.autopilot as AutopilotState | null,
        followUp: r.followUp as OutcomeRow["followUp"],
      }));
    },

    async claimHeldSuggestion(id, at) {
      const rows = await db
        .update(supportSuggestions)
        .set({ autopilot: "sending", sendAt: at })
        .where(and(eq(supportSuggestions.id, id), eq(supportSuggestions.status, "pending"), eq(supportSuggestions.autopilot, "held")))
        .returning({ id: supportSuggestions.id });
      return rows.length > 0;
    },

    async setSuggestionAutopilot(id, patch) {
      await db
        .update(supportSuggestions)
        .set(patch)
        .where(and(eq(supportSuggestions.id, id), eq(supportSuggestions.status, "pending")));
    },

    async listHeldSuggestions({ dueBefore, limit }) {
      const rows = await db
        .select()
        .from(supportSuggestions)
        .where(and(eq(supportSuggestions.autopilot, "held"), eq(supportSuggestions.status, "pending"), lte(supportSuggestions.sendAt, dueBefore)))
        .orderBy(asc(supportSuggestions.sendAt))
        .limit(limit);
      return rows.map(toSuggestion);
    },

    async countAutopilotSent(since) {
      const [row] = await db
        .select({ sent: count() })
        .from(supportSuggestions)
        .where(and(eq(supportSuggestions.autopilot, "sent"), gte(supportSuggestions.decidedAt, since)));
      return Number(row?.sent ?? 0);
    },

    async suggestionForMessage(messageId) {
      const [row] = await db.select().from(supportSuggestions).where(eq(supportSuggestions.sentMessageId, messageId)).limit(1);
      return row ? toSuggestionRow(row) : null;
    },

    async setFollowUp(id, followUp) {
      await db
        .update(supportSuggestions)
        .set({ followUp })
        .where(and(eq(supportSuggestions.id, id), followUp === "reopened" ? isNull(supportSuggestions.followUp) : undefined));
    },

    async flagSuggestion(id, input, at) {
      const rows = await db
        .update(supportSuggestions)
        .set({ flaggedAt: at, flaggedBy: input.by, flagNote: input.note, flagReviewedAt: null })
        .where(and(eq(supportSuggestions.id, id), eq(supportSuggestions.autopilot, "sent"), isNull(supportSuggestions.flaggedAt)))
        .returning({ id: supportSuggestions.id });
      return rows.length > 0;
    },

    async reviewFlags(topic, at) {
      await db
        .update(supportSuggestions)
        .set({ flagReviewedAt: at })
        .where(and(eq(supportSuggestions.topic, topic), isNotNull(supportSuggestions.flaggedAt), isNull(supportSuggestions.flagReviewedAt)));
    },
  };
  return store;
}

function toSettings(row: typeof supportAiSettings.$inferSelect): AiSettings {
  return {
    guidance: row.guidance,
    topics: row.topics,
    draftOnArrival: row.draftOnArrival,
    knowledgeSyncedAt: row.knowledgeSyncedAt,
    memoryRunAt: row.memoryRunAt,
    memoryCursor: row.memoryCursor,
    disabledActions: row.disabledActions,
    autopilotStoppedAt: row.autopilotStoppedAt,
    autopilotStoppedBy: row.autopilotStoppedBy,
    autopilotMinDrafts: row.autopilotMinDrafts,
    autopilotMinRate: row.autopilotMinRate,
  };
}

function toAutopilotTopic(row: typeof supportAutopilotTopics.$inferSelect): AutopilotTopic {
  return {
    topic: row.topic,
    mode: row.mode === "immediate" ? "immediate" : "hold",
    status: row.status as AutopilotTopic["status"],
    enabledBy: row.enabledBy,
    enabledAt: row.enabledAt,
    pausedAt: row.pausedAt,
    pauseReason: row.pauseReason as AutopilotTopic["pauseReason"],
  };
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
    actions: row.actions,
    status: row.status as SuggestionStatus,
    topic: row.topic,
    language: row.language,
    autopilot: row.autopilot as AutopilotState | null,
    sendAt: row.sendAt,
    autopilotBlock: row.autopilotBlock as AutopilotBlock | null,
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
    change: row.change,
    followUp: row.followUp as SuggestionRow["followUp"],
    flaggedAt: row.flaggedAt,
    flaggedBy: row.flaggedBy,
    flagNote: row.flagNote,
  };
}

function toAnswer(row: typeof supportApprovedAnswers.$inferSelect): ApprovedAnswer {
  return row;
}

function toExample({ example, customerId }: { example: typeof supportExamples.$inferSelect; customerId: string | null }): ExampleRow {
  return {
    id: example.id,
    suggestionId: example.suggestionId,
    ticketId: example.ticketId,
    customerId,
    topic: example.topic,
    language: example.language,
    question: example.question,
    draft: example.draft,
    final: example.final,
    change: example.change,
    lesson: example.lesson,
    createdAt: example.createdAt,
  };
}

function toGuidanceSuggestion(row: typeof supportGuidanceSuggestions.$inferSelect): GuidanceSuggestion {
  return { id: row.id, rule: row.rule, reason: row.reason, ticketIds: row.ticketIds, status: row.status as GuidanceSuggestion["status"], createdAt: row.createdAt };
}

function toActionRun(row: typeof supportActionRuns.$inferSelect): ActionRun {
  return {
    id: row.id,
    ticketId: row.ticketId,
    suggestionId: row.suggestionId,
    action: row.action,
    title: row.title,
    input: row.input,
    trigger: row.trigger as ActionRun["trigger"],
    status: row.status as ActionRun["status"],
    summary: row.summary,
    data: row.data ?? null,
    approvedBy: row.approvedBy,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}
