import { describe, expect, it } from "vitest";
import type { SupportAiOptions } from "../registry/support/ai";
import { LIGHT_EDIT, editWeight } from "../registry/support/autopilot";
import { SPIKE_DEFAULTS, daySeries, distribution, distributionFromRanks, usualVolume } from "../registry/support/insights";
import type { SupportNotification } from "../registry/support/service";
import { DAY, HOUR, fakeChannel, inbound, setup } from "./helpers";
import { DRAFT, UNDERSTOOD, setupAi } from "./ai-helpers";

/*
 * Insights: the dashboard's numbers against fixtures worked out by hand, the comparison with the
 * period before, and the spike detector. Runs on Postgres and again on SQLite (TENDKIT_STORE=d1).
 */

const MINUTE = 60_000;
const at = (iso: string) => new Date(`${iso}:00Z`);

describe("percentiles", () => {
  it("picks the same median and p90 from four ranked rows as from the whole list", () => {
    for (let n = 1; n <= 23; n++) {
      // Uneven gaps, so a rank that is off by one gives a different answer.
      const values = Array.from({ length: n }, (_, i) => i * i * 7 + i);
      const ranks = new Set([5, 9].flatMap((tenths) => [Math.floor(((n - 1) * tenths) / 10) + 1, Math.floor(((n - 1) * tenths) / 10) + 2]));
      const rows = values.map((value, i) => ({ rank: i + 1, value, n })).filter((row) => ranks.has(row.rank));
      expect(distributionFromRanks(rows), `n = ${n}`).toEqual(distribution(values));
    }
    expect(distribution([40, 10, 30, 20])).toEqual({ count: 4, median: 25, p90: 37 });
    expect(distribution([])).toEqual({ count: 0, median: null, p90: null });
  });
});

describe("the dashboard's numbers", () => {
  /**
   * Two weeks of support, written out so every number can be checked by hand.
   *
   * The week before (Oct 25 to Nov 1):
   *   P1  Lumen      answered and solved after 60 min by Priya; reopened by the customer on Nov 6
   *   P2  Northwind  answered after 120 min by Daniel, still waiting on the customer
   *   P3  Lumen      answered and solved after 30 min by Priya
   * The week itself (Nov 1 to Nov 8), "now" being Nov 7, 09:00:
   *   A   Northwind  Nov 2  answered and solved after 10 min by Daniel
   *   B   Lumen      Nov 2  answered after 20 min by Daniel, solved by his second reply a day later
   *   C   Northwind  Nov 3  answered after 30 min by Priya, solved by her third reply at 90 min
   *   D   unknown    Nov 4  on the sales address, answered after 40 min by Priya, waiting
   *   E   unknown    Nov 5  never answered
   */
  async function twoWeeks() {
    let clock = at("2026-10-27T10:00");
    const sales = fakeChannel({ id: "sales", address: "sales@acme.test", replyAddress: "sales@in.acme.test" });
    const email = fakeChannel();
    const t = await setup({ now: () => clock }, [email.channel, sales.channel]);
    const open = async (when: string, from: string, channel = "email") => {
      clock = at(when);
      const result = await t.support.ingest(channel, { type: "message", message: inbound({ from, receivedAt: clock, to: [{ address: `${channel === "email" ? "support" : "sales"}@acme.test` }] }) });
      return (result as { ticketId: string }).ticketId;
    };
    const reply = async (ticketId: string, when: string, agentId: string, status: "waiting" | "solved" | "open" = "waiting") => {
      clock = at(when);
      return (await t.support.reply({ ticketId, agentId, text: "Here is what happened.", status })).message;
    };

    const p1 = await open("2026-10-27T10:00", "lucas@lumen.test");
    const p1Reply = await reply(p1, "2026-10-27T11:00", "agent_k", "solved");
    const p2 = await open("2026-10-28T10:00", "emma@northwind.test");
    await reply(p2, "2026-10-28T12:00", "agent_a");
    const p3 = await open("2026-10-29T10:00", "lucas@lumen.test");
    await reply(p3, "2026-10-29T10:30", "agent_k", "solved");

    const a = await open("2026-11-02T09:00", "emma@northwind.test");
    await reply(a, "2026-11-02T09:10", "agent_a", "solved");
    const b = await open("2026-11-02T12:00", "lucas@lumen.test");
    await reply(b, "2026-11-02T12:20", "agent_a");
    await reply(b, "2026-11-03T12:00", "agent_a", "solved");
    const c = await open("2026-11-03T09:00", "yusuf@northwind.test");
    await reply(c, "2026-11-03T09:30", "agent_k", "open");
    await reply(c, "2026-11-03T10:00", "agent_k", "open");
    await reply(c, "2026-11-03T10:30", "agent_k", "solved");
    const d = await open("2026-11-04T09:00", "dana@shop.test", "sales");
    await reply(d, "2026-11-04T09:40", "agent_k");
    const e = await open("2026-11-05T09:00", "omar@studio.test");

    // The customer answers the reply that solved P1, ten days later: the ticket reopens.
    clock = at("2026-11-06T10:00");
    await t.support.ingest("email", { type: "message", message: inbound({ from: "lucas@lumen.test", receivedAt: clock, inReplyTo: p1Reply.rfcMessageId, subject: "Re: Payout not received" }) });

    clock = at("2026-11-07T09:00");
    const stats = await t.support.stats({ from: at("2026-11-01T00:00"), to: at("2026-11-08T00:00"), responseTargetMinutes: 25 });
    return { t, stats, ids: { p1, p2, p3, a, b, c, d, e } };
  }

  it("matches the fixture: speed, breaches, solves, replies and reopens", async () => {
    const { stats, ids } = await twoWeeks();
    // First replies took 10, 20, 30 and 40 minutes; E has none. The acknowledgement each known customer got isn't a reply.
    expect(stats.current.opened).toBe(5);
    expect(stats.current.firstReply).toEqual({ count: 4, median: 25 * MINUTE, p90: 37 * MINUTE });
    // Solved after 10 minutes, 90 minutes and 24 hours: the p90 sits 80% of the way from 90 to 1440.
    expect(stats.current.solved).toBe(3);
    expect(stats.current.timeToSolve).toEqual({ count: 3, median: 90 * MINUTE, p90: 1170 * MINUTE });
    // One, two and three replies.
    expect(stats.current).toMatchObject({ answered: 3, replies: 6, oneReply: 1, reopened: 1 });
    // Against 25 minutes: C and D were answered late, and E is still waiting.
    expect(stats.current.breaches).toBe(3);
    expect(stats.late.map((ticket) => [ticket.id, ticket.waitedMs, ticket.answered])).toEqual([
      [ids.e, 48 * HOUR, false],
      [ids.d, 40 * MINUTE, true],
      [ids.c, 30 * MINUTE, true],
    ]);
    expect(stats.reopened.map((ticket) => ticket.id)).toEqual([ids.p1]);
    expect(stats.reopened[0]!.at).toEqual(at("2026-11-06T10:00"));
  });

  it("compares with the period before, which has the same length", async () => {
    const { stats } = await twoWeeks();
    expect(stats.previousFrom).toEqual(at("2026-10-25T00:00"));
    // P1 no longer counts as solved: it was reopened. Its first reply still does.
    expect(stats.previous).toMatchObject({ opened: 3, solved: 1, reopened: 0, answered: 1, replies: 1, oneReply: 1 });
    expect(stats.previous.firstReply).toEqual({ count: 3, median: 60 * MINUTE, p90: 108 * MINUTE });
    expect(stats.previous.timeToSolve).toEqual({ count: 1, median: 30 * MINUTE, p90: 30 * MINUTE });
    // All three waited longer than 25 minutes for their first reply.
    expect(stats.previous.breaches).toBe(3);
  });

  it("gives each day its volume and the backlog it ended with, by channel", async () => {
    const { stats } = await twoWeeks();
    expect(stats.days.map((day) => day.opened)).toEqual([0, 2, 1, 1, 1, 0, 0]);
    expect(stats.days.map((day) => day.solved)).toEqual([0, 1, 2, 0, 0, 0, 0]);
    // Open or waiting now: P1, P2, D and E. Walked back a day at a time.
    expect(stats.days.map((day) => day.backlog)).toEqual([2, 3, 2, 3, 4, 4, 4]);
    expect(stats.channels.map((channel) => [channel.id, channel.address, channel.opened, channel.solved])).toEqual([
      ["email", "support@acme.test", 4, 3],
      ["sales", "sales@acme.test", 1, 0],
    ]);
    expect(stats.channels[1]!.days.map((day) => day.backlog)).toEqual([0, 0, 0, 1, 1, 1, 1]);
  });

  it("shows each agent's load and the customers who wrote most", async () => {
    const { stats } = await twoWeeks();
    expect(stats.agents.map((row) => [row.agent?.name ?? null, row.open, row.waiting, row.solved, row.solvedBefore])).toEqual([
      ["Priya", 1, 1, 1, 1],
      [null, 1, 0, 0, 0],
      ["Daniel Kim", 0, 1, 2, 0],
    ]);
    // People nobody matched to a customer (D and E) aren't a customer.
    expect(stats.customers.map((row) => [row.customer.name, row.tickets, row.before])).toEqual([
      ["Northwind Coffee", 2, 1],
      ["Lumen Labs", 1, 2],
    ]);
  });

  it("measures a period that ended in the past as it stood then", async () => {
    const { t } = await twoWeeks();
    const earlier = await t.support.stats({ from: at("2026-10-25T00:00"), to: at("2026-11-01T00:00") });
    // The backlog is rebuilt from when tickets were last solved: P1, reopened since, reads as open
    // next to P2. Without a target there are no breaches to count.
    expect(earlier.days.at(-1)!.backlog).toBe(2);
    expect(earlier.current.breaches).toBeNull();
    expect(earlier.late).toEqual([]);
    await expect(t.support.stats({ from: at("2026-11-08T00:00"), to: at("2026-11-01T00:00") })).rejects.toThrow("Choose a period");
  });

  it("builds the backlog back from what is open at the end", () => {
    const series = daySeries(
      [
        { day: 0, opened: 3, solved: 1 },
        { day: 2, opened: 1, solved: 4 },
      ],
      3,
      5
    );
    // Day 2 ended with 5; before it opened 1 and solved 4 there were 8, on both earlier days' ends.
    expect(series.map((day) => day.backlog)).toEqual([8, 8, 5]);
  });
});

describe("insights with AI", () => {
  const tagged = (text: string) => /\[(\w+)\]/.exec(text)?.[1] ?? "other";

  async function setupInsights(start: string, spikes?: SupportAiOptions["spikes"]) {
    let clock = at(start);
    const notifications: SupportNotification[] = [];
    const t = await setupAi({
      // The topic is whatever the message is tagged with; angry customers say so.
      fast: (call) =>
        call.system.startsWith("You triage")
          ? { ...UNDERSTOOD, topic: tagged(call.prompt), mood: call.prompt.includes("unacceptable") ? "frustrated" : "calm", urgency: call.prompt.includes("unacceptable") ? "high" : "normal" }
          : "none",
      support: { now: () => clock, notify: async (n) => void notifications.push(n) },
      ai: spikes === undefined ? {} : { spikes },
    });
    let n = 0;
    return {
      ...t,
      notifications,
      set: (when: string | Date) => (clock = typeof when === "string" ? at(when) : when),
      clock: () => clock,
      /** A new ticket on a topic, from a sender nobody knows unless `from` says otherwise. */
      async ask(topic: string, from?: string, text = "Where is it?") {
        n++;
        return t.receive({ from: from ?? `person${n}@shop${n}.test`, subject: `Question ${n}`, text: `[${topic}] ${text}`, receivedAt: clock });
      },
      /** A ticket with its topic set by hand: no model call, for history. */
      async filed(topic: string, when: Date) {
        n++;
        const ticketId = await t.receive({ from: `person${n}@shop${n}.test`, subject: `Question ${n}`, receivedAt: when });
        await t.support.ai.setInsight({ ticketId, topic, actorId: "agent_a" });
        return ticketId;
      },
    };
  }

  it("counts topics, mood and urgency per period, and what became of each draft", async () => {
    const t = await setupInsights("2026-11-02T10:00");
    await t.ask("payouts");
    await t.support.runScheduled();

    // Nov 3: two payout tickets and two billing ones with a draft each, then a billing one without.
    t.set("2026-11-03T09:00");
    const [asIs, polished, rewritten, ignored] = [await t.ask("payouts", undefined, "This is unacceptable."), await t.ask("payouts"), await t.ask("billing"), await t.ask("billing")];
    await t.support.runScheduled();
    const draft = async (ticketId: string) => (await t.support.getTicket(ticketId, "agent_a")).suggestion!.id;
    const light = DRAFT.text.replace("Hi Emma", "Hello Emma");
    expect(editWeight(DRAFT.text, light)).toBeLessThan(LIGHT_EDIT);

    t.set("2026-11-03T09:05");
    await t.support.reply({ ticketId: asIs, agentId: "agent_a", text: DRAFT.text, suggestionId: await draft(asIs) });
    t.set("2026-11-03T09:15");
    await t.support.reply({ ticketId: polished, agentId: "agent_a", text: light, suggestionId: await draft(polished) });
    t.set("2026-11-03T09:25");
    await t.support.reply({ ticketId: rewritten, agentId: "agent_a", text: "We refunded invoice 1042 this morning. You'll see it within 5 days.", suggestionId: await draft(rewritten) });
    t.set("2026-11-03T10:00");
    await t.support.reply({ ticketId: ignored, agentId: "agent_a", text: "I've asked our billing team and will come back to you." });

    await t.support.ai.updateSettings({ draftOnArrival: false });
    t.set("2026-11-03T11:00");
    const undrafted = await t.ask("billing");
    await t.support.runScheduled();
    t.set("2026-11-03T11:50");
    await t.support.reply({ ticketId: undrafted, agentId: "agent_a", text: "Your invoice is attached." });

    const insights = await t.support.ai.insights({ from: at("2026-11-03T00:00"), to: at("2026-11-04T00:00") });
    expect(insights.topics).toEqual([
      // Two billing drafts were decided: one rewritten, one left unused.
      { topic: "billing", tickets: 3, before: 0, days: [3], drafts: 2, accepted: 0 },
      { topic: "payouts", tickets: 2, before: 1, days: [2], drafts: 2, accepted: 2 },
    ]);
    expect(insights.urgency).toEqual({ current: { urgent: 0, high: 1, normal: 4, low: 0 }, previous: { urgent: 0, high: 0, normal: 1, low: 0 } });
    expect(insights.mood.current).toEqual({ calm: 4, confused: 0, frustrated: 1, angry: 0 });
    expect(insights.mood.days).toEqual([insights.mood.current]);
    expect(insights.drafts.current).toEqual({ usedAsIs: 1, lightlyEdited: 1, rewritten: 1, discarded: 1, autopilotSent: 0, autopilotFlagged: 0 });
    // The draft made on Nov 2 was never decided: it counts nowhere.
    expect(insights.drafts.previous).toEqual({ usedAsIs: 0, lightlyEdited: 0, rewritten: 0, discarded: 0, autopilotSent: 0, autopilotFlagged: 0 });
    // With a draft ready: 5, 15, 25 and 60 minutes. Without: 50.
    expect(insights.firstReply.withDraft).toEqual({ count: 4, median: 20 * MINUTE, p90: 49.5 * MINUTE });
    expect(insights.firstReply.withoutDraft).toEqual({ count: 1, median: 50 * MINUTE, p90: 50 * MINUTE });
  });

  it("counts the replies Autopilot sent and the ones agents flagged", async () => {
    const t = await setupInsights("2026-11-03T09:00");
    const ticketId = await t.ask("payouts", "emma@northwind.test");
    await t.support.runScheduled();
    const pending = (await t.support.getTicket(ticketId, "agent_a")).suggestion!;
    await t.aiStore.decideSuggestion(pending.id, { status: "used", autopilot: "sent" }, t.clock());
    t.set("2026-11-03T09:30");
    await t.support.ai.flagAutopilotReply({ suggestionId: pending.id, actorId: "agent_k" });
    const insights = await t.support.ai.insights({ from: at("2026-11-03T00:00"), to: at("2026-11-04T00:00") });
    expect(insights.drafts.current).toMatchObject({ usedAsIs: 0, autopilotSent: 1, autopilotFlagged: 1 });
  });

  describe("spikes", () => {
    it("records one when five different customers raise a topic within two hours, and announces it once", async () => {
      const t = await setupInsights("2026-11-03T09:00");
      // An older payout ticket and a billing one: neither belongs to the burst.
      await t.filed("payouts", at("2026-11-01T15:00"));
      const billing = await t.ask("billing");
      const burst: string[] = [];
      for (let i = 0; i < 5; i++) {
        t.set(new Date(at("2026-11-03T09:00").getTime() + i * 10 * MINUTE));
        burst.push(await t.ask("payouts"));
      }
      const summary = await t.support.runScheduled();
      expect(summary.ai).toMatchObject({ spikes: { detected: 1, ended: 0 } });
      const spikes = t.notifications.filter((n) => n.type === "insights.spike");
      expect(spikes).toHaveLength(1);
      expect(spikes[0]).toMatchObject({ spike: { topic: "payouts", tickets: 5, customers: 5, usual: 0, startedAt: at("2026-11-03T09:00") } });

      // The next runs see the same burst: nothing new is announced, and a sixth customer is added to it.
      t.set("2026-11-03T10:00");
      await t.ask("payouts");
      await t.support.runScheduled();
      await t.support.runScheduled();
      expect(t.notifications.filter((n) => n.type === "insights.spike")).toHaveLength(1);
      const [spike] = await t.support.ai.listSpikes();
      expect(spike).toMatchObject({ topic: "payouts", tickets: 6, customers: 6, endedAt: null, acknowledgedBy: null });
      // Its tickets: the topic's, opened since it started. Not the billing one, not Nov 1's.
      expect(spike!.latest).toHaveLength(5);
      expect(spike!.latest.every((ticket) => ticket.id !== billing)).toBe(true);
      const { items, total } = await t.support.listTickets({ topic: "payouts", createdFrom: spike!.startedAt, sort: "recent", limit: 25, offset: 0 }, "agent_a");
      expect(total).toBe(6);
      expect(burst.every((id) => items.some((ticket) => ticket.id === id))).toBe(true);
    });

    it("needs different customers: colleagues at one company count once, and so does a repeat sender", async () => {
      const t = await setupInsights("2026-11-03T09:00");
      for (const from of ["emma@northwind.test", "yusuf@northwind.test", "emma@northwind.test", "lucas@lumen.test", "lucas@lumen.test", undefined, undefined]) {
        // Each as a ticket of its own: a customer's second email would otherwise join their first.
        await t.ask("payouts", from, `Question about ${Math.random()}`);
        t.set(new Date(t.clock().getTime() + 15 * DAY));
      }
      // Seven tickets, but spread over months. Now seven in one hour from four customers.
      t.set("2027-06-01T09:00");
      for (const [i, from] of ["emma@northwind.test", "yusuf@northwind.test", "lucas@lumen.test", undefined, undefined].entries()) {
        t.set(new Date(at("2027-06-01T09:00").getTime() + i * MINUTE));
        await t.ask("payouts", from);
      }
      await t.support.runScheduled();
      expect((await t.aiStore.topicActivity({ since: at("2027-06-01T08:00"), until: at("2027-06-01T10:00") }))[0]).toMatchObject({ tickets: 5, customers: 4 });
      expect(await t.support.ai.listSpikes()).toEqual([]);
    });

    it("leaves a busy topic alone until it is well above its usual volume for the time of day", async () => {
      const t = await setupInsights("2026-11-20T10:00");
      const now = at("2026-11-20T10:00");
      // For two weeks: two payout tickets every morning around this time, and four every evening.
      for (let day = 1; day <= 14; day++) {
        for (const minutes of [30, 90]) await t.filed("payouts", new Date(now.getTime() - day * DAY - minutes * MINUTE));
        for (const hours of [9, 9.5, 10, 10.5]) await t.filed("payouts", new Date(now.getTime() - day * DAY + hours * HOUR));
      }
      // Five customers this morning: 2.5 times the usual two, under the factor of three.
      for (let i = 0; i < 5; i++) await t.filed("payouts", new Date(now.getTime() - (i + 1) * 10 * MINUTE));
      expect(await t.support.ai.detectSpikes()).toBeUndefined();
      // A sixth makes it three times the usual.
      await t.filed("payouts", new Date(now.getTime() - MINUTE));
      expect(await t.support.ai.detectSpikes()).toEqual({ detected: 1, ended: 0 });
      expect((await t.support.ai.listSpikes())[0]).toMatchObject({ topic: "payouts", tickets: 6, customers: 6, usual: 2 });
    });

    it("never calls the catch-all topic a spike, and can be switched off", async () => {
      const t = await setupInsights("2026-11-03T09:00");
      for (let i = 0; i < 6; i++) await t.ask("other");
      await t.support.runScheduled();
      expect(await t.support.ai.listSpikes()).toEqual([]);

      const off = await setupInsights("2026-11-03T09:00", false);
      for (let i = 0; i < 6; i++) await off.ask("payouts");
      expect((await off.support.runScheduled()).ai).not.toHaveProperty("spikes");
      expect(off.notifications.filter((n) => n.type === "insights.spike")).toEqual([]);
    });

    it("ends after a quiet window, stays acknowledged by whoever saw it first, and starts fresh next time", async () => {
      const t = await setupInsights("2026-11-03T09:00", { minCustomers: 3 });
      const burst = async () => {
        for (let i = 0; i < 3; i++) await t.filed("billing", t.clock());
        return t.support.ai.detectSpikes();
      };
      expect(await burst()).toEqual({ detected: 1, ended: 0 });
      const first = (await t.support.ai.listSpikes())[0]!;

      // An hour on, the three tickets are still inside the window. Past two hours they aren't, but
      // the spike only ends once a whole window has gone by without it.
      t.set("2026-11-03T10:00");
      expect(await t.support.ai.detectSpikes()).toBeUndefined();
      t.set("2026-11-03T11:30");
      expect(await t.support.ai.detectSpikes()).toBeUndefined();
      expect((await t.support.ai.listSpikes())[0]).toMatchObject({ id: first.id, endedAt: null, lastSeenAt: at("2026-11-03T10:00") });
      t.set("2026-11-03T12:00");
      expect(await t.support.ai.detectSpikes()).toEqual({ detected: 0, ended: 1 });

      // Ended but unacknowledged, it still shows: an incident overnight is news in the morning.
      expect((await t.support.ai.listSpikes())[0]).toMatchObject({ id: first.id, endedAt: at("2026-11-03T12:00") });
      const seen = await t.support.ai.acknowledgeSpike({ id: first.id, actorId: "agent_a" });
      expect(seen).toMatchObject({ acknowledgedAt: at("2026-11-03T12:00"), acknowledgedBy: { id: "agent_a", name: "Daniel Kim" } });
      t.set("2026-11-03T12:05");
      expect(await t.support.ai.acknowledgeSpike({ id: first.id, actorId: "agent_k" })).toMatchObject({ acknowledgedAt: at("2026-11-03T12:00"), acknowledgedBy: { id: "agent_a" } });
      expect(await t.support.ai.listSpikes()).toEqual([]);
      expect((await t.support.ai.listSpikes({ all: true })).map((spike) => spike.id)).toEqual([first.id]);
      await expect(t.support.ai.acknowledgeSpike({ id: first.id, actorId: "" })).rejects.toThrow("needs to know who");

      // The next day the same topic bursts again: a new spike, announced again. Yesterday's three
      // tickets at another hour don't raise what is usual for this one.
      t.set("2026-11-04T15:00");
      expect(await burst()).toEqual({ detected: 1, ended: 0 });
      const spikes = await t.support.ai.listSpikes({ all: true });
      expect(spikes.map((spike) => [spike.id === first.id, spike.tickets, spike.acknowledgedBy?.id ?? null])).toEqual([
        [false, 3, null],
        [true, 3, "agent_a"],
      ]);
      expect(t.notifications.filter((n) => n.type === "insights.spike")).toHaveLength(2);
      // The dashboard lists both for a period that holds them.
      const insights = await t.support.ai.insights({ from: at("2026-11-03T00:00"), to: at("2026-11-05T00:00") });
      expect(insights.spikes.map((spike) => spike.latest.length)).toEqual([3, 3]);
    });

    it("judges the usual volume by the same hours of earlier days", () => {
      const now = at("2026-11-20T10:00");
      const ago = (days: number, minutes: number) => new Date(now.getTime() - days * DAY - minutes * MINUTE);
      const times = [
        ago(1, 0), // exactly a day ago: the window's edge, counted
        ago(1, 119),
        ago(1, 120), // just outside yesterday's window
        ago(1, -60), // an hour later in the day than now
        ago(14, 5),
        ago(15, 5), // older than the baseline
        ago(0, 30), // inside the window being judged
      ];
      expect(usualVolume(times, now, SPIKE_DEFAULTS)).toBe(3 / 14);
    });
  });
});
