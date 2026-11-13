import { describe, expect, it } from "vitest";
import { safeLesson } from "../registry/support/memory";
import type { SupportAiOptions } from "../registry/support/ai";
import { DAY, HOUR } from "./helpers";
import { DRAFT, UNDERSTOOD, setupAi, type Call } from "./ai-helpers";

/*
 * Memory: approved answers, what agents' edits teach, guidance suggestions, gaps and articles.
 * Runs on Postgres and on SQLite/D1.
 */

const LESSON = "Open with what was already done, then explain the policy briefly.";

type Script = Partial<Record<"triage" | "lesson" | "gaps" | "generalise" | "draft" | "review" | "article", (call: Call) => unknown>>;

/** One scripted answer per kind of model call, told apart by the instructions each one starts with. */
async function setupMemory(script: Script = {}, ai: Partial<SupportAiOptions> = {}) {
  const t = await setupAi({
    ai,
    fast: (call) => {
      if (call.system.startsWith("You triage")) return script.triage?.(call) ?? UNDERSTOOD;
      if (call.system.startsWith("A support agent changed")) return script.lesson?.(call) ?? LESSON;
      if (call.system.includes("couldn't answer these")) return script.gaps?.(call) ?? { questions: [] };
      if (call.system.startsWith("You turn a reply")) return script.generalise?.(call) ?? { title: "", text: "" };
      throw new Error(`unexpected fast call: ${call.system.slice(0, 40)}`);
    },
    main: (call) => {
      if (call.system.startsWith("You review how")) return script.review?.(call) ?? { proposals: [] };
      if (call.system.startsWith("You write a help-center")) return script.article?.(call) ?? { kind: "not_enough", title: "", markdown: "" };
      return script.draft?.(call) ?? DRAFT;
    },
  });
  const ask = async (from: string, text: string, subject = "A question") => {
    const ticketId = await t.receive({ from, subject, text });
    await t.support.runScheduled();
    return ticketId;
  };
  /** A customer asks, Copilot drafts, and the agent sends something else. */
  const corrected = async (from: string, text: string, sent: string, subject?: string) => {
    const ticketId = await ask(from, text, subject);
    const { suggestion } = await t.support.getTicket(ticketId, "agent_a");
    await t.support.reply({ ticketId, agentId: "agent_a", text: sent, suggestionId: suggestion!.id });
    return ticketId;
  };
  const drafts = () => t.main.calls.filter((c) => c.system.startsWith("You write replies"));
  const calls = (kind: "lesson" | "gaps" | "review" | "article") =>
    kind === "lesson"
      ? t.fast.calls.filter((c) => c.system.startsWith("A support agent changed"))
      : kind === "gaps"
        ? t.fast.calls.filter((c) => c.system.includes("couldn't answer these"))
        : t.main.calls.filter((c) => c.system.startsWith(kind === "review" ? "You review how" : "You write a help-center"));
  return { ...t, ask, corrected, drafts, calls };
}

const LUMEN_SENT = "Bonjour Lucas, the refund of 4,870 euros for order LUMEN-7781 went back to the card ending 4242 on Tuesday. Lumen Labs stays on Starter.";

describe("learning from corrections", () => {
  it("never puts one customer's details into another customer's draft, only what the edit teaches about style", async () => {
    const t = await setupMemory();
    await t.corrected("lucas@lumen.test", "Where did the refund for order LUMEN-7781 go?", LUMEN_SENT, "Refund for LUMEN-7781");
    const run = await t.support.runScheduled();
    expect(run.ai).toMatchObject({ memory: { lessons: 1 } });

    await t.ask("emma@northwind.test", "Where does a refund go once it's approved?", "Refund question");
    const other = t.drafts().at(-1)!;
    expect(other.prompt).toContain(`<style_notes>\n- ${LESSON}\n</style_notes>`);
    const everything = `${other.system}\n${other.prompt}`;
    for (const detail of ["4,870", "LUMEN-7781", "4242", "Lucas", "Lumen", "Bonjour", "secret-lumen-detail"]) {
      expect(everything).not.toContain(detail);
    }
    expect(other.prompt).not.toContain("<past_replies>");

    // Lumen's own next ticket gets its earlier reply as it was sent: their data serves them.
    await t.ask("lucas@lumen.test", "Another refund is due, where will it go?", "Second refund");
    const own = t.drafts().at(-1)!;
    expect(own.prompt).toContain("<past_replies>");
    expect(own.prompt).toContain("card ending 4242");
    expect(own.system).not.toContain("4242");
  });

  it("drops a lesson that carries a detail, however the model was asked", async () => {
    const t = await setupMemory({ lesson: () => "Mention Lumen Labs and the 4,870 euro refund before anything else." });
    await t.corrected("lucas@lumen.test", "Where did the refund for order LUMEN-7781 go?", LUMEN_SENT, "Refund");
    await t.support.runScheduled();
    await t.ask("emma@northwind.test", "Where does a refund go once it's approved?", "Refund question");
    expect(t.drafts().at(-1)!.prompt).not.toContain("<style_notes>");
    // It was judged once, not asked for again.
    await t.support.runScheduled();
    expect(t.calls("lesson")).toHaveLength(1);

    const from = { texts: ["Where did the refund go?", "Refunds go back to the card you paid with, usually within five days."], names: ["Lucas Martin", "Lumen Labs", "lucas@lumen.test"] };
    expect(safeLesson("Lead with the outcome, then the policy.", from)).toBe("Lead with the outcome, then the policy.");
    expect(safeLesson("Tell lucas first.", from)).toBe("");
    expect(safeLesson("Say it arrives within 5 days.", from)).toBe("");
    expect(safeLesson("Point them to https://acme.test/refunds.", from)).toBe("");
    expect(safeLesson("Always say refunds go back to the card you paid with.", from)).toBe("");
    expect(safeLesson("None.", from)).toBe("");
  });

  it("gives a sender who isn't linked to a customer style notes only, and keeps corrections within a customer when asked to", async () => {
    const open = await setupMemory();
    await open.corrected("jordan@elsewhere.test", "Where does a refund go once approved?", "It goes back to the card you paid with. Reference R-99812.", "Refund");
    await open.support.runScheduled();
    await open.ask("jordan@elsewhere.test", "Where does my other refund go?", "Refund again");
    const unlinked = open.drafts().at(-1)!.prompt;
    expect(unlinked).toContain(LESSON);
    expect(unlinked).not.toContain("R-99812");

    const strict = await setupMemory({}, { shareStyleNotes: false });
    await strict.corrected("lucas@lumen.test", "Where did the refund go?", LUMEN_SENT, "Refund");
    await strict.support.runScheduled();
    await strict.ask("emma@northwind.test", "Where does a refund go once it's approved?", "Refund question");
    expect(strict.drafts().at(-1)!.prompt).not.toContain("<style_notes>");
    await strict.ask("lucas@lumen.test", "Where will the next refund go?", "Refund again");
    expect(strict.drafts().at(-1)!.prompt).toContain(LESSON);
  });

  it("finds earlier corrections by the question's words and by topic, and by meaning with an embedder", async () => {
    const lessons: Record<string, string> = {
      payout: "Say when the money left before anything else.",
      invoice: "Confirm the correction in the first line.",
      export: "Give the workaround first and the cause after.",
    };
    const script: Script = {
      lesson: (call) => Object.entries(lessons).find(([word]) => call.prompt.slice(call.prompt.indexOf("<sent>")).includes(word))![1],
      triage: (call) => {
        const said = call.prompt.slice(call.prompt.lastIndexOf('from="customer"'));
        return { ...UNDERSTOOD, topic: /invoice|receipt/.test(said) ? "billing" : /payout/.test(said) ? "payouts" : "other" };
      },
    };
    const seed = async (t: Awaited<ReturnType<typeof setupMemory>>) => {
      await t.corrected("emma@northwind.test", "Our payout hasn't reached the bank.", "The payout left on Monday and lands by Thursday.", "Payout late");
      await t.corrected("emma@northwind.test", "The invoice shows our old address.", "The invoice is corrected and ready to download.", "Invoice address");
      await t.corrected("yusuf@northwind.test", "The spreadsheet export stops after a thousand rows.", "Use the export filter by month for now; the row limit is being raised.", "Export limit");
      await t.support.runScheduled();
    };

    const t = await setupMemory(script);
    await seed(t);
    await t.ask("lucas@lumen.test", "Half the rows are gone from our spreadsheet export.", "Rows gone");
    expect(t.drafts().at(-1)!.prompt).toContain(`<style_notes>\n- ${lessons.export}\n</style_notes>`);
    // No shared words here: the topic finds it.
    await t.ask("lucas@lumen.test", "Can you resend last month's receipt?", "Receipt");
    expect(t.drafts().at(-1)!.prompt).toContain(`<style_notes>\n- ${lessons.invoice}\n</style_notes>`);

    let down = false;
    const embedded = await setupMemory(script, {
      embedder: {
        async embed(texts) {
          if (down) throw new Error("embedder is down");
          return texts.map((text, i) => (i === 0 || text.includes("payout") ? [1, 0] : [0, 1]));
        },
      },
    });
    await seed(embedded);
    // Words find two corrections and put the export first; the embedder says only the payout one is close.
    const question = "Our spreadsheet export is missing rows for the payout report.";
    await embedded.ask("lucas@lumen.test", question, "Rows gone");
    expect(embedded.drafts().at(-1)!.prompt).toContain(`<style_notes>\n- ${lessons.payout}\n</style_notes>`);
    down = true;
    await embedded.ask("lucas@lumen.test", question, "Rows again");
    expect(embedded.drafts().at(-1)!.prompt).toContain(`<style_notes>\n- ${lessons.export}\n- ${lessons.payout}\n</style_notes>`);
  });

  it("never lets a failing model or store break a reply or the schedule, and stops asking after three attempts", async () => {
    const t = await setupMemory({
      lesson: () => {
        throw new Error("model is down");
      },
      review: () => {
        throw new Error("model is down");
      },
      gaps: () => ({ questions: [{ n: 1, gap: "", theme: "Refund destination" }] }),
    });
    const insert = t.aiStore.insertExample;
    t.aiStore.insertExample = async () => {
      throw new Error("no such table: support_examples");
    };
    const lost = await t.ask("emma@northwind.test", "Where does a refund go?", "Refund");
    const { suggestion } = await t.support.getTicket(lost, "agent_a");
    const { message } = await t.support.reply({ ticketId: lost, agentId: "agent_a", text: "Back to your card.", suggestionId: suggestion!.id });
    expect(message.deliveryStatus).toBe("sent");
    expect(await t.aiStore.getSuggestion(suggestion!.id)).toMatchObject({ status: "edited", finalText: "Back to your card." });
    t.aiStore.insertExample = insert;

    await t.corrected("lucas@lumen.test", "Where did the refund go?", LUMEN_SENT, "Refund");
    await t.corrected("emma@northwind.test", "And the second refund?", "It went back to the same card as the first one, as every refund does.", "Refund two");
    const again = await t.ask("yusuf@northwind.test", "Where is the refund?", "Refund");
    await t.support.ai.discardSuggestion((await t.support.getTicket(again, "agent_a")).suggestion!.id);
    for (let day = 0; day < 4; day++) {
      t.advance(DAY);
      const run = await t.support.runScheduled();
      expect(run.ai).toBeDefined();
    }
    // Two corrections, three attempts each; the edit review failed but the gaps were still filed.
    expect(t.calls("lesson")).toHaveLength(6);
    expect(await t.support.ai.listGuidanceSuggestions()).toEqual([]);
    expect(await t.support.ai.listGaps()).toMatchObject([{ theme: "Refund destination", count: 1 }]);
  });
});

describe("approved answers", () => {
  const SENT = "Hi Emma,\n\nNorthwind Coffee's payout of $1,240.00 left on Monday. Banks take up to 3 business days to show it.";

  it("generalises a sent reply, and takes out the names the model left in", async () => {
    let asked: Call | undefined;
    const t = await setupMemory({
      generalise: (call) => {
        asked = call;
        return { title: "When will my payout arrive?", text: "Hi Emma,\n\nYour payout has left. Banks take up to 3 business days to show it, so Northwind Coffee will see it soon." };
      },
    });
    const ticketId = await t.ask("emma@northwind.test", "Our payout hasn't arrived.", "Payout");
    await t.support.reply({ ticketId, agentId: "agent_a", text: SENT });

    const general = await t.support.ai.generaliseAnswer({ ticketId, text: SENT });
    expect(asked!.prompt).toContain("Our payout hasn't arrived.");
    expect(general).toEqual({
      title: "When will my payout arrive?",
      text: "Hi {name},\n\nYour payout has left. Banks take up to 3 business days to show it, so {company} will see it soon.",
      language: "en",
    });
  });

  it("is the first source a draft answers from, cited like an article, and only for its language", async () => {
    const t = await setupMemory({
      triage: (call) => ({ ...UNDERSTOOD, language: call.prompt.includes("Bonjour") ? "fr" : "en" }),
      draft: (call) => {
        const id = /<answer id="(answer\/[^"]+)" title="When will my payout arrive\?"/.exec(call.system)?.[1];
        return { ...DRAFT, sources: [id ?? "answer/made-up", "docs/payouts.md"] };
      },
    });
    const answer = await t.support.ai.saveApprovedAnswer({
      title: "  When will my payout arrive?  ",
      text: "Hi {name},\n\nYour payout has left. Banks take up to 3 business days to show it.",
      actorId: "agent_a",
    });
    await t.support.ai.saveApprovedAnswer({ title: "Délai de virement", text: "Bonjour {name}, le virement prend trois jours ouvrés.", language: "fr", actorId: "agent_a" });
    await expect(t.support.ai.saveApprovedAnswer({ title: " ", text: "Something", actorId: "agent_a" })).rejects.toMatchObject({ code: "invalid" });

    const english = await t.ask("emma@northwind.test", "Our payout hasn't arrived.", "Payout");
    const call = t.drafts().at(-1)!;
    expect(call.system.indexOf("<approved_answers>")).toBeGreaterThan(call.system.indexOf("<guidance>"));
    expect(call.system.indexOf("<approved_answers>")).toBeLessThan(call.system.indexOf("<knowledge>"));
    expect(call.system).not.toContain("Délai de virement");
    // The title shown to the agent is the stored one.
    expect((await t.support.getTicket(english, "agent_a")).suggestion!.sources).toEqual([
      { type: "answer", id: `answer/${answer.id}`, title: "When will my payout arrive?" },
      { type: "knowledge", id: "docs/payouts.md", title: "Payout timing", url: "https://acme.test/docs/payouts" },
    ]);

    await t.ask("lucas@lumen.test", "Bonjour, où est mon virement ?", "Virement");
    expect(t.drafts().at(-1)!.system).toContain("Délai de virement");

    await t.support.ai.saveApprovedAnswer({ id: answer.id, title: "Payout timing", text: "Payouts take up to 3 business days.", actorId: "agent_k" });
    expect((await t.support.ai.listApprovedAnswers()).map((a) => [a.title, a.language, a.createdBy]).sort()).toEqual([
      ["Délai de virement", "fr", "agent_a"],
      ["Payout timing", null, "agent_a"],
    ]);
    await t.support.ai.deleteApprovedAnswer(answer.id);
    await t.ask("emma@northwind.test", "Still no payout.", "Payout again");
    expect(t.drafts().at(-1)!.system).not.toContain("<approved_answers>");
  });
});

describe("guidance suggestions", () => {
  const CALL = "Book an onboarding call here: https://acme.test/call";
  const RULE = "When verification is pending, add the onboarding call link https://acme.test/call.";

  it("proposes a rule from edits that repeat across tickets, and changes the guidance only when someone accepts", async () => {
    const t = await setupMemory({
      review: () => ({
        proposals: [
          { rule: RULE, reason: "In 2 of 2 replies about verification, agents added the onboarding call link.", edits: [1, 2] },
          { rule: "Greet people in French.", reason: "One agent did once.", edits: [2] },
          { rule: "Never promise a payout date we can't see.", reason: "Already in the guidance.", edits: [1, 2] },
        ],
      }),
    });
    const first = await t.corrected("emma@northwind.test", "Is our verification done?", `Verification is still pending on our side. ${CALL}`, "Verification");
    const second = await t.corrected("lucas@lumen.test", "How long does verification take?", `It usually takes two days and yours is pending. ${CALL}`, "Verification time");
    // A light edit isn't evidence of anything.
    await t.corrected("yusuf@northwind.test", "Payout late?", DRAFT.text.replace("Hi Emma", "Hi Yusuf"), "Payout");
    expect(t.calls("review")).toHaveLength(0);

    t.advance(DAY);
    expect((await t.support.runScheduled()).ai).toMatchObject({ memory: { guidanceSuggestions: 1 } });
    const [review] = t.calls("review");
    expect(review!.prompt.match(/<edit n=/g)).toHaveLength(2);
    expect(review!.prompt).toContain("Never promise a payout date we can't see.");

    const [suggestion, ...rest] = await t.support.ai.listGuidanceSuggestions();
    expect(rest).toEqual([]);
    expect(suggestion).toMatchObject({ rule: RULE, status: "pending" });
    expect(suggestion!.tickets.map((x) => x.id).sort()).toEqual([first, second].sort());
    expect((await t.support.ai.getSettings()).guidance).toBe("Never promise a payout date we can't see.");

    // At most once a day, and not again until there's a new edit to look at.
    t.advance(HOUR);
    await t.support.runScheduled();
    t.advance(DAY);
    await t.support.runScheduled();
    expect(t.calls("review")).toHaveLength(1);

    const reworded = "When verification is pending, offer the onboarding call: https://acme.test/call";
    const saved = await t.support.ai.decideGuidanceSuggestion({ id: suggestion!.id, accept: true, rule: reworded, actorId: "agent_a" });
    expect(saved.guidance).toBe(`Never promise a payout date we can't see.\n${reworded}`);
    expect(await t.support.ai.listGuidanceSuggestions()).toEqual([]);
    await expect(t.support.ai.decideGuidanceSuggestion({ id: suggestion!.id, accept: true, actorId: "agent_k" })).rejects.toMatchObject({ code: "not_found" });
    expect((await t.support.ai.getSettings()).guidance).toBe(saved.guidance);

    await t.ask("emma@northwind.test", "Any news on verification?", "Verification");
    expect(t.drafts().at(-1)!.system).toContain(reworded);
  });

  it("doesn't propose again what the team dismissed", async () => {
    let round = 0;
    const t = await setupMemory({
      review: () => ({ proposals: [{ rule: round++ ? RULE.toUpperCase() : RULE, reason: "Agents keep adding the call link.", edits: [1, 2] }] }),
    });
    await t.corrected("emma@northwind.test", "Is our verification done?", `Verification is still pending on our side. ${CALL}`, "Verification");
    await t.corrected("lucas@lumen.test", "How long does verification take?", `It usually takes two days and yours is pending. ${CALL}`, "Verification time");
    t.advance(DAY);
    await t.support.runScheduled();
    const [suggestion] = await t.support.ai.listGuidanceSuggestions();
    await t.support.ai.decideGuidanceSuggestion({ id: suggestion!.id, accept: false, actorId: "agent_a" });
    expect((await t.support.ai.getSettings()).guidance).toBe("Never promise a payout date we can't see.");

    await t.corrected("yusuf@northwind.test", "Verification status?", `Still pending, sorry for the wait. ${CALL}`, "Verification");
    t.advance(DAY);
    await t.support.runScheduled();
    expect(t.calls("review").at(-1)!.prompt).toContain(`<already_proposed>\n- ${RULE}`);
    expect(await t.support.ai.listGuidanceSuggestions()).toEqual([]);
  });
});

describe("gaps", () => {
  const annual = (call: Call) => /annual|yearly/i.test(call.prompt.slice(call.prompt.lastIndexOf('from="customer"')));
  const script: Script = {
    draft: (call) => (annual(call) ? { kind: "cannot_answer", text: "", reason: "The knowledge doesn't mention annual billing.", sources: [] } : DRAFT),
    gaps: (call) => ({
      questions: [...call.prompt.matchAll(/<question n="(\d+)">\n([\s\S]*?)\n<\/question>/g)].map(([, n, body]) => {
        const existing = /<gap id="(g\d+)">Discount for annual billing<\/gap>/.exec(call.prompt)?.[1];
        if (!/annual|yearly/i.test(body!)) return { n: Number(n), gap: "", theme: "API rate limits" };
        return existing ? { n: Number(n), gap: existing, theme: "" } : { n: Number(n), gap: "", theme: "Discount for annual billing" };
      }),
    }),
    article: (call) =>
      call.prompt.includes("two months free")
        ? { kind: "article", title: "Is there a discount for annual billing?", markdown: "Yes: paying yearly gives you two months free.\n\n## How to switch\n\nOpen Settings, then Billing." }
        : { kind: "not_enough", title: "", markdown: "" },
  };

  it("groups what went unanswered and the drafts agents threw away, by theme, with the tickets that asked", async () => {
    const t = await setupMemory(script);
    const emma = await t.ask("emma@northwind.test", "Is there a discount for annual billing?", "Annual billing");
    t.advance(HOUR);
    const lucas = await t.ask("lucas@lumen.test", "Do we save anything by paying yearly?", "Yearly plan");
    const jordan = await t.ask("jordan@elsewhere.test", "What are the API rate limits?", "Rate limits");
    await t.support.ai.discardSuggestion((await t.support.getTicket(jordan, "agent_a")).suggestion!.id);
    // A draft the agent used isn't a gap.
    const used = await t.ask("yusuf@northwind.test", "Payout late?", "Payout");
    await t.support.reply({ ticketId: used, agentId: "agent_a", text: DRAFT.text, suggestionId: (await t.support.getTicket(used, "agent_a")).suggestion!.id });

    t.advance(DAY);
    expect((await t.support.runScheduled()).ai).toMatchObject({ memory: { gapQuestions: 3 } });
    const [asked] = t.calls("gaps");
    expect(asked!.prompt).toContain("<why_unanswered>The knowledge doesn&apos;t mention annual billing.</why_unanswered>".replace("&apos;", "'"));
    expect(asked!.prompt).not.toContain("Payout late?");

    const gaps = await t.support.ai.listGaps();
    expect(gaps.map((g) => [g.theme, g.count])).toEqual([
      ["Discount for annual billing", 2],
      ["API rate limits", 1],
    ]);
    expect(gaps[0]!.tickets.map((x) => x.id)).toEqual([lucas, emma]);
    expect(gaps[0]!.tickets[0]).toMatchObject({ subject: "Yearly plan", number: expect.any(Number) });

    // The same question next week joins its gap, and only what's new is filed.
    await t.ask("yusuf@northwind.test", "Any annual billing offer?", "Annual offer");
    t.advance(DAY);
    await t.support.runScheduled();
    expect(t.calls("gaps").at(-1)!.prompt.match(/<question n=/g)).toHaveLength(1);
    expect((await t.support.ai.listGaps()).map((g) => [g.theme, g.count])).toEqual([
      ["Discount for annual billing", 3],
      ["API rate limits", 1],
    ]);
  });

  it("closes a gap with an approved answer or a dismissal, and opens a new one if the question comes back", async () => {
    const t = await setupMemory(script);
    await t.ask("emma@northwind.test", "Is there a discount for annual billing?", "Annual billing");
    const jordan = await t.ask("jordan@elsewhere.test", "What are the API rate limits?", "Rate limits");
    await t.support.ai.discardSuggestion((await t.support.getTicket(jordan, "agent_a")).suggestion!.id);
    t.advance(DAY);
    await t.support.runScheduled();
    const gaps = await t.support.ai.listGaps();
    const billing = gaps.find((g) => g.theme === "Discount for annual billing");
    const api = gaps.find((g) => g.theme === "API rate limits");

    await t.support.ai.saveApprovedAnswer({ title: billing!.theme, text: "Paying yearly gives you two months free.", gapId: billing!.id, actorId: "agent_a" });
    await t.support.ai.dismissGap({ id: api!.id, actorId: "agent_a" });
    expect(await t.support.ai.listGaps()).toEqual([]);

    const more = await t.ask("lucas@lumen.test", "What are your API rate limits?", "Limits");
    await t.support.ai.discardSuggestion((await t.support.getTicket(more, "agent_a")).suggestion!.id);
    await t.ask("yusuf@northwind.test", "Annual billing discount?", "Annual");
    t.advance(DAY);
    await t.support.runScheduled();
    // The dismissed theme stays out of the way; the resolved one came back, so its answer isn't working.
    const open = await t.support.ai.listGaps();
    expect(open.map((g) => [g.theme, g.count])).toEqual([["Discount for annual billing", 1]]);
    expect(open[0]!.id).not.toBe(billing!.id);
  });

  it("drafts an article from the tickets agents answered, and says so when none has an answer", async () => {
    const t = await setupMemory(script);
    const emma = await t.ask("emma@northwind.test", "Is there a discount for annual billing?", "Annual billing");
    await t.ask("lucas@lumen.test", "Do we save anything by paying yearly?", "Yearly plan");
    t.advance(DAY);
    await t.support.runScheduled();
    const [gap] = await t.support.ai.listGaps();

    await expect(t.support.ai.draftArticle({ gapId: gap!.id })).rejects.toMatchObject({ code: "invalid" });
    expect(t.calls("article")).toHaveLength(0);

    await t.support.reply({ ticketId: emma, agentId: "agent_a", text: "Yes, paying yearly gives you two months free. Switch in Settings, then Billing." });
    const article = await t.support.ai.draftArticle({ gapId: gap!.id });
    expect(article).toEqual({
      title: "Is there a discount for annual billing?",
      markdown: "Yes: paying yearly gives you two months free.\n\n## How to switch\n\nOpen Settings, then Billing.",
    });
    const [call] = t.calls("article");
    expect(call!.prompt).toContain("The question to answer: Discount for annual billing");
    // Only the answered ticket teaches the article.
    expect(call!.prompt.match(/<conversation/g)).toHaveLength(1);

    await expect(t.support.ai.draftArticle({ ticketIds: [emma] })).resolves.toMatchObject({ title: "Is there a discount for annual billing?" });
  });
});
