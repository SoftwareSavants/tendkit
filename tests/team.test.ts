import { describe, expect, it } from "vitest";
import { DAY, inbound, setup } from "./helpers";

const ingest = async (t: Awaited<ReturnType<typeof setup>>, partial: Parameters<typeof inbound>[0]) =>
  (await t.support.ingest("email", { type: "message", message: inbound({ receivedAt: t.now(), ...partial }) })) as {
    result: string;
    ticketId: string;
  };

/** Daniel, a teammate, replies to Emma in Outlook and adds the support address. */
const outlookReply = `Adding our support team, they'll take it from here.

Daniel Kim

________________________________
From: Emma Clarke <emma@northwind.test>
Sent: Monday, November 2, 2026 4:23 PM
To: Daniel Kim <daniel@acme.test>
Subject: Payout not received

Hello,

We haven't received last week's payout.

Emma`;

const handOff: Parameters<typeof inbound>[0] = {
  from: "daniel@acme.test",
  to: [{ address: "emma@northwind.test", name: "Emma Clarke" }, { address: "support@acme.test" }],
  subject: "RE: Payout not received",
  text: outlookReply,
};

const messages = async (t: Awaited<ReturnType<typeof setup>>, ticketId: string) =>
  (await t.support.getTicket(ticketId, "agent_k")).timeline.flatMap((e) => (e.type === "message" ? [e.message] : []));

describe("team email", () => {
  it("hands a teammate's reply to the inbox: the customer is the contact and nothing is sent", async () => {
    const t = await setup();
    const { result, ticketId } = await ingest(t, handOff);
    expect(result).toBe("created");

    const detail = await t.support.getTicket(ticketId, "agent_k");
    expect(detail.contact.identities).toEqual([{ kind: "email", value: "emma@northwind.test" }]);
    expect(detail.customer).toEqual({ id: "cus_northwind", name: "Northwind Coffee" });
    expect(detail.ticket.subject).toBe("Payout not received");
    expect(detail.ticket.status).toBe("open");
    const [customer, teammate] = await messages(t, ticketId);
    expect(customer).toMatchObject({ kind: "inbound", from: { address: "emma@northwind.test" } });
    expect(customer!.text).toBe("Hello,\n\nWe haven't received last week's payout.\n\nEmma");
    expect(new Date(customer!.createdAt).toISOString()).toBe("2026-11-02T16:23:00.000Z");
    expect(teammate).toMatchObject({ kind: "outbound", authorId: "agent_a", deliveryStatus: "sent" });
    expect(teammate!.text).toBe("Adding our support team, they'll take it from here.\n\nDaniel Kim");
    // Outlook already delivered Daniel's email; no acknowledgement either.
    expect(t.email.sent).toEqual([]);
    expect(detail.recipients).toEqual({ to: { address: "emma@northwind.test", name: "Emma Clarke" }, cc: [] });
    expect(t.notifications.map((n) => n.type)).toEqual(["ticket.created"]);
  });

  it("treats a redelivered hand-off as a duplicate", async () => {
    const t = await setup();
    const message = inbound({ receivedAt: t.now(), ...handOff });
    await t.support.ingest("email", { type: "message", message });
    expect(await t.support.ingest("email", { type: "message", message })).toEqual({ result: "duplicate" });
  });

  it("threads the customer's reply-all into the handed-off ticket and answers them", async () => {
    const t = await setup();
    const handed = inbound({ receivedAt: t.now(), ...handOff });
    const { ticketId } = (await t.support.ingest("email", { type: "message", message: handed })) as { ticketId: string };
    t.advance(DAY);
    const answer = await ingest(t, {
      cc: [{ address: "daniel@acme.test" }],
      inReplyTo: handed.rfcMessageId,
      references: [handed.rfcMessageId!],
      text: "Thanks Daniel. It was due on Friday.",
    });
    expect(answer).toEqual({ result: "appended", ticketId });

    await t.support.reply({ ticketId, agentId: "agent_k", text: "It went out this morning." });
    const sent = t.email.sent.at(-1)!;
    expect(sent.to).toEqual([{ address: "emma@northwind.test", name: "Emma" }]);
    // Daniel is on the team, so he isn't copied.
    expect(sent.cc).toBeUndefined();
  });

  it("opens a forwarded email under its original sender, with the teammate's words as a note", async () => {
    const t = await setup();
    const { ticketId } = await ingest(t, {
      from: "priya@acme.test",
      subject: "Fwd: Invoice for October",
      text: [
        "Can someone take this one?",
        "",
        "---------- Forwarded message ---------",
        "From: Lucas Martin <lucas@lumen.test>",
        "Date: Mon, Nov 2, 2026 at 10:15 AM",
        "Subject: Invoice for October",
        "To: <priya@acme.test>",
        "",
        "Where can I download October's invoice?",
      ].join("\n"),
    });
    const detail = await t.support.getTicket(ticketId, "agent_a");
    expect(detail.contact.identities[0]!.value).toBe("lucas@lumen.test");
    expect(detail.customer?.id).toBe("cus_lumen");
    expect(detail.ticket.subject).toBe("Invoice for October");
    const timeline = detail.timeline.map((e) => (e.type === "message" ? `${e.message.kind}:${e.message.text}` : `event:${e.event.type}`));
    expect(timeline).toEqual(["inbound:Where can I download October's invoice?", "note:Can someone take this one?", "event:forwarded"]);
    const forwarded = detail.timeline.find((e) => e.type === "event" && e.event.type === "forwarded");
    expect(forwarded).toMatchObject({ event: { actorId: "agent_k" } });
    expect(detail.recipients.to?.address).toBe("lucas@lumen.test");
    expect(t.email.sent).toEqual([]);
  });

  it("reads the quote from the HTML when the plain text leaves it out", async () => {
    const t = await setup();
    const { ticketId } = await ingest(t, {
      ...handOff,
      text: "Adding our support team.",
      html: `<div>Adding our support team.</div><div id="appendonsend"></div><hr><div id="divRplyFwdMsg"><b>From:</b> Emma Clarke &lt;emma@northwind.test&gt;<br><b>Sent:</b> Monday, November 2, 2026 4:23 PM<br><b>To:</b> Daniel Kim<br><b>Subject:</b> Payout not received</div><div><p>We haven't received last week's payout.</p></div>`,
    });
    const [customer, teammate] = await messages(t, ticketId);
    expect(customer!.text).toBe("We haven't received last week's payout.");
    expect(teammate!.text).toBe("Adding our support team.");
  });

  it("records a teammate's new email to a customer as waiting on them, without notifying", async () => {
    const t = await setup();
    const { ticketId } = await ingest(t, { ...handOff, subject: "Your account", text: "Hi Emma, a quick question about your account." });
    const detail = await t.support.getTicket(ticketId, "agent_a");
    expect(detail.ticket.status).toBe("waiting");
    expect(detail.contact.identities[0]!.value).toBe("emma@northwind.test");
    expect((await messages(t, ticketId)).map((m) => m.kind)).toEqual(["outbound"]);
    expect(t.notifications).toEqual([]);
  });

  it("records a teammate's email on an existing ticket as their reply, or as a note when only support gets it", async () => {
    const t = await setup({ acknowledgement: undefined });
    const { ticketId } = await ingest(t, {});
    await t.support.reply({ ticketId, agentId: "agent_k", text: "Looking into it." });
    const replyTo = t.email.sent.at(-1)!.replyTo!.address;
    t.advance(1000);
    await ingest(t, { from: "daniel@acme.test", to: [{ address: "emma@northwind.test" }], cc: [{ address: replyTo }], text: "It's sent." });
    t.advance(1000);
    await ingest(t, { from: "daniel@acme.test", to: [{ address: replyTo }], text: "FYI I answered Emma from Outlook." });
    const list = await messages(t, ticketId);
    expect(list.map((m) => `${m.kind}:${m.authorId}`)).toEqual(["inbound:null", "outbound:agent_k", "outbound:agent_a", "note:agent_a"]);
    expect(t.email.sent).toHaveLength(1); // only Priya's reply
  });

  it("leaves team email alone with teamEmail: customer, or when it fails authentication", async () => {
    const off = await setup({ teamEmail: "customer" });
    const a = await ingest(off, handOff);
    expect((await off.support.getTicket(a.ticketId, "agent_k")).contact.identities[0]!.value).toBe("daniel@acme.test");

    const spoofed = await setup();
    const b = await ingest(spoofed, { ...handOff, headers: { "authentication-results": "mx.acme.test; dmarc=fail" } });
    const detail = await spoofed.support.getTicket(b.ticketId, "agent_k");
    expect(detail.contact.identities[0]!.value).toBe("daniel@acme.test");
    expect(detail.customer).toBeNull();
  });

  it("counts addresses and domains from the team option", async () => {
    const t = await setup({ team: { domains: ["ops.acme.test"] } });
    const { ticketId } = await ingest(t, { ...handOff, from: "sam@ops.acme.test" });
    const [, teammate] = await messages(t, ticketId);
    expect(teammate).toMatchObject({ kind: "outbound", authorId: null, from: { address: "sam@ops.acme.test" } });
  });
});

describe("copies", () => {
  const withCc = (partial: Parameters<typeof inbound>[0] = {}): Parameters<typeof inbound>[0] => ({
    cc: [{ address: "accounts@northwind.test", name: "Northwind Accounts" }, { address: "daniel@acme.test" }],
    ...partial,
  });

  it("copies everyone else on the latest email, minus the team and support", async () => {
    const t = await setup();
    const { ticketId } = await ingest(t, withCc());
    const detail = await t.support.getTicket(ticketId, "agent_a");
    expect(detail.recipients.cc).toEqual([{ address: "accounts@northwind.test", name: "Northwind Accounts" }]);
    await t.support.reply({ ticketId, agentId: "agent_a", text: "On it." });
    expect(t.email.sent.at(-1)!.cc).toEqual([{ address: "accounts@northwind.test", name: "Northwind Accounts" }]);
  });

  it("uses the agent's copy list when given, and keeps it for the next reply", async () => {
    const t = await setup({ acknowledgement: undefined });
    const { ticketId } = await ingest(t, withCc());
    await t.support.reply({ ticketId, agentId: "agent_a", text: "On it.", cc: [{ address: "finance@northwind.test" }] });
    expect(t.email.sent.at(-1)!.cc).toEqual([{ address: "finance@northwind.test", name: null }]);
    expect((await t.support.getTicket(ticketId, "agent_a")).recipients.cc).toEqual([{ address: "finance@northwind.test", name: null }]);
    await expect(t.support.reply({ ticketId, agentId: "agent_a", text: "x", cc: [{ address: "not an email" }] })).rejects.toThrow(
      /valid email/
    );
  });

  it("threads a copied person's reply into the ticket, even without an account", async () => {
    const t = await setup({ acknowledgement: undefined });
    const { ticketId } = await ingest(t, withCc({ cc: [{ address: "ops@partner.test" }] }));
    await t.support.reply({ ticketId, agentId: "agent_a", text: "On it." });
    const ours = (await messages(t, ticketId)).at(-1)!;
    const reply = await ingest(t, {
      from: "ops@partner.test",
      inReplyTo: `<out-1@acme.test>`,
      references: [`<out-1@acme.test>`],
      text: "Adding the invoice.",
    });
    expect(ours.kind).toBe("outbound");
    expect(reply).toEqual({ result: "appended", ticketId });
  });

  it("doesn't thread a stranger's reply on a guessed Message-ID", async () => {
    const t = await setup({ acknowledgement: undefined });
    const { ticketId } = await ingest(t, {});
    await t.support.reply({ ticketId, agentId: "agent_a", text: "On it." });
    const reply = await ingest(t, { from: "stranger@spam.test", inReplyTo: `<out-1@acme.test>`, text: "Hello" });
    expect(reply.result).toBe("created");
    expect(reply.ticketId).not.toBe(ticketId);
  });

  it("sends to the customer alone with replyAll: false", async () => {
    const t = await setup({ replyAll: false, acknowledgement: undefined });
    const { ticketId } = await ingest(t, withCc());
    await t.support.reply({ ticketId, agentId: "agent_a", text: "On it." });
    expect(t.email.sent.at(-1)!.cc).toBeUndefined();
  });
});

describe("changeContact", () => {
  it("moves the ticket to someone else, links their account and replies to them", async () => {
    const t = await setup({ acknowledgement: undefined });
    const { ticketId } = await ingest(t, { from: "stranger@mail.test" });
    await t.support.changeContact({ ticketId, address: " Emma@Northwind.test ", actorId: "agent_a" });
    const detail = await t.support.getTicket(ticketId, "agent_a");
    expect(detail.contact.identities[0]!.value).toBe("emma@northwind.test");
    expect(detail.customer?.id).toBe("cus_northwind");
    expect(detail.timeline.flatMap((e) => (e.type === "event" ? [e.event.type] : []))).toEqual(["contact_changed", "customer_linked"]);
    expect(detail.recipients.to?.address).toBe("stranger@mail.test"); // they wrote last; still answered

    // A teammate's message never becomes the reply address.
    const own = await setup({ acknowledgement: undefined, teamEmail: "customer" });
    const opened = await ingest(own, { from: "daniel@acme.test" });
    await own.support.changeContact({ ticketId: opened.ticketId, address: "lucas@lumen.test", name: "Lucas", actorId: "agent_a" });
    await own.support.reply({ ticketId: opened.ticketId, agentId: "agent_a", text: "Hi Lucas" });
    expect(own.email.sent.at(-1)!.to).toEqual([{ address: "lucas@lumen.test", name: "Lucas" }]);
  });

  it("refuses invalid and own addresses", async () => {
    const t = await setup();
    const { ticketId } = await ingest(t, {});
    await expect(t.support.changeContact({ ticketId, address: "nope", actorId: "agent_a" })).rejects.toThrow(/valid email/);
    await expect(t.support.changeContact({ ticketId, address: "support@acme.test", actorId: "agent_a" })).rejects.toThrow(/own/);
  });
});
