import type {
  ActionField,
  ActionRun,
  Agent,
  AiSettings,
  ApprovedAnswer,
  AutopilotExample,
  AutopilotOverview,
  AutopilotRecord,
  AutopilotTopic,
  Customer,
  FileInfo,
  Gap,
  GuidanceSuggestion,
  PortalMessage,
  PortalTicket,
  ProposedAction,
  Suggestion,
  SupportClient,
  SupportPortalClient,
  TicketCounts,
  TicketDetail,
  TicketInsight,
  TicketListItem,
  TicketStatus,
  TimelineEvent,
  TimelineMessage,
} from "@/registry/support-ui/client";

/*
 * The live demo's backend: the same contract your API gives the screens, kept in memory in the
 * visitor's browser. After your first reply on a ticket, the customer answers back a few seconds
 * later, so you can see the whole loop. Nothing leaves the page; a reload starts over.
 *
 * The AI here is scripted: suggested replies, summaries and rewrites are written in this file, so
 * the demo works without a model or a key. In your app they come from the model you configure.
 * So is its memory: the approved answers, the rule suggested from edits and the unanswered
 * questions are seeded here, and "generalising" a reply swaps the names it knows for placeholders.
 * And its actions: three stand-ins for what an app would declare, with results written here.
 * And Autopilot: each topic's track record is written here as the weeks of agents' work a real
 * install computes it from. One topic is ready, one is on (with a reply waiting out its delay and
 * one already sent), one is paused. Switching, stopping and flagging behave as the service does.
 */

export const VIEWER: Agent = { id: "agent_you", name: "Alex Chen" };
const AGENTS: Agent[] = [VIEWER, { id: "agent_priya", name: "Priya Patel" }, { id: "agent_tom", name: "Tom Okafor" }];

export type DemoAccount = Customer & { plan: string; seats: number; since: string; lastOrder: string; lastPayout?: string };
export const ACCOUNTS: DemoAccount[] = [
  { id: "acc_northwind", name: "Northwind Coffee", plan: "Growth", seats: 4, since: "Mar 2025", lastOrder: "#1043 · $86.00", lastPayout: "$1,240.00 · sent Monday" },
  { id: "acc_atlas", name: "Atlas Freight", plan: "Business", seats: 18, since: "Nov 2024", lastOrder: "#7718 · $1,240.00" },
  { id: "acc_sol", name: "Clínica Sol", plan: "Starter", seats: 2, since: "Aug 2026", lastOrder: "#0291 · $49.00" },
  { id: "acc_rossi", name: "Rossi Studio", plan: "Growth", seats: 6, since: "Jan 2026", lastOrder: "#3310 · $312.50" },
  { id: "acc_nordvik", name: "Nordvik", plan: "Business", seats: 25, since: "Jun 2025", lastOrder: "#5521 · $2,016.00" },
  { id: "acc_harbor", name: "Harbor Books", plan: "Trial", seats: 3, since: "Nov 2026", lastOrder: "None yet" },
];

/** What an app would declare in `supportAi({ actions })`: here each result is scripted. */
type DemoAction = {
  name: string;
  title: string;
  description: string;
  approval: "always" | "never";
  fields: ActionField[];
  run(input: Record<string, unknown>, account: DemoAccount): Omit<ActionRun, "id">;
  /** The reply with the sentence that says this was done taken out, for when an agent skips it. */
  without?(text: string): string;
  /** The reply saying what was done instead, for when an agent changed the inputs. */
  rewritten?(text: string, input: Record<string, unknown>): string;
};
const dropSentence = (text: string, about: RegExp) =>
  text
    .split("\n\n")
    .map((paragraph) => paragraph.split(/(?<=[.!?])\s+/).filter((sentence) => !about.test(sentence)).join(" ").trim())
    .filter(Boolean)
    .join("\n\n");
const DEMO_ACTIONS: DemoAction[] = [
  {
    name: "last_invoice",
    title: "Look up last invoice",
    description: "The customer's most recent invoice and whether it's paid.",
    approval: "never",
    fields: [],
    run(_, account) {
      const [number, amount] = account.lastOrder.split(" · ");
      return amount
        ? { status: "succeeded", summary: `Invoice ${number} for ${amount}, paid.`, data: { Invoice: number!, Amount: amount, Status: "Paid" } }
        : { status: "succeeded", summary: "No invoices yet. The first one is created when the trial ends.", data: null };
    },
  },
  {
    name: "resend_verification",
    title: "Resend verification email",
    description: "Sends the account's verification email again.",
    approval: "always",
    fields: [{ name: "email", label: "Email", description: "Where to send it", kind: "text", required: true }],
    run(input) {
      const email = String(input.email ?? "");
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? { status: "succeeded", summary: `Verification email sent to ${email}.`, data: null }
        : { status: "failed", summary: `${email || "That"} isn't a valid email address.`, data: null };
    },
    without: (text) => dropSentence(text, /verification email/i),
    rewritten: (text, input) => text.replace(/(verification email again to )\S+@\S+?(?=[,.\s])/i, `$1${String(input.email)}`),
  },
  {
    name: "extend_trial",
    title: "Extend trial",
    description: "Extends the customer's trial. Use when they need more time to evaluate.",
    approval: "always",
    fields: [{ name: "days", label: "Days", description: "Days to add, up to 30", kind: "number", required: true }],
    run(input, account) {
      const days = Number(input.days);
      if (account.plan !== "Trial") return { status: "failed", summary: `${account.name} isn't on a trial.`, data: null };
      if (!Number.isInteger(days) || days < 1 || days > 30) return { status: "failed", summary: "A trial can be extended by 1 to 30 days.", data: null };
      const until = new Date(Date.now() + (days + 1) * 86_400_000).toLocaleDateString("en", { month: "short", day: "numeric" });
      return { status: "succeeded", summary: `Trial extended by ${days} days, to ${until}.`, data: null };
    },
    without: (text) => dropSentence(text, /extended your trial/i),
    rewritten: (text, input) => text.replace(/(extended your trial by )\d+ days/i, `$1${Number(input.days)} days`),
  },
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

type Scripted = { insight: TicketInsight; suggestion: Omit<Suggestion, "id"> | null; translations?: Record<string, string>; replyInTheirLanguage?: string };

type State = {
  tickets: Ticket[];
  insights: Map<string, TicketInsight>;
  suggestions: Map<string, Suggestion>;
  /** Scripted English for messages written in another language, by message id. */
  translations: Map<string, string>;
  /** The scripted reply in the customer's language, for "Translate to …". */
  localized: Map<string, string>;
  ai: AiSettings;
  answers: ApprovedAnswer[];
  guidanceSuggestions: GuidanceSuggestion[];
  gaps: Gap[];
  autopilot: Omit<AutopilotOverview, "topics"> & { topics: AutopilotTopic[]; examples: Record<string, AutopilotExample[]> };
  messages: Map<string, TimelineMessage[]>;
  events: Map<string, TimelineEvent[]>;
  reads: Map<string, Date>;
  files: Map<string, { info: FileInfo; url: string }>;
  seq: number;
};

const minutes = (n: number) => new Date(Date.now() - n * 60_000);

/** An action proposed with a scripted suggestion. */
function proposal(name: string, input: Record<string, unknown>, reason: string): ProposedAction {
  const action = DEMO_ACTIONS.find((a) => a.name === name)!;
  return { name, title: action.title, input, reason, state: "proposed", fields: action.fields, run: null };
}
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
  const state: State = {
    tickets: [],
    insights: new Map(),
    suggestions: new Map(),
    translations: new Map(),
    localized: new Map(),
    ai: {
      guidance: "Friendly and brief. Say what we can see on the account before explaining policy. Refunds within 30 days only.",
      topics: ["Payouts", "Billing", "Account access", "Exports"],
      draftOnArrival: true,
      sources: [
        { id: "help-center", articles: 42, syncedAt: minutes(190) },
        { id: "developer-docs", articles: 118, syncedAt: minutes(190) },
      ],
      actions: DEMO_ACTIONS.map(({ name, title, description, approval }) => ({ name, title, description, approval, enabled: true })),
    },
    answers: [
      {
        id: "ans_admins",
        title: "How do I add another admin?",
        text: "Hi {name},\n\nYou can add admins from Settings, then Team: choose Invite and pick the Admin role. They'll get an email to join.",
        language: null,
      },
      {
        id: "ans_payouts",
        title: "When will my payout arrive?",
        text: "Hi {name},\n\nPayouts leave our side every Monday, and banks take up to 3 business days to show them. If yours hasn't arrived by Thursday, reply here and we'll trace it with the bank.",
        language: null,
      },
      {
        id: "ans_factura",
        title: "¿Cómo corrijo una factura?",
        text: "Hola {name}: puede corregir la dirección de una factura desde Facturación, con el botón Editar. La versión corregida se descarga al momento.",
        language: "es",
      },
    ],
    guidanceSuggestions: [],
    gaps: [],
    autopilot: { stopped: false, stoppedBy: null, stoppedAt: null, minDrafts: 30, minRate: 0.9, floor: { minDrafts: 30, minRate: 0.9 }, windowDays: 30, holdMinutes: 10, topics: [], examples: {} },
    seq: 1040,
    messages: new Map(),
    events: new Map(),
    reads: new Map(),
    files: new Map(),
  };

  const add = (t: {
    channel: ChannelKind;
    name: string | null;
    identity: string;
    account: string | null;
    subject: string | null;
    status: TicketStatus;
    assigneeId?: string | null;
    read?: boolean;
    thread: { kind: "inbound" | "outbound" | "note"; text: string; ago: number; authorId?: string; fullText?: string; english?: string }[];
    ai?: Scripted;
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
    t.thread.forEach((m, i) => m.english && state.translations.set(msgs[i]!.id, m.english));
    if (t.ai) {
      state.insights.set(id, t.ai.insight);
      if (t.ai.suggestion) state.suggestions.set(id, { id: nextId("sug"), ...t.ai.suggestion });
      if (t.ai.replyInTheirLanguage) state.localized.set(id, t.ai.replyInTheirLanguage);
    }
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
    ai: {
      insight: { topic: "Payouts", urgency: "high", urgencyReason: "A payout is late", mood: "calm", language: "en", summary: "Last week's payout hasn't reached their bank" },
      suggestion: {
        kind: "draft",
        text: "Hi Emma,\n\nThanks for flagging this. Your payout of $1,240.00 left our side on Monday. Banks can take up to 3 business days to show it, so it should reach your account by Thursday.\n\nIf it hasn't arrived by then, reply here and we'll trace it with the bank.",
        reason: null,
        sources: [
          { type: "knowledge", id: "help-center/payout-schedule", title: "Payout schedule" },
          { type: "fact", id: "fact:1", title: "Last payout" },
          { type: "guidance", id: "guidance", title: "Team guidance" },
        ],
      },
    },
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
    ai: {
      insight: { topic: "Account access", urgency: "normal", urgencyReason: null, mood: "calm", language: "en", summary: "Wants to add a second admin" },
      suggestion: {
        kind: "draft",
        text: "Hi Daniel! Yes, your Business plan includes extra admins. Go to Settings, then Team, choose Invite and pick the Admin role. They'll get an email to join.",
        reason: null,
        sources: [
          { type: "answer", id: "answer/ans_admins", title: "How do I add another admin?" },
          { type: "fact", id: "fact:1", title: "Plan" },
        ],
      },
    },
  });
  add({
    channel: "email",
    name: "Jordan Lee",
    identity: "jordan.lee@gmail.com",
    account: null,
    subject: "Do you offer annual billing?",
    status: "open",
    thread: [{ kind: "inbound", ago: 48, text: "We're a team of 12 and would rather pay yearly. Is there a discount for annual billing?" }],
    ai: {
      insight: { topic: "Billing", urgency: "normal", urgencyReason: null, mood: "calm", language: "en", summary: "Asks about a discount for annual billing" },
      suggestion: { kind: "cannot_answer", text: null, reason: "the help center doesn't mention annual billing or discounts.", sources: [] },
    },
  });
  add({
    channel: "sms",
    name: "Lucia Romero",
    identity: "+34 600 123 456",
    account: "acc_sol",
    subject: null,
    status: "open",
    assigneeId: VIEWER.id,
    thread: [
      { kind: "inbound", ago: 300, text: "La factura 2381 tiene nuestra dirección antigua.", english: "Invoice 2381 has our old address on it." },
      { kind: "outbound", ago: 280, authorId: VIEWER.id, text: "¡Disculpe! ¿Puede enviarme la dirección nueva?" },
      {
        kind: "inbound",
        ago: 14,
        text: "Calle Mayor 12, 28013 Madrid. ¿Pueden corregirla hoy? La necesitamos para la auditoría de mañana.",
        english: "Calle Mayor 12, 28013 Madrid. Can you correct it today? We need it for tomorrow's audit.",
      },
    ],
    ai: {
      insight: { topic: "Billing", urgency: "urgent", urgencyReason: "Needed for an audit tomorrow", mood: "calm", language: "es", summary: "Needs invoice 2381 reissued with the new address today" },
      suggestion: {
        kind: "draft",
        text: "Gracias, Lucía. Hemos corregido la dirección de la factura 2381 a Calle Mayor 12, 28013 Madrid. Puede descargarla ya desde Facturación.",
        reason: null,
        sources: [{ type: "knowledge", id: "help-center/edit-invoice", title: "Correct an invoice" }],
      },
      replyInTheirLanguage: "Gracias, Lucía. Ya hemos corregido la factura 2381 con la dirección nueva. Puede descargarla desde Facturación.",
    },
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

  // Added last, so the ids of the tickets above stay what links to the demo expect.
  add({
    channel: "email",
    name: "Mateo Alvarez",
    identity: "mateo@harborbooks.test",
    account: "acc_harbor",
    subject: "Trial ends tomorrow and we still can't verify",
    status: "open",
    thread: [
      {
        kind: "inbound",
        ago: 9,
        text: "Hi, our trial ends tomorrow and we haven't been able to test properly: the verification email never arrived, so imports are still locked.\n\nCould you send it again and give us a bit more time? And have we been charged for anything yet?\n\nMateo",
      },
    ],
    ai: {
      insight: { topic: "Account access", urgency: "high", urgencyReason: "Their trial ends tomorrow", mood: "frustrated", language: "en", summary: "Needs the verification email again and more time on the trial" },
      suggestion: {
        kind: "draft",
        text: "Hi Mateo,\n\nSorry about the missing email. I've sent the verification email again to mateo@harborbooks.test, and it should arrive within a few minutes.\n\nI've also extended your trial by 14 days, so you have time to test imports properly. You haven't been charged for anything: your first invoice is only created when the trial ends.",
        reason: null,
        sources: [
          { type: "action", id: "action/run_seed", title: "Look up last invoice", detail: "No invoices yet. The first one is created when the trial ends." },
          { type: "fact", id: "fact:1", title: "Plan" },
          { type: "guidance", id: "guidance", title: "Team guidance" },
        ],
        actions: [
          proposal("resend_verification", { email: "mateo@harborbooks.test" }, "The verification email never reached them."),
          proposal("extend_trial", { days: 14 }, "Their trial ends tomorrow and they couldn't test without verifying."),
        ],
      },
    },
  });

  // Billing is on Autopilot: one reply went out an hour ago, and one is waiting out its delay.
  add({
    channel: "email",
    name: "Giulia Rossi",
    identity: "giulia@rossi.studio",
    account: "acc_rossi",
    subject: "Where do I download last month's invoice?",
    status: "waiting",
    read: true,
    thread: [
      { kind: "inbound", ago: 95, text: "Hello, our accountant needs last month's invoice as a PDF. Where can I download it?\n\nGiulia" },
      {
        kind: "outbound",
        ago: 84,
        text: "Hi Giulia,\n\nYou can download any invoice from Billing, then Invoices: open last month's and choose Download PDF. Everyone with the Admin role on Rossi Studio can do this.",
      },
    ],
    ai: { insight: { topic: "Billing", urgency: "normal", urgencyReason: null, mood: "calm", language: "en", summary: "Needs last month's invoice as a PDF" }, suggestion: null },
  });
  add({
    channel: "email",
    name: "Ingrid Larsen",
    identity: "ingrid@nordvik.test",
    account: "acc_nordvik",
    subject: "Add our VAT number to invoices",
    status: "open",
    thread: [{ kind: "inbound", ago: 7, text: "Hi, our invoices are missing our VAT number. How do we add it, and can last month's invoice be corrected too?\n\nIngrid" }],
    ai: {
      insight: { topic: "Billing", urgency: "normal", urgencyReason: null, mood: "calm", language: "en", summary: "Wants their VAT number on new and past invoices" },
      suggestion: {
        kind: "draft",
        text: "Hi Ingrid,\n\nYou can add your VAT number from Billing, then Company details. Every new invoice carries it from then on.\n\nTo correct last month's invoice, open it under Billing, then Invoices, and choose Edit: the corrected PDF is ready to download straight away.",
        reason: null,
        sources: [
          { type: "knowledge", id: "help-center/invoice-details", title: "Invoices and tax details" },
          { type: "fact", id: "fact:1", title: "Plan" },
        ],
        autopilot: "held",
        sendAt: new Date(Date.now() + 3 * 60_000),
      },
    },
  });

  // What the team's work has taught so far, pointing at the tickets above.
  const about = (subject: string) => {
    const t = state.tickets.find((x) => x.subject === subject)!;
    return { id: t.id, number: t.number, subject: t.subject };
  };
  const payout = about("Payout not received");
  state.guidanceSuggestions = [
    {
      id: "gs_1",
      rule: "When a payout is late, say when it left our side before explaining how long banks take.",
      reason: "In 4 of 6 replies about payouts this month, agents moved the payout date to the first line.",
      tickets: [{ id: payout.id, number: payout.number }],
    },
  ];
  state.gaps = [
    { id: "gap_annual", theme: "Discount for annual billing", count: 1, lastSeenAt: minutes(48), tickets: [about("Do you offer annual billing?")] },
    { id: "gap_export", theme: "CSV export stops at 1,000 rows", count: 1, lastSeenAt: minutes(720), tickets: [about("Export to CSV isn't showing all rows")] },
  ];

  const invoice = about("Where do I download last month's invoice?");
  const sentReply = state.messages.get(invoice.id)!.at(-1)!;
  state.events.get(invoice.id)!.push({
    id: nextId("evt"),
    type: "autopilot_sent",
    actorId: null,
    data: { messageId: sentReply.id, suggestionId: "sug_autopilot_invoice", topic: "Billing", mode: "hold" },
    createdAt: sentReply.createdAt,
  });

  // Each topic's last 30 days, as recorded outcomes add up to in a real install.
  const record = (r: Omit<AutopilotRecord, "recent"> & { recent: [good: number, drafts: number] }): AutopilotRecord => ({
    ...r,
    recent: { good: r.recent[0], drafts: r.recent[1], rate: r.recent[0] / r.recent[1] },
  });
  const never = { mode: null, enabledBy: null, enabledAt: null, pausedAt: null, pauseReason: null };
  state.autopilot.topics = [
    {
      topic: "Payouts",
      stage: "eligible",
      ...never,
      ready: true,
      record: record({ drafts: 41, usedAsIs: 31, lightlyEdited: 6, heavilyEdited: 2, discarded: 2, cameBackUnhappy: 0, flagged: 0, cannotAnswer: 3, sentByAutopilot: 0, reopened: 2, recent: [28, 30], languages: [{ language: "en", drafts: 38, good: 34 }, { language: "es", drafts: 3, good: 3 }] }),
    },
    {
      topic: "Billing",
      stage: "on",
      mode: "hold",
      enabledBy: AGENTS[1]!,
      enabledAt: minutes(6 * 24 * 60),
      pausedAt: null,
      pauseReason: null,
      ready: true,
      record: record({ drafts: 58, usedAsIs: 49, lightlyEdited: 6, heavilyEdited: 1, discarded: 1, cameBackUnhappy: 1, flagged: 0, cannotAnswer: 4, sentByAutopilot: 17, reopened: 1, recent: [29, 30], languages: [{ language: "en", drafts: 53, good: 50 }, { language: "es", drafts: 5, good: 5 }] }),
    },
    {
      topic: "Account access",
      stage: "paused",
      mode: "hold",
      enabledBy: AGENTS[2]!,
      enabledAt: minutes(19 * 24 * 60),
      pausedAt: minutes(26 * 60),
      pauseReason: "quality",
      ready: false,
      record: record({ drafts: 36, usedAsIs: 22, lightlyEdited: 5, heavilyEdited: 5, discarded: 3, cameBackUnhappy: 1, flagged: 0, cannotAnswer: 6, sentByAutopilot: 9, reopened: 3, recent: [25, 30], languages: [{ language: "en", drafts: 36, good: 27 }] }),
    },
    {
      topic: "Exports",
      stage: "collecting",
      ...never,
      ready: false,
      record: record({ drafts: 12, usedAsIs: 7, lightlyEdited: 2, heavilyEdited: 2, discarded: 1, cameBackUnhappy: 0, flagged: 0, cannotAnswer: 5, sentByAutopilot: 0, reopened: 0, recent: [9, 12], languages: [{ language: "en", drafts: 12, good: 9 }] }),
    },
  ];
  const twoFactor = about("Two-factor codes not arriving");
  const billingEmail = about("Change our billing email");
  const exporting = about("Export to CSV isn't showing all rows");
  state.autopilot.examples = {
    Payouts: [
      { suggestionId: "ex_p1", ticket: payout, outcome: "used", byAutopilot: false, at: minutes(170), sent: null, draft: "Hi Emma,\n\nPayouts leave our side every Monday, and banks take up to 3 business days to show them. Yours left on Monday, so it should arrive by Thursday." },
      {
        suggestionId: "ex_p2",
        ticket: payout,
        outcome: "light",
        byAutopilot: false,
        at: minutes(2 * 24 * 60),
        draft: "Hello,\n\nYour payout was sent on Monday. Banks can take up to 3 business days to show it.",
        sent: "Hi Emma,\n\nYour payout was sent on Monday. Banks can take up to 3 business days to show it.",
      },
      {
        suggestionId: "ex_p3",
        ticket: payout,
        outcome: "heavy",
        byAutopilot: false,
        at: minutes(9 * 24 * 60),
        draft: "Hi Emma,\n\nPayouts take up to 3 business days to reach your bank.",
        sent: "Hi Emma,\n\nThis one was held back: the bank account on file was changed last week, and we verify new accounts before paying into them. I've verified it now and the payout goes out today.",
      },
      { suggestionId: "ex_p4", ticket: payout, outcome: "discarded", byAutopilot: false, at: minutes(16 * 24 * 60), sent: null, draft: "Hi Emma,\n\nPayouts leave our side every Monday. Yours is on its way." },
    ],
    Billing: [
      { suggestionId: "sug_autopilot_invoice", ticket: invoice, outcome: "used", byAutopilot: true, at: minutes(84), sent: null, draft: sentReply.text },
      {
        suggestionId: "ex_b2",
        ticket: billingEmail,
        outcome: "light",
        byAutopilot: false,
        at: minutes(3 * 24 * 60),
        draft: "Hi,\n\nYou can change the billing email from Billing, then Company details. Invoices go to the new address from the next one on.",
        sent: "Hi Emma,\n\nYou can change the billing email from Billing, then Company details. Invoices go to the new address from the next one on.",
      },
      { suggestionId: "ex_b3", ticket: billingEmail, outcome: "unhappy", byAutopilot: true, at: minutes(11 * 24 * 60), sent: null, draft: "Hi,\n\nRefunds go back to the original payment method within 5 business days." },
    ],
    "Account access": [
      {
        suggestionId: "ex_a1",
        ticket: twoFactor,
        outcome: "heavy",
        byAutopilot: false,
        at: minutes(27 * 60),
        draft: "Hi,\n\nTwo-factor codes are sent by text message. Check that your phone has signal and ask for a new code.",
        sent: "Hi,\n\nCodes to numbers on your carrier were delayed this morning, and that's fixed now. Ask for a new code and it should arrive within a minute. If you're locked out, reply here and I'll send a one-time recovery link.",
      },
      { suggestionId: "ex_a2", ticket: twoFactor, outcome: "discarded", byAutopilot: false, at: minutes(30 * 60), sent: null, draft: "Hi,\n\nYou can reset two-factor authentication from Settings, then Security." },
      { suggestionId: "ex_a3", ticket: twoFactor, outcome: "used", byAutopilot: true, at: minutes(4 * 24 * 60), sent: null, draft: "Hi,\n\nYou can add another admin from Settings, then Team: choose Invite and pick the Admin role." },
    ],
    Exports: [
      {
        suggestionId: "ex_e1",
        ticket: exporting,
        outcome: "heavy",
        byAutopilot: false,
        at: minutes(12 * 60),
        draft: "Hi,\n\nExports include every row that matches your filters.",
        sent: "Hi,\n\nExports from the table stop at 1,000 rows. For everything, use Reports, then Full export: it's emailed to you as a CSV within a few minutes.",
      },
      { suggestionId: "ex_e2", ticket: exporting, outcome: "used", byAutopilot: false, at: minutes(5 * 24 * 60), sent: null, draft: "Hi,\n\nYou can export any table from the menu at its top right, as CSV or Excel." },
    ],
  };
  return state;
}

const FOLLOW_UPS = [
  "Thanks, that's exactly what I needed!",
  "Got it, I'll try that now and let you know.",
  "Perfect, thank you for the quick answer.",
];

/** What the scripted AI says about a message nobody wrote a script for. */
function scriptedInsight(text: string): TicketInsight {
  const sentence = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return { topic: "other", urgency: "normal", urgencyReason: null, mood: "calm", language: "en", summary: sentence.slice(0, 110) };
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

/** Stand-ins for the model's rewrites, good enough to show the controls working. */
const REWRITES = {
  shorter(text: string) {
    const paragraphs = text.split(/\n{2,}/);
    const greeting = /^(hi|hello|hey|dear|hola|gracias)\b[^\n]{0,30}$/i.test(paragraphs[0] ?? "") ? paragraphs.shift()! : null;
    // Pleasantries go first; then everything after the first paragraph.
    const filler = /^(thanks|thank you|happy to help|let me know)\b/i;
    const kept = paragraphs.map((p) => sentences(p).filter((line) => !filler.test(line))).filter((p) => p.length);
    const first = kept[0] ?? sentences(paragraphs.join(" "));
    const body = (kept.length > 1 ? first : first.slice(0, Math.max(1, Math.ceil(first.length / 2)))).join(" ");
    return greeting ? `${greeting}\n\n${body}` : body;
  },
  friendlier(text: string) {
    const closing = "Happy to help with anything else.";
    const opened = /thanks|thank you|gracias/i.test(text.slice(0, 80)) ? text : text.replace(/^((?:hi|hello|hey)[^\n]*\n\n)?/i, (greeting) => `${greeting}Thanks for reaching out! `);
    return opened.includes(closing) ? opened : `${opened.trimEnd()}\n\n${closing}`;
  },
  formal(text: string) {
    return text
      .replace(/^(hi|hey|hello)\b/i, "Dear")
      .replace(/!/g, ".")
      .replace(/\bwe'll\b/gi, "we will")
      .replace(/\bI'll\b/g, "I will")
      .replace(/\bit's\b/gi, "it is")
      .replace(/\bhasn't\b/gi, "has not")
      .replace(/\bcan't\b/gi, "cannot")
      .replace(/\bdon't\b/gi, "do not")
      .replace(/\bThanks for\b/g, "Thank you for");
  },
};

/** A support client backed by browser memory. `onChange` fires when the customer writes back. */
/** The agent and portal clients, sharing one in-browser state: a portal request lands in the inbox. */
export function createDemoClients(onChange: () => void): { agent: SupportClient; portal: SupportPortalClient } {
  ids = 0; // the same ticket ids every time, so links like ?ticket=tkt_1 are stable
  const s = seed();
  const delay = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 120));
  /** As long as a model takes to answer. */
  const thinking = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 900));
  /** What your directory's describeCustomer returns. */
  const accountFacts = (id: string | null) => {
    const a = ACCOUNTS.find((x) => x.id === id);
    if (!a) return [];
    return [
      { label: "Plan", value: `${a.plan} · ${a.seats} seats` },
      { label: "Customer since", value: a.since },
      { label: "Last order", value: a.lastOrder },
      ...(a.lastPayout ? [{ label: "Last payout", value: a.lastPayout }] : []),
    ];
  };
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
      urgency: s.insights.get(t.id)?.urgency ?? null,
      summary: s.insights.get(t.id)?.summary ?? null,
      draftReady: s.suggestions.get(t.id)?.kind === "draft",
    };
  };

  // The scripted AI reads each new customer message a moment after it arrives.
  const understand = (t: Ticket, text: string, reply: string | null) => {
    s.suggestions.delete(t.id);
    setTimeout(() => {
      s.insights.set(t.id, { ...scriptedInsight(text), topic: s.insights.get(t.id)?.topic ?? "other" });
      if (s.ai.draftOnArrival) {
        s.suggestions.set(
          t.id,
          reply
            ? { id: nextId("sug"), kind: "draft", text: reply, reason: null, sources: [{ type: "guidance", id: "guidance", title: "Team guidance" }] }
            : { id: nextId("sug"), kind: "cannot_answer", text: null, reason: "no help article covers this yet.", sources: [] }
        );
      }
      onChange();
    }, 1500);
  };
  const URGENCY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

  // Autopilot. A topic nobody switched on is "eligible" or "collecting" by its record alone.
  const pilot = s.autopilot;
  const meets = (topic: AutopilotTopic) => topic.record.recent.drafts >= pilot.minDrafts && topic.record.recent.rate >= pilot.minRate;
  const restage = () => {
    for (const topic of pilot.topics) {
      topic.ready = meets(topic);
      if (topic.stage === "collecting" || topic.stage === "eligible") topic.stage = topic.ready ? "eligible" : "collecting";
    }
  };
  /** Sends the held replies whose time has come, as the scheduled run does. */
  const sendDue = () => {
    for (const [ticketId, suggestion] of s.suggestions) {
      if (suggestion.autopilot !== "held" || !suggestion.sendAt || +new Date(suggestion.sendAt) > Date.now()) continue;
      const t = ticket(ticketId);
      const topic = pilot.topics.find((x) => x.topic === s.insights.get(ticketId)?.topic);
      if (pilot.stopped || topic?.stage !== "on" || t.status !== "open") {
        s.suggestions.set(ticketId, { ...suggestion, autopilot: "cancelled", autopilotBlock: pilot.stopped ? "stopped" : "moved_on", sendAt: null });
        continue;
      }
      const at = new Date();
      const sent = message({ kind: "outbound", text: suggestion.text ?? "", createdAt: at, to: recipients(t).to ? [recipients(t).to!] : [] });
      s.messages.get(ticketId)!.push(sent);
      s.events.get(ticketId)!.push({ id: nextId("evt"), type: "autopilot_sent", actorId: null, data: { messageId: sent.id, suggestionId: suggestion.id, topic: topic.topic, mode: topic.mode }, createdAt: at });
      s.suggestions.delete(ticketId);
      topic.record = { ...topic.record, drafts: topic.record.drafts + 1, usedAsIs: topic.record.usedAsIs + 1, sentByAutopilot: topic.record.sentByAutopilot + 1 };
      pilot.examples[topic.topic] = [
        { suggestionId: suggestion.id, ticket: { id: t.id, number: t.number, subject: t.subject }, outcome: "used", byAutopilot: true, at, sent: null, draft: sent.text },
        ...(pilot.examples[topic.topic] ?? []),
      ];
      t.status = "waiting";
      t.waitingSince = null;
      t.lastMessageAt = at;
      t.answered = true;
      onChange();
    }
  };
  for (const suggestion of s.suggestions.values()) {
    if (suggestion.autopilot === "held" && suggestion.sendAt && typeof window !== "undefined") setTimeout(sendDue, Math.max(0, +new Date(suggestion.sendAt) - Date.now()) + 50);
  }

  // The customer writes back a few seconds after your first reply, so you see the ticket reopen.
  const customerAnswers = (t: Ticket) => {
    if (t.answered) return;
    t.answered = true;
    setTimeout(() => {
      const at = new Date();
      understand(t, FOLLOW_UPS[t.number % FOLLOW_UPS.length]!, "You're welcome! I'll mark this as solved. Just reply here if anything else comes up.");
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
      const rank = (t: Ticket) => (q.sort === "priority" ? URGENCY_RANK[s.insights.get(t.id)?.urgency ?? "normal"] : 0);
      items.sort((a, b) =>
        q.status === "open"
          ? rank(a) - rank(b) || +(a.waitingSince ?? a.lastMessageAt) - +(b.waitingSince ?? b.lastMessageAt)
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
      sendDue();
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
        accountFacts: accountFacts(t.customerId),
        insight: s.insights.get(id) ?? null,
        suggestion: s.suggestions.get(id) ?? null,
      });
    },

    async reply({ ticketId, text, attachmentIds, status, cc }) {
      const t = ticket(ticketId);
      const at = new Date();
      s.suggestions.delete(ticketId);
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

    ai: {
      async refine({ ticketId, text, instruction }) {
        const custom = typeof instruction === "object" ? instruction.custom.toLowerCase() : "";
        const kind =
          typeof instruction === "string"
            ? instruction
            : /short|brief|concise/.test(custom)
              ? "shorter"
              : /formal|professional/.test(custom)
                ? "formal"
                : /apolog|sorry/.test(custom)
                  ? "apology"
                  : "friendlier";
        const result =
          kind === "translate"
            ? s.localized.get(ticketId) ?? text
            : kind === "apology"
              ? text.replace(/^((?:hi|hello|hey|dear)[^\n]*\n\n)?/i, (greeting) => `${greeting}I'm sorry for the trouble. `)
              : REWRITES[kind](text);
        return thinking({ text: result });
      },

      async writeUp({ ticketId, notes }) {
        const t = ticket(ticketId);
        const name = t.contact.name?.split(" ")[0];
        const body = sentences(notes.replace(/\s+/g, " ").trim())
          .map((line) => line.replace(/^can /i, "we can ").replace(/^no (.+?) yet/i, "we don't have $1 yet").replace(/\bthey\b/g, "you"))
          .map((line) => line[0]!.toUpperCase() + line.slice(1).replace(/([^.!?])$/, "$1."))
          .join(" ");
        return thinking({ text: `${name ? `Hi ${name},` : "Hi,"}\n\nThanks for your patience. ${body}\n\nLet me know if anything is unclear.` });
      },

      async translate({ messageId }) {
        const known = s.translations.get(messageId);
        if (!known) throw new Error("The demo only translates its own sample messages.");
        return thinking({ text: known });
      },

      async draft({ ticketId }) {
        const t = ticket(ticketId);
        const last = s.messages.get(ticketId)!.filter((m) => m.kind === "inbound").at(-1);
        s.suggestions.set(ticketId, {
          id: nextId("sug"),
          kind: "draft",
          text: `${t.contact.name ? `Hi ${t.contact.name.split(" ")[0]},` : "Hi,"}\n\nThanks for your message. I'm looking into this now and will come back to you shortly.`,
          reason: null,
          sources: [{ type: "guidance", id: "guidance", title: "Team guidance" }],
        });
        if (last && !s.insights.has(ticketId)) s.insights.set(ticketId, scriptedInsight(last.text));
        return thinking({ ok: true });
      },

      async listActions({ ticketId }) {
        const t = ticket(ticketId);
        if (!t.customerId) return delay([]);
        return delay(DEMO_ACTIONS.map(({ name, title, description, approval, fields }) => ({ name, title, description, approval, fields })));
      },

      async runAction({ ticketId, action: name, input, suggestionId, text }) {
        const t = ticket(ticketId);
        const action = DEMO_ACTIONS.find((a) => a.name === name);
        const account = ACCOUNTS.find((a) => a.id === t.customerId);
        if (!action || !account) throw new Error("This action isn't available for this ticket.");
        const run: ActionRun = { id: nextId("run"), ...action.run(input, account) };
        event(ticketId, "action_run", { runId: run.id, action: name, title: action.title, status: run.status, summary: run.summary, input });
        const suggestion = s.suggestions.get(ticketId);
        const proposed = suggestionId && suggestion?.id === suggestionId ? suggestion.actions?.find((a) => a.name === name) : undefined;
        if (!proposed) return thinking({ run });
        const edited = JSON.stringify(proposed.input) !== JSON.stringify(input);
        const state = run.status === "succeeded" ? ("done" as const) : ("failed" as const);
        s.suggestions.set(ticketId, { ...suggestion!, actions: suggestion!.actions!.map((a) => (a.name === name ? { ...a, input, run, state } : a)) });
        return thinking({ run, text: edited && run.status === "succeeded" && text ? action.rewritten?.(text, input) ?? null : null });
      },

      async declineAction({ ticketId, suggestionId, action: name, text }) {
        const suggestion = s.suggestions.get(ticketId);
        const proposed = suggestion?.id === suggestionId ? suggestion.actions?.find((a) => a.name === name) : undefined;
        if (!proposed) throw new Error("This suggestion is no longer current. Reload the ticket.");
        s.suggestions.set(ticketId, { ...suggestion!, actions: suggestion!.actions!.map((a) => (a.name === name ? { ...a, state: "declined" as const } : a)) });
        return thinking({ text: text ? DEMO_ACTIONS.find((a) => a.name === name)?.without?.(text) ?? null : null });
      },

      async setActionEnabled({ name, enabled }) {
        s.ai = { ...s.ai, actions: s.ai.actions?.map((action) => (action.name === name && action.approval === "never" ? { ...action, enabled } : action)) };
        return delay({ ok: true });
      },

      async getAutopilot() {
        sendDue();
        const { examples: _, ...overview } = pilot;
        return delay({ ...overview, topics: pilot.topics.map((topic) => ({ ...topic, record: { ...topic.record } })) });
      },

      async setAutopilotTopic({ topic: name, on, mode }) {
        const topic = pilot.topics.find((x) => x.topic === name);
        if (!topic) throw new Error("Choose one of your topics.");
        if (!on) {
          topic.pausedAt = null;
          topic.pauseReason = null;
          topic.stage = meets(topic) ? "eligible" : "collecting";
        } else if (topic.stage === "on") {
          topic.mode = mode ?? topic.mode;
        } else {
          const { good, drafts } = topic.record.recent;
          if (!meets(topic)) {
            throw new Error(`This topic isn't ready for Autopilot. It needs ${pilot.minDrafts} recent drafts with ${Math.round(pilot.minRate * 100)}% sent as drafted or lightly edited, and has ${good} of ${drafts}.`);
          }
          Object.assign(topic, { stage: "on", mode: mode ?? topic.mode ?? "hold", enabledBy: VIEWER, enabledAt: new Date(), pausedAt: null, pauseReason: null });
        }
        return delay({ ok: true });
      },

      async setAutopilot({ stopped, minDrafts, minRate }) {
        if (stopped !== undefined) Object.assign(pilot, stopped ? { stopped: true, stoppedBy: VIEWER, stoppedAt: new Date() } : { stopped: false, stoppedBy: null, stoppedAt: null });
        if (minDrafts !== undefined) pilot.minDrafts = Math.max(pilot.floor.minDrafts, minDrafts ?? 0);
        if (minRate !== undefined) pilot.minRate = Math.max(pilot.floor.minRate, minRate ?? 0);
        restage();
        return delay({ ok: true });
      },

      async autopilotExamples({ topic, only }) {
        const examples = pilot.examples[topic] ?? [];
        return delay(only === "changed" ? examples.filter((example) => example.outcome !== "used" && example.outcome !== "light") : examples);
      },

      async holdAutopilotReply({ suggestionId }) {
        for (const [ticketId, suggestion] of s.suggestions) {
          if (suggestion.id === suggestionId) s.suggestions.set(ticketId, { ...suggestion, autopilot: "cancelled", autopilotBlock: "held_back", sendAt: null });
        }
        return delay({ ok: true });
      },

      async flagAutopilotReply({ suggestionId, note }) {
        for (const t of s.tickets) {
          const events = s.events.get(t.id)!;
          const sent = events.find((e) => e.type === "autopilot_sent" && e.data.suggestionId === suggestionId);
          if (!sent || events.some((e) => e.type === "autopilot_flagged" && e.data.suggestionId === suggestionId)) continue;
          event(t.id, "autopilot_flagged", { messageId: sent.data.messageId, suggestionId, topic: sent.data.topic, note: note ?? null });
          const topic = pilot.topics.find((x) => x.topic === sent.data.topic);
          if (topic) {
            const { record } = topic;
            const good = Math.max(0, record.recent.good - 1);
            topic.record = { ...record, usedAsIs: Math.max(0, record.usedAsIs - 1), flagged: record.flagged + 1, recent: { ...record.recent, good, rate: good / record.recent.drafts } };
            if (topic.stage === "on") Object.assign(topic, { stage: "paused", pausedAt: new Date(), pauseReason: "flagged" });
            topic.ready = meets(topic);
            pilot.examples[topic.topic] = (pilot.examples[topic.topic] ?? []).map((example) => (example.suggestionId === suggestionId ? { ...example, outcome: "flagged" } : example));
          }
          if (t.status !== "open") {
            event(t.id, "status_changed", { from: t.status, to: "open" });
            t.status = "open";
            t.waitingSince = new Date();
          }
        }
        return delay({ ok: true });
      },

      async discardSuggestion({ id }) {
        for (const [ticketId, suggestion] of s.suggestions) if (suggestion.id === id) s.suggestions.delete(ticketId);
        return delay({ ok: true });
      },

      async setInsight({ ticketId, topic, urgency }) {
        const current = s.insights.get(ticketId) ?? scriptedInsight("");
        if (urgency && urgency !== current.urgency) event(ticketId, "insight_changed", { urgency: { from: current.urgency, to: urgency } });
        if (topic && topic !== current.topic) event(ticketId, "insight_changed", { topic: { from: current.topic, to: topic } });
        s.insights.set(ticketId, { ...current, ...(topic ? { topic } : {}), ...(urgency ? { urgency, urgencyReason: null } : {}) });
        return delay({ ok: true });
      },

      async getSettings() {
        return delay({ ...s.ai, topics: [...s.ai.topics], sources: s.ai.sources.map((source) => ({ ...source })) });
      },

      async updateSettings(patch) {
        s.ai = { ...s.ai, ...patch };
        return delay({ ok: true });
      },

      async syncKnowledge() {
        s.ai.sources = s.ai.sources.map((source) => ({ ...source, syncedAt: new Date() }));
        return thinking({ ok: true });
      },

      async listApprovedAnswers() {
        return delay(s.answers.map((answer) => ({ ...answer })));
      },

      async generaliseAnswer({ ticketId, text }) {
        const t = ticket(ticketId);
        const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let general = text;
        const first = t.contact.name?.split(" ")[0];
        const company = customer(t.customerId)?.name;
        if (company) general = general.replace(new RegExp(escaped(company), "gi"), "{company}");
        if (first) general = general.replace(new RegExp(`\\b${escaped(first)}\\b`, "g"), "{name}");
        general = general.replace(/ of \$[\d,]+(?:\.\d+)?/g, "").replace(/#\d{3,}/g, "your order");
        const summary = s.insights.get(ticketId)?.summary;
        return thinking({ title: t.subject ?? summary ?? "", text: general, language: s.insights.get(ticketId)?.language ?? null });
      },

      async saveApprovedAnswer({ id, title, text, language, gapId }) {
        if (id) s.answers = s.answers.map((answer) => (answer.id === id ? { ...answer, title, text, language } : answer));
        else s.answers.push({ id: nextId("ans"), title, text, language });
        if (gapId) s.gaps = s.gaps.filter((gap) => gap.id !== gapId);
        return delay({ ok: true });
      },

      async deleteApprovedAnswer({ id }) {
        s.answers = s.answers.filter((answer) => answer.id !== id);
        return delay({ ok: true });
      },

      async listGuidanceSuggestions() {
        return delay(s.guidanceSuggestions.map((suggestion) => ({ ...suggestion })));
      },

      async decideGuidanceSuggestion({ id, accept, rule }) {
        const suggestion = s.guidanceSuggestions.find((x) => x.id === id);
        s.guidanceSuggestions = s.guidanceSuggestions.filter((x) => x.id !== id);
        if (accept && suggestion) s.ai = { ...s.ai, guidance: `${s.ai.guidance.trim()}\n${(rule ?? suggestion.rule).trim()}`.trim() };
        return delay({ ok: true });
      },

      async listGaps() {
        return delay(s.gaps.map((gap) => ({ ...gap })));
      },

      async dismissGap({ id }) {
        s.gaps = s.gaps.filter((gap) => gap.id !== id);
        return delay({ ok: true });
      },

      // The scripted article is the agent's own reply, greeting removed, under the question.
      async draftArticle(input) {
        const gap = "gapId" in input ? s.gaps.find((x) => x.id === input.gapId) : undefined;
        const tickets = (gap ? gap.tickets.map((x) => x.id) : "ticketIds" in input ? input.ticketIds : []).map(ticket);
        const reply = tickets.flatMap((t) => s.messages.get(t.id)!.filter((m) => m.kind === "outbound")).at(-1);
        if (!reply) throw new Error("None of these tickets has an answer yet. Answer one first.");
        if (gap?.id === "gap_export" && reply.authorId !== VIEWER.id) {
          return thinking({
            title: "Why does my CSV export stop at 1,000 rows?",
            markdown:
              "Exports used to stop at 1,000 rows. We've raised that limit, so a new export includes every row.\n\n## If rows are still missing\n\nRun the export again. If it still stops short, reply to your ticket and we'll take a look.",
          });
        }
        const answer = reply.text.replace(/^(hi|hello|hey|dear|thanks|gracias)\b[^\n.!?]*[,.!]?\s*/i, "").trim();
        return thinking({
          title: gap?.theme ?? tickets[0]?.subject ?? "",
          markdown: `${answer[0]?.toUpperCase() ?? ""}${answer.slice(1)}\n\n## Still not working?\n\nReply to your ticket with what you see, and we'll take a look.`,
        });
      },

      // Voice uses the browser's own speech recognition. Browsers without one record the
      // microphone, send nothing anywhere and get this transcript back, so voice still shows.
      ...(typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
        ? {}
        : {
            async transcribe() {
              return thinking({ text: "Verification is still pending. Can offer an onboarding call this week." });
            },
          }),
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
      understand(s.tickets.at(-1)!, `${subject}. ${text}`, null);
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
      understand(t, text, null);
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
