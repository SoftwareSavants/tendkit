import type {
  Agent,
  Customer,
  FileInfo,
  PortalMessage,
  PortalTicket,
  SupportClient,
  SupportPortalClient,
  TicketCounts,
  TicketDetail,
  TicketListItem,
  TicketStatus,
  TimelineEvent,
  TimelineMessage,
} from "@/registry/support-ui/client";

/*
 * The live demo's backend: the same contract your API gives the screens, kept in memory in the
 * visitor's browser. After your first reply on a ticket, the customer answers back a few seconds
 * later, so you can see the whole loop. Nothing leaves the page; a reload starts over.
 */

export const VIEWER: Agent = { id: "agent_you", name: "Alex Chen" };
const AGENTS: Agent[] = [VIEWER, { id: "agent_priya", name: "Priya Patel" }, { id: "agent_tom", name: "Tom Okafor" }];

export type DemoAccount = Customer & { plan: string; seats: number; since: string; lastOrder: string };
export const ACCOUNTS: DemoAccount[] = [
  { id: "acc_northwind", name: "Northwind Coffee", plan: "Growth", seats: 4, since: "Mar 2025", lastOrder: "#1043 · $86.00" },
  { id: "acc_atlas", name: "Atlas Freight", plan: "Business", seats: 18, since: "Nov 2024", lastOrder: "#7718 · $1,240.00" },
  { id: "acc_sol", name: "Clínica Sol", plan: "Starter", seats: 2, since: "Aug 2026", lastOrder: "#0291 · $49.00" },
  { id: "acc_rossi", name: "Rossi Studio", plan: "Growth", seats: 6, since: "Jan 2026", lastOrder: "#3310 · $312.50" },
  { id: "acc_nordvik", name: "Nordvik", plan: "Business", seats: 25, since: "Jun 2025", lastOrder: "#5521 · $2,016.00" },
];

type ChannelKind = "email" | "sms" | "whatsapp";
const CHANNELS: Record<ChannelKind, NonNullable<TicketDetail["channel"]>> = {
  email: { id: "email", kind: "email", address: "support@acme.com", capabilities: { attachments: { maxBytes: 30 * 1024 * 1024, maxCount: 10 }, maxTextLength: null } },
  sms: { id: "sms", kind: "sms", address: "+1 415 555 0133", capabilities: { attachments: false, maxTextLength: 1600 } },
  whatsapp: { id: "whatsapp", kind: "whatsapp", address: "+1 415 555 0133", capabilities: { attachments: { maxBytes: 16 * 1024 * 1024, maxCount: 1 }, maxTextLength: 4096 } },
};

type Ticket = TicketDetail["ticket"] & {
  channel: ChannelKind;
  contact: TicketDetail["contact"];
  lastMessageAt: Date;
  answered: boolean;
};

type State = {
  tickets: Ticket[];
  messages: Map<string, TimelineMessage[]>;
  events: Map<string, TimelineEvent[]>;
  reads: Map<string, Date>;
  files: Map<string, { info: FileInfo; url: string }>;
  seq: number;
};

const minutes = (n: number) => new Date(Date.now() - n * 60_000);
let ids = 0;
const nextId = (prefix: string) => `${prefix}_${++ids}`;

function message(partial: Partial<TimelineMessage> & Pick<TimelineMessage, "kind" | "text" | "createdAt">): TimelineMessage {
  return {
    id: nextId("msg"),
    authorId: null,
    from: null,
    to: [],
    cc: [],
    fullText: null,
    html: null,
    deliveryStatus: partial.kind === "outbound" ? "delivered" : null,
    deliveryError: null,
    auto: false,
    source: partial.kind === "inbound" ? "channel" : "agent",
    attachments: [],
    ...partial,
  };
}

function seed(): State {
  const state: State = { tickets: [], messages: new Map(), events: new Map(), reads: new Map(), files: new Map(), seq: 1040 };

  const add = (t: {
    channel: ChannelKind;
    name: string | null;
    identity: string;
    account: string | null;
    subject: string | null;
    status: TicketStatus;
    assigneeId?: string | null;
    read?: boolean;
    thread: { kind: "inbound" | "outbound" | "note"; text: string; ago: number; authorId?: string; fullText?: string }[];
  }) => {
    const id = nextId("tkt");
    const identityKind = t.channel === "email" ? "email" : "phone";
    const contact = { id: nextId("con"), name: t.name, identities: [{ kind: identityKind, value: t.identity }], customerId: t.account, locale: "en" };
    const msgs = t.thread.map((m) =>
      message({
        kind: m.kind,
        text: m.text,
        fullText: m.fullText ?? null,
        createdAt: minutes(m.ago),
        authorId: m.authorId ?? null,
        from: m.kind === "inbound" ? { address: t.identity, name: t.name } : null,
        to: m.kind === "outbound" ? [{ address: t.identity, name: t.name }] : [],
      })
    );
    const lastInbound = [...msgs].reverse().find((m) => m.kind === "inbound");
    const lastAt = msgs.at(-1)!.createdAt as Date;
    const ticket: Ticket = {
      id,
      number: ++state.seq,
      subject: t.subject,
      status: t.status,
      customerId: t.account,
      assigneeId: t.assigneeId ?? null,
      waitingSince: t.status === "open" ? (lastInbound?.createdAt as Date) : null,
      createdAt: msgs[0]!.createdAt as Date,
      channel: t.channel,
      contact,
      lastMessageAt: lastAt,
      answered: msgs.some((m) => m.kind === "outbound"),
    };
    state.tickets.push(ticket);
    state.messages.set(id, msgs);
    state.events.set(id, []);
    if (t.read) state.reads.set(id, new Date());
  };

  add({
    channel: "email",
    name: "Emma Clarke",
    identity: "emma@northwind.coffee",
    account: "acc_northwind",
    subject: "Payout not received",
    status: "open",
    thread: [
      {
        kind: "inbound",
        ago: 26,
        text: "Hi, last week's payout hasn't reached our bank account yet. Could you check what happened?\n\nThanks,\nEmma",
        fullText:
          "Hi, last week's payout hasn't reached our bank account yet. Could you check what happened?\n\nThanks,\nEmma\n\nEmma Clarke\nOwner, Northwind Coffee\n\nSent from my iPhone",
      },
    ],
  });
  add({
    channel: "whatsapp",
    name: "Daniel Kim",
    identity: "+44 7700 900123",
    account: "acc_atlas",
    subject: null,
    status: "open",
    assigneeId: "agent_priya",
    read: true,
    thread: [
      { kind: "inbound", ago: 190, text: "Hello! Can I add a second admin to our account?" },
      { kind: "note", ago: 160, authorId: "agent_priya", text: "They're on Business, so a second admin is included. Checking whether the invite email bounced." },
    ],
  });
  add({
    channel: "email",
    name: "Jordan Lee",
    identity: "jordan.lee@gmail.com",
    account: null,
    subject: "Do you offer annual billing?",
    status: "open",
    thread: [{ kind: "inbound", ago: 48, text: "We're a team of 12 and would rather pay yearly. Is there a discount for annual billing?" }],
  });
  add({
    channel: "sms",
    name: "Lucia Romero",
    identity: "+34 600 123 456",
    account: "acc_sol",
    subject: null,
    status: "waiting",
    assigneeId: VIEWER.id,
    read: true,
    thread: [
      { kind: "inbound", ago: 300, text: "Invoice 2381 has our old address on it." },
      { kind: "outbound", ago: 280, authorId: VIEWER.id, text: "Sorry about that! Can you send me the new address?" },
    ],
  });
  add({
    channel: "email",
    name: "Sara Lind",
    identity: "sara@nordvik.io",
    account: "acc_nordvik",
    subject: "Export to CSV isn't showing all rows",
    status: "waiting",
    assigneeId: "agent_tom",
    read: true,
    thread: [
      { kind: "inbound", ago: 720, text: "When I export orders to CSV, only the first 1,000 rows come through." },
      { kind: "outbound", ago: 650, authorId: "agent_tom", text: "Thanks Sara. We've raised the limit; could you try the export again and let me know?" },
    ],
  });
  add({
    channel: "email",
    name: "Sofia Rossi",
    identity: "sofia@rossi.studio",
    account: "acc_rossi",
    subject: "Two-factor codes not arriving",
    status: "solved",
    assigneeId: VIEWER.id,
    read: true,
    thread: [
      { kind: "inbound", ago: 1500, text: "My 2FA codes stopped arriving this morning." },
      { kind: "outbound", ago: 1460, authorId: VIEWER.id, text: "Your carrier was blocking our sender. I've switched you to WhatsApp codes, can you try again?" },
      { kind: "inbound", ago: 1440, text: "Thanks, that worked!" },
    ],
  });
  add({
    channel: "email",
    name: "Emma Clarke",
    identity: "emma@northwind.coffee",
    account: "acc_northwind",
    subject: "Change our billing email",
    status: "solved",
    assigneeId: "agent_priya",
    read: true,
    thread: [
      { kind: "inbound", ago: 9000, text: "Could invoices go to accounts@northwind.coffee from now on?" },
      { kind: "outbound", ago: 8950, authorId: "agent_priya", text: "Done. The next invoice goes to accounts@northwind.coffee." },
    ],
  });
  add({
    channel: "email",
    name: null,
    identity: "deals@cheap-watches.biz",
    account: null,
    subject: "Exclusive offer for your business!!!",
    status: "spam",
    read: true,
    thread: [{ kind: "inbound", ago: 2000, text: "Buy 3 watches, get 1 free. Limited time!" }],
  });
  return state;
}

const FOLLOW_UPS = [
  "Thanks, that's exactly what I needed!",
  "Got it, I'll try that now and let you know.",
  "Perfect, thank you for the quick answer.",
];

/** A support client backed by browser memory. `onChange` fires when the customer writes back. */
/** The agent and portal clients, sharing one in-browser state: a portal request lands in the inbox. */
export function createDemoClients(onChange: () => void): { agent: SupportClient; portal: SupportPortalClient } {
  ids = 0; // the same ticket ids every time, so links like ?ticket=tkt_1 are stable
  const s = seed();
  const delay = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 120));
  const ticket = (id: string) => {
    const t = s.tickets.find((x) => x.id === id);
    if (!t) throw new Error("This ticket doesn't exist.");
    return t;
  };
  const customer = (id: string | null): Customer | null => {
    const a = ACCOUNTS.find((x) => x.id === id);
    return a ? { id: a.id, name: a.name } : null;
  };
  const agent = (id: string | null) => AGENTS.find((a) => a.id === id) ?? null;
  /** Like the service: whoever wrote last (else the contact), copying everyone else on the latest email. */
  const recipients = (t: Ticket): TicketDetail["recipients"] => {
    const thread = s.messages.get(t.id)!.filter((m) => m.kind !== "note" && !m.auto);
    const lastIn = [...thread].reverse().find((m) => m.kind === "inbound");
    const identity = t.contact.identities[0];
    const to = lastIn?.from ?? (identity ? { address: identity.value, name: t.contact.name } : null);
    const latest = thread.at(-1);
    if (!to || !latest || t.channel !== "email") return { to, cc: [] };
    const own = (x: string) => x.endsWith("@acme.com");
    const seen = new Set([to.address.toLowerCase()]);
    const cc = [latest.from, ...latest.to, ...latest.cc].filter((x): x is NonNullable<typeof x> => {
      if (!x || own(x.address) || seen.has(x.address.toLowerCase())) return false;
      seen.add(x.address.toLowerCase());
      return true;
    });
    return { to, cc };
  };
  const event = (ticketId: string, type: TimelineEvent["type"], data: Record<string, unknown>) =>
    s.events.get(ticketId)!.push({ id: nextId("evt"), type, actorId: VIEWER.id, data, createdAt: new Date() });

  const listItem = (t: Ticket): TicketListItem => {
    const last = s.messages.get(t.id)!.filter((m) => m.kind !== "note").at(-1)!;
    const read = s.reads.get(t.id);
    return {
      id: t.id,
      number: t.number,
      subject: t.subject,
      status: t.status,
      waitingSince: t.waitingSince,
      lastMessageAt: t.lastMessageAt,
      preview: last.text,
      previewKind: last.kind === "note" ? null : last.kind,
      previewAuthorId: last.authorId,
      contact: { id: t.contact.id, name: t.contact.name, identities: t.contact.identities },
      customer: customer(t.customerId),
      assignee: agent(t.assigneeId),
      unread: !read || read < t.lastMessageAt,
    };
  };

  // The customer writes back a few seconds after your first reply, so you see the ticket reopen.
  const customerAnswers = (t: Ticket) => {
    if (t.answered) return;
    t.answered = true;
    setTimeout(() => {
      const at = new Date();
      s.messages.get(t.id)!.push(
        message({
          kind: "inbound",
          text: FOLLOW_UPS[t.number % FOLLOW_UPS.length]!,
          createdAt: at,
          from: { address: t.contact.identities[0]!.value, name: t.contact.name },
        })
      );
      if (t.status !== "open") s.events.get(t.id)!.push({ id: nextId("evt"), type: "reopened", actorId: null, data: {}, createdAt: at });
      t.status = "open";
      t.waitingSince = t.waitingSince ?? at;
      t.lastMessageAt = at;
      onChange();
    }, 6000);
  };

  const agentClient: SupportClient = {
    async listTickets(q) {
      const term = q.search?.toLowerCase();
      let items = s.tickets.filter((t) => t.status === q.status);
      if (q.assignee === "me") items = items.filter((t) => t.assigneeId === VIEWER.id);
      else if (q.assignee === null) items = items.filter((t) => !t.assigneeId);
      else if (q.assignee) items = items.filter((t) => t.assigneeId === q.assignee);
      if (term) {
        items = items.filter((t) =>
          [t.subject, t.contact.name, t.contact.identities[0]?.value, customer(t.customerId)?.name, ...s.messages.get(t.id)!.map((m) => m.text)]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(term))
        );
      }
      items.sort((a, b) =>
        q.status === "open"
          ? +(a.waitingSince ?? a.lastMessageAt) - +(b.waitingSince ?? b.lastMessageAt)
          : +b.lastMessageAt - +a.lastMessageAt
      );
      const start = (q.page - 1) * q.pageSize;
      return delay({ items: items.slice(start, start + q.pageSize).map(listItem), total: items.length });
    },

    async counts() {
      const counts: TicketCounts = { open: 0, waiting: 0, solved: 0, spam: 0, unassigned: 0, mine: 0 };
      for (const t of s.tickets) {
        counts[t.status]++;
        if (t.status === "open" && !t.assigneeId) counts.unassigned++;
        if (t.status === "open" && t.assigneeId === VIEWER.id) counts.mine++;
      }
      return delay(counts);
    },

    async getTicket(id) {
      const t = ticket(id);
      s.reads.set(id, new Date());
      const timeline: TicketDetail["timeline"] = [
        ...s.messages.get(id)!.map((m) => ({ type: "message" as const, at: m.createdAt, message: m })),
        ...s.events.get(id)!.map((e) => ({ type: "event" as const, at: e.createdAt, event: e })),
      ].sort((a, b) => +new Date(a.at) - +new Date(b.at));
      return delay({
        ticket: {
          id: t.id,
          number: t.number,
          subject: t.subject,
          status: t.status,
          customerId: t.customerId,
          assigneeId: t.assigneeId,
          waitingSince: t.waitingSince,
          createdAt: t.createdAt,
        },
        contact: t.contact,
        customer: customer(t.customerId),
        assignee: agent(t.assigneeId),
        timeline,
        channel: CHANNELS[t.channel],
        replyBlockedReason: null,
        recipients: recipients(t),
        previousTickets: s.tickets
          .filter((x) => x.id !== t.id && x.contact.identities[0]?.value === t.contact.identities[0]?.value)
          .map((x) => ({ id: x.id, number: x.number, subject: x.subject, status: x.status, lastMessageAt: x.lastMessageAt })),
      });
    },

    async reply({ ticketId, text, attachmentIds, status, cc }) {
      const t = ticket(ticketId);
      const at = new Date();
      s.messages.get(ticketId)!.push(
        message({
          kind: "outbound",
          text,
          createdAt: at,
          authorId: VIEWER.id,
          to: recipients(t).to ? [recipients(t).to!] : [],
          cc: cc ?? recipients(t).cc,
          attachments: attachmentIds.map((id) => s.files.get(id)!.info),
        })
      );
      if (!t.assigneeId) {
        t.assigneeId = VIEWER.id;
        event(ticketId, "assigned", { to: VIEWER.id });
      }
      if (t.status !== status) event(ticketId, "status_changed", { from: t.status, to: status });
      t.status = status;
      t.waitingSince = status === "open" ? t.waitingSince : null;
      t.lastMessageAt = at;
      s.reads.set(ticketId, at);
      customerAnswers(t);
      return delay({ ok: true });
    },

    async addNote({ ticketId, text, attachmentIds }) {
      s.messages.get(ticketId)!.push(
        message({ kind: "note", text, createdAt: new Date(), authorId: VIEWER.id, attachments: attachmentIds.map((id) => s.files.get(id)!.info) })
      );
      return delay({ ok: true });
    },

    async assign({ ticketId, assigneeId }) {
      const t = ticket(ticketId);
      t.assigneeId = assigneeId;
      event(ticketId, "assigned", { to: assigneeId });
      return delay({ ok: true });
    },

    async setStatus({ ticketId, status }) {
      const t = ticket(ticketId);
      event(ticketId, "status_changed", { from: t.status, to: status });
      t.status = status;
      if (status !== "open") t.waitingSince = null;
      return delay({ ok: true });
    },

    async linkCustomer({ ticketId, customerId }) {
      const t = ticket(ticketId);
      t.customerId = customerId;
      t.contact.customerId = customerId;
      event(ticketId, "customer_linked", { to: customerId });
      return delay({ ok: true });
    },

    async changeContact({ ticketId, address }) {
      const t = ticket(ticketId);
      const value = address.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Enter a valid email address.");
      t.contact = { ...t.contact, id: nextId("contact"), name: null, identities: [{ kind: "email", value }] };
      event(ticketId, "contact_changed", { address: value });
      return delay({ ok: true });
    },

    async retry() {
      return delay({ ok: true });
    },

    async upload({ file }) {
      const info: FileInfo = { id: nextId("file"), filename: file.name, contentType: file.type || "application/octet-stream", size: file.size };
      s.files.set(info.id, { info, url: URL.createObjectURL(file) });
      return delay(info);
    },

    async attachmentUrl({ id }) {
      return delay(s.files.get(id)?.url ?? "#");
    },

    async listAgents() {
      return delay(AGENTS);
    },

    async searchCustomers(query) {
      const q = query.toLowerCase();
      return delay(ACCOUNTS.filter((a) => a.name.toLowerCase().includes(q)).map(({ id, name }) => ({ id, name })));
    },
  };

  // The customer portal, as Emma Clarke of Northwind Coffee sees it.
  const CUSTOMER = { account: "acc_northwind", name: "Emma Clarke", email: "emma@northwind.coffee" };
  const visible = (m: TimelineMessage) => m.kind !== "note" && !m.auto;
  const portalTicket = (t: Ticket): PortalTicket => {
    const last = s.messages.get(t.id)!.filter(visible).at(-1)!;
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt,
      lastMessageAt: t.lastMessageAt,
      preview: last.text,
      previewKind: last.kind === "note" ? null : last.kind,
      previewAuthor: last.kind === "outbound" ? (agent(last.authorId)?.name.split(" ")[0] ?? null) : null,
      unread: false,
    };
  };
  const mine = () => s.tickets.filter((t) => t.customerId === CUSTOMER.account && t.status !== "spam");

  const portal: SupportPortalClient = {
    async list() {
      const items = mine().sort((a, b) => +b.lastMessageAt - +a.lastMessageAt).map(portalTicket);
      return delay({ items, total: items.length });
    },
    async get(id) {
      const t = mine().find((x) => x.id === id);
      if (!t) throw new Error("This request doesn't exist.");
      const messages: PortalMessage[] = s.messages
        .get(id)!
        .filter(visible)
        .map((m) => ({
          id: m.id,
          kind: m.kind as "inbound" | "outbound",
          author: m.kind === "outbound" ? (agent(m.authorId)?.name.split(" ")[0] ?? null) : (m.from?.name ?? null),
          text: m.text,
          createdAt: m.createdAt,
          attachments: m.attachments,
        }));
      return delay({ ticket: { id: t.id, subject: t.subject, status: t.status, createdAt: t.createdAt }, messages });
    },
    async create({ subject, text }) {
      const at = new Date();
      const id = nextId("tkt");
      s.tickets.push({
        id,
        number: ++s.seq,
        subject,
        status: "open",
        customerId: CUSTOMER.account,
        assigneeId: null,
        waitingSince: at,
        createdAt: at,
        channel: "email",
        contact: { id: nextId("con"), name: CUSTOMER.name, identities: [{ kind: "email", value: CUSTOMER.email }], customerId: CUSTOMER.account, locale: "en" },
        lastMessageAt: at,
        answered: false,
      });
      s.messages.set(id, [message({ kind: "inbound", text, createdAt: at, source: "portal", from: { address: CUSTOMER.email, name: CUSTOMER.name } })]);
      s.events.set(id, []);
      onChange();
      return delay({ id });
    },
    async reply({ ticketId, text }) {
      const t = mine().find((x) => x.id === ticketId);
      if (!t) throw new Error("This request doesn't exist.");
      const at = new Date();
      s.messages.get(ticketId)!.push(message({ kind: "inbound", text, createdAt: at, source: "portal", from: { address: CUSTOMER.email, name: CUSTOMER.name } }));
      if (t.status === "solved") s.events.get(ticketId)!.push({ id: nextId("evt"), type: "reopened", actorId: null, data: {}, createdAt: at });
      t.status = "open";
      t.waitingSince = t.waitingSince ?? at;
      t.lastMessageAt = at;
      t.answered = true;
      onChange();
      return delay({ ok: true });
    },
    async attachmentUrl({ id }) {
      return delay(s.files.get(id)?.url ?? "#");
    },
  };

  return { agent: agentClient, portal };
}

/** The agent client only, for places that don't need the portal. */
export function createDemoClient(onChange: () => void): SupportClient {
  return createDemoClients(onChange).agent;
}
