import type {
  ActionField,
  ActionRun,
  Agent,
  AiInsights,
  AiSettings,
  ApprovedAnswer,
  AskResult,
  AutopilotExample,
  AutopilotOverview,
  AutopilotRecord,
  AutopilotTopic,
  BroadcastPreview,
  Customer,
  FileInfo,
  Gap,
  GuidanceSuggestion,
  Outreach,
  OutreachKind,
  PortalMessage,
  PortalTicket,
  ProposedAction,
  Recipient,
  DaySeries,
  PeriodTotals,
  Spike,
  StartChannel,
  StartTicketInput,
  Suggestion,
  SuggestionSource,
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
import { INCIDENT_KIND, handoffNote, personalise, type AskTurn } from "@/registry/support/proactive";

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
 * And Insights: months of history don't fit in a browser tab, so the dashboard's totals are
 * generated here (the same every visit), while the spike is real: six customers wrote about
 * payouts in the last hour, and those tickets are in the inbox.
 * And writing first: a new ticket, a sent proposal and an incident message all open a ticket
 * through one path, and it shows in the customer's portal. The Outreach queue starts with one
 * proposal waiting and one about to send on its own; `demoSignal()` reports another, as your
 * product would. The portal's Ask box answers four subjects from Northwind Coffee's account and
 * the help center, and hands everything else to a person.
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
  spikes: Spike[];
  /** The Outreach queue, with what was sent or dismissed. */
  outreach: Outreach[];
  outreachKinds: OutreachKind[];
  /** The customers written to about each spike. */
  broadcasts: Map<string, Set<string>>;
  /** The portal's Ask conversations, by session id. */
  asks: Map<string, { turns: AskTurn[]; helpful: boolean | null; ticketId: string | null }>;
  autopilot: Omit<AutopilotOverview, "topics"> & { topics: AutopilotTopic[]; examples: Record<string, AutopilotExample[]> };
  messages: Map<string, TimelineMessage[]>;
  events: Map<string, TimelineEvent[]>;
  reads: Map<string, Date>;
  files: Map<string, { info: FileInfo; url: string }>;
  seq: number;
};

const minutes = (n: number) => new Date(Date.now() - n * 60_000);

/** A track record, as recorded outcomes add up to in a real install. */
const record = (r: Omit<AutopilotRecord, "recent"> & { recent: [good: number, drafts: number] }): AutopilotRecord => ({
  ...r,
  recent: { good: r.recent[0], drafts: r.recent[1], rate: r.recent[0] / r.recent[1] },
});

/** What outreach kinds need before they send on their own: the engine's defaults. */
const OUTREACH = { minDrafts: 10, minRate: 0.9, windowDays: 90, holdMinutes: 10 };

const article = (slug: string, title: string): SuggestionSource => ({ type: "knowledge", id: `help-center/${slug}`, title, url: `https://help.acme.test/${slug}` });
const ARTICLES = {
  payouts: article("payout-schedule", "Payout schedule"),
  bank: article("bank-account", "Change your bank account"),
  refunds: article("refunds", "Refund an order"),
  invoices: article("invoice-details", "Invoices and tax details"),
  team: article("team-roles", "Invite your team"),
  documents: article("verification-documents", "Verification documents"),
  cards: article("payment-methods", "Update your payment method"),
  start: article("getting-started", "Getting started"),
};

/** A signal as your product would report it, with the message the scripted AI writes for it. */
type DemoSignal = Pick<Outreach, "kind" | "title" | "facts" | "sources"> & { account: string; to: string; subject: string; text: string };
const SIGNALS: DemoSignal[] = [
  {
    kind: "card_expiring",
    account: "acc_sol",
    to: "lucia@clinicasol.test",
    title: "The card on file expires this month",
    facts: [
      { label: "Card", value: "Visa ending 4242" },
      { label: "Next invoice", value: "$49.00 on the 1st" },
    ],
    subject: "Your card on file expires this month",
    text: "Hi Lucia,\n\nThe Visa ending 4242 on Clínica Sol's account expires this month, and your next invoice of $49.00 is due on the 1st.\n\nYou can add a new card from Billing, then Payment method. It takes effect straight away, so the next invoice is charged to it.",
    sources: [
      { type: "fact", id: "fact:1", title: "Card" },
      { type: "fact", id: "fact:2", title: "Next invoice" },
      ARTICLES.cards,
    ],
  },
  {
    kind: "payouts_failing",
    account: "acc_rossi",
    to: "sofia@rossi.studio",
    title: "Payouts have failed 2 times since Tuesday",
    facts: [
      { label: "Failed payouts", value: "2 since Tuesday" },
      { label: "Bank's reason", value: "Account details don't match" },
      { label: "Amount held", value: "$625.00" },
    ],
    subject: "Your payouts are failing",
    text: "Hi Sofia,\n\nYour last 2 payouts to Rossi Studio's bank account have failed since Tuesday. The bank's reason both times was that the account details don't match, so $625.00 is waiting on our side.\n\nYou can check the account name and number from Settings, then Payouts. Once they're corrected, the amount held goes out with the next payout.",
    sources: [
      { type: "fact", id: "fact:1", title: "Failed payouts" },
      { type: "fact", id: "fact:2", title: "Bank's reason" },
      ARTICLES.bank,
    ],
  },
  {
    kind: "document_expiring",
    account: "acc_harbor",
    to: "mateo@harborbooks.test",
    title: "Proof of address expires in 7 days",
    facts: [
      { label: "Document", value: "Proof of address" },
      { label: "Expires", value: "In 7 days" },
    ],
    subject: "Your proof of address expires in 7 days",
    text: "Hi Mateo,\n\nThe proof of address on file for Harbor Books expires in 7 days. After that date, payouts pause until a current one is uploaded.\n\nYou can upload a new document from Settings, then Verification. We review it within one business day.",
    sources: [
      { type: "fact", id: "fact:1", title: "Document" },
      { type: "fact", id: "fact:2", title: "Expires" },
      ARTICLES.documents,
    ],
  },
];

let report: (() => string | null) | null = null;
/**
 * Reports the next scripted signal, as `support.ai.signal()` would from your product: a proposal
 * appears in the Outreach queue and its message is written a moment later. Returns the proposal's
 * id, or null once every scripted signal has been reported.
 */
export function demoSignal(): string | null {
  return report?.() ?? null;
}

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
      selfServe: true,
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
    spikes: [],
    outreach: [],
    outreachKinds: [],
    broadcasts: new Map(),
    asks: new Map(),
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

  // A spike: in the last hour, six different customers wrote that today's payout hasn't arrived.
  const late: [name: string, identity: string, account: string | null, ago: number, subject: string, text: string][] = [
    ["Tom Becker", "tom@atlasfreight.test", "acc_atlas", 68, "Today's payout hasn't arrived", "Today's payout hasn't arrived. It normally lands before 9. Is something wrong on your side?"],
    ["Lucia Romero", "lucia@clinicasol.test", "acc_sol", 55, "Payout expected this morning is missing", "We were expecting our payout this morning and nothing has come in. Can you check?"],
    ["Giulia Rossi", "giulia@rossi.studio", "acc_rossi", 41, "Marked as paid, nothing at the bank", "No payout today? The dashboard says paid but our bank shows nothing."],
    ["Ingrid Larsen", "ingrid@nordvik.test", "acc_nordvik", 33, "Payout paid but not received", "Our payout is marked as paid but hasn't reached the bank. Two of our stores are asking."],
    ["Mateo Alvarez", "mateo@harborbooks.test", "acc_harbor", 19, "First payout didn't arrive", "Our first payout was due today and it isn't in our account. Did we set something up wrong?"],
    ["Hana Sato", "hana@kumo.test", null, 12, "Is today's payout delayed?", "Hi, today's payout is missing. Is there a delay?"],
  ];
  for (const [name, identity, account, ago, subject, text] of late) {
    add({
      channel: "email",
      name,
      identity,
      account,
      subject,
      status: "open",
      thread: [{ kind: "inbound", ago, text }],
      ai: { insight: { topic: "Payouts", urgency: "high", urgencyReason: "A payout is late", mood: "calm", language: "en", summary: "Today's payout hasn't reached their bank" }, suggestion: null },
    });
  }
  const payoutTickets = state.tickets.slice(-late.length);
  state.spikes = [
    {
      id: "spike_payouts",
      topic: "Payouts",
      startedAt: minutes(68),
      detectedAt: minutes(18),
      endedAt: null,
      tickets: payoutTickets.length,
      customers: payoutTickets.length,
      usual: 1.4,
      acknowledgedAt: null,
      acknowledgedBy: null,
      messaged: 0,
      latest: [...payoutTickets].reverse().slice(0, 5).map(({ id, number, subject }) => ({ id, number, subject })),
    },
    {
      id: "spike_access",
      topic: "Account access",
      startedAt: minutes(9 * 24 * 60 + 95),
      detectedAt: minutes(9 * 24 * 60 + 50),
      endedAt: minutes(9 * 24 * 60 - 190),
      tickets: 14,
      customers: 11,
      usual: 2.1,
      acknowledgedAt: minutes(9 * 24 * 60 + 41),
      acknowledgedBy: AGENTS[1]!,
      messaged: 0,
      latest: [],
    },
  ];

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
    { id: "gap_annual", theme: "Discount for annual billing", count: 6, lastSeenAt: minutes(48), tickets: [about("Do you offer annual billing?")] },
    { id: "gap_export", theme: "CSV export stops at 1,000 rows", count: 9, lastSeenAt: minutes(720), tickets: [about("Export to CSV isn't showing all rows")] },
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

  // Each topic's last 30 days.
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

  // Outreach: two signals your product reported. One waits for an agent; the other is of a kind
  // the team lets send on its own, and waits out its delay.
  const person = (address: string) => {
    const contact = state.tickets.find((t) => t.contact.identities[0]?.value === address)!.contact;
    const account = ACCOUNTS.find((a) => a.id === contact.customerId)!;
    return { customer: { id: account.id, name: account.name }, contact: { id: contact.id, name: contact.name, address } };
  };
  const waiting = { language: "en", autoBlock: null, lastError: null, ticketId: null, auto: false, decidedBy: null, drafted: true, decidedAt: null };
  state.outreach = [
    {
      id: "out_payouts",
      kind: "payouts_failing",
      title: "Payouts have failed 3 times since Monday",
      facts: [
        { label: "Failed payouts", value: "3 since Monday" },
        { label: "Bank's reason", value: "Account closed" },
        { label: "Amount held", value: "$2,480.00" },
      ],
      ...person("tom@atlasfreight.test"),
      subject: "Your payouts are failing",
      text: "Hi Tom,\n\nYour last 3 payouts to Atlas Freight's bank account have failed since Monday. The bank's reason each time was that the account is closed, so $2,480.00 is waiting on our side.\n\nYou can add a new bank account from Settings, then Payouts. Once it's verified, the amount held goes out with the next payout.\n\nIf the account should still be open, reply here and we'll check with the bank.",
      sources: [
        { type: "fact", id: "fact:1", title: "Failed payouts" },
        { type: "fact", id: "fact:2", title: "Bank's reason" },
        ARTICLES.bank,
      ],
      ...waiting,
      status: "pending",
      sendAt: null,
      createdAt: minutes(22),
    },
    {
      id: "out_document",
      kind: "document_expiring",
      title: "Business licence expires in 14 days",
      facts: [
        { label: "Document", value: "Business licence" },
        { label: "Expires", value: "In 14 days" },
      ],
      ...person("sara@nordvik.io"),
      subject: "Your business licence expires in 14 days",
      text: "Hi Sara,\n\nThe business licence on file for Nordvik expires in 14 days. After that date, payouts pause until a current one is uploaded.\n\nYou can upload the renewed licence from Settings, then Verification. We review it within one business day.",
      sources: [
        { type: "fact", id: "fact:1", title: "Document" },
        { type: "fact", id: "fact:2", title: "Expires" },
        ARTICLES.documents,
      ],
      ...waiting,
      status: "held",
      sendAt: new Date(Date.now() + OUTREACH.holdMinutes * 60_000),
      createdAt: minutes(0),
    },
  ];
  state.outreachKinds = [
    {
      kind: "document_expiring",
      example: "Business licence expires in 14 days",
      stage: "on",
      enabledBy: AGENTS[1]!,
      enabledAt: minutes(12 * 24 * 60),
      pausedAt: null,
      ready: true,
      record: record({ drafts: 24, usedAsIs: 21, lightlyEdited: 2, heavilyEdited: 1, discarded: 0, cameBackUnhappy: 0, flagged: 0, cannotAnswer: 0, sentByAutopilot: 9, reopened: 0, recent: [10, 10], languages: [{ language: "en", drafts: 22, good: 21 }, { language: "es", drafts: 2, good: 2 }] }),
    },
    {
      kind: "payouts_failing",
      example: "Payouts have failed 3 times since Monday",
      stage: "eligible",
      enabledBy: null,
      enabledAt: null,
      pausedAt: null,
      ready: true,
      record: record({ drafts: 14, usedAsIs: 10, lightlyEdited: 3, heavilyEdited: 1, discarded: 0, cameBackUnhappy: 0, flagged: 0, cannotAnswer: 0, sentByAutopilot: 0, reopened: 1, recent: [9, 10], languages: [{ language: "en", drafts: 14, good: 13 }] }),
    },
  ];
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

  // Writing first. Everyone the inbox knows, one entry per person: Lucia's phone and email are one recipient.
  const people = (): Recipient[] => {
    const known = new Map<string, Recipient>();
    for (const t of s.tickets) {
      if (t.status === "spam") continue;
      const c = t.contact;
      const key = c.customerId && c.name ? `${c.customerId}:${c.name}` : (c.identities[0]?.value ?? c.id);
      const entry = known.get(key);
      if (!entry) known.set(key, { id: c.id, name: c.name, identities: [...c.identities], customer: customer(c.customerId) });
      else for (const identity of c.identities) if (!entry.identities.some((i) => i.value === identity.value)) entry.identities.push(identity);
    }
    return [...known.values()];
  };
  const person = (contactId: string) => {
    const own = s.tickets.find((t) => t.contact.id === contactId)?.contact;
    return own ? (people().find((p) => p.identities.some((i) => own.identities.some((o) => o.value === i.value))) ?? null) : null;
  };

  /**
   * Opens a ticket with a message from the team, as the service's `openConversation` does: New
   * ticket, a sent proposal and an incident message all come through here. `by` is null for a
   * message that went out on its own.
   */
  const openConversation = (input: StartTicketInput, by: Agent | null, data: Record<string, unknown> = {}) => {
    const text = input.text.trim();
    if (!text) throw new Error("Write a message first.");
    const kind = (input.channelId ?? "email") as ChannelKind;
    const ch = CHANNELS[kind] as (typeof CHANNELS)[ChannelKind] | undefined;
    if (!ch) throw new Error("That channel isn't configured.");
    if (kind === "whatsapp") throw new Error("This channel only accepts a first message from an approved template. Use email or SMS.");
    const subject = kind === "email" ? (input.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (kind === "email" && !subject) throw new Error("Add a subject.");
    const limit = ch.capabilities.maxTextLength;
    if (limit && text.length > limit) throw new Error(`Messages on this channel are limited to ${limit} characters.`);

    const identityKind = kind === "email" ? "email" : "phone";
    let known: Recipient | null;
    let value: string;
    if ("contactId" in input.to) {
      known = person(input.to.contactId);
      if (!known) throw new Error("That person isn't in the inbox.");
      const identity = known.identities.find((i) => i.kind === identityKind);
      if (!identity) throw new Error("This person has no address on this channel.");
      value = identity.value;
    } else {
      value = kind === "email" ? input.to.address.trim().toLowerCase() : input.to.address.trim();
      if (!value) throw new Error("Choose who to write to.");
      if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Enter a valid email address.");
      if (kind === "email" && value.endsWith("@acme.com")) throw new Error("That's one of your own support addresses.");
      known = people().find((p) => p.identities.some((i) => i.value.toLowerCase() === value.toLowerCase())) ?? null;
    }
    const name = known?.name ?? ("address" in input.to ? input.to.name?.trim() || null : null);
    const linked = known?.customer?.id ?? null;
    // A ticket shows in its customer's portal: it never mixes one customer's person with another's account.
    if (input.customerId && linked && input.customerId !== linked) throw new Error("This person belongs to another customer.");
    const customerId = linked ?? input.customerId ?? null;
    if (customerId && !linked) {
      for (const t of s.tickets) {
        if (t.contact.identities.some((i) => i.value === value)) Object.assign(t, { customerId, contact: { ...t.contact, customerId } });
      }
    }

    const at = new Date();
    const id = nextId("tkt");
    const t: Ticket = {
      id,
      number: ++s.seq,
      subject: subject || null,
      status: "waiting",
      customerId,
      assigneeId: by?.id ?? null,
      waitingSince: null,
      createdAt: at,
      channel: kind,
      contact: { id: nextId("con"), name, identities: [{ kind: identityKind, value }], customerId, locale: "en" },
      lastMessageAt: at,
      answered: false,
    };
    s.tickets.push(t);
    s.messages.set(id, [
      message({
        kind: "outbound",
        text,
        createdAt: at,
        authorId: by?.id ?? null,
        to: [{ address: value, name }],
        cc: kind === "email" ? (input.cc ?? []).filter((x) => !x.address.endsWith("@acme.com") && x.address.toLowerCase() !== value) : [],
        attachments: (input.attachmentIds ?? []).flatMap((fileId) => s.files.get(fileId)?.info ?? []),
      }),
    ]);
    s.events.set(id, [{ id: nextId("evt"), type: "ticket_started", actorId: by?.id ?? null, data: { to: value, ...data }, createdAt: at }]);
    if (by) s.reads.set(id, at);
    return t;
  };

  const keep = (file: File) => {
    const info: FileInfo = { id: nextId("file"), filename: file.name, contentType: file.type || "application/octet-stream", size: file.size };
    s.files.set(info.id, { info, url: URL.createObjectURL(file) });
    return info;
  };

  // Outreach. A kind earns sending on its own the way a topic earns Autopilot.
  const kindOf = (kind: string) => s.outreachKinds.find((k) => k.kind === kind);
  const kindMeets = (k: OutreachKind) => k.record.recent.drafts >= OUTREACH.minDrafts && k.record.recent.rate >= OUTREACH.minRate;
  const deliverOutreach = (o: Outreach, by: Agent | null, subject: string, text: string) => {
    if (!o.contact) throw new Error("Nobody at this customer has an address to write to.");
    const t = openConversation({ to: { contactId: o.contact.id }, customerId: o.customer.id, subject: subject || o.title, text }, by, { outreachId: o.id, kind: o.kind, ...(by ? {} : { auto: true }) });
    const asDrafted = text.trim() === (o.text ?? "").trim();
    Object.assign(o, { status: "sent", subject: subject || o.title, text: text.trim(), sendAt: null, autoBlock: null, ticketId: t.id, auto: !by, decidedBy: by, decidedAt: new Date() });
    const k = kindOf(o.kind);
    if (k) {
      const { record: r } = k;
      const drafts = Math.min(OUTREACH.minDrafts, r.recent.drafts + 1);
      const good = Math.min(drafts, r.recent.good + 1);
      k.record = { ...r, drafts: r.drafts + 1, usedAsIs: r.usedAsIs + (asDrafted ? 1 : 0), lightlyEdited: r.lightlyEdited + (asDrafted ? 0 : 1), sentByAutopilot: r.sentByAutopilot + (by ? 0 : 1), recent: { drafts, good, rate: good / drafts } };
      k.ready = kindMeets(k);
      if (k.stage === "collecting" || k.stage === "eligible") k.stage = k.ready ? "eligible" : "collecting";
    }
    return t;
  };
  /** Sends the held messages whose time has come, as the scheduled run does. */
  const sendDueOutreach = () => {
    for (const o of s.outreach) {
      if (o.status !== "held" || !o.sendAt || +new Date(o.sendAt) > Date.now()) continue;
      if (pilot.stopped || kindOf(o.kind)?.stage !== "on") Object.assign(o, { status: "pending", sendAt: null, autoBlock: pilot.stopped ? "stopped" : "held_back" });
      else deliverOutreach(o, null, o.subject ?? o.title, o.text ?? "");
      onChange();
    }
  };
  const sendLater = (o: Outreach) => {
    if (o.status === "held" && o.sendAt && typeof window !== "undefined") setTimeout(sendDueOutreach, Math.max(0, +new Date(o.sendAt) - Date.now()) + 50);
  };
  s.outreach.forEach(sendLater);

  // A signal from your product: the proposal appears at once, its message a moment later.
  report = () => {
    const next = SIGNALS.find((signal) => !s.outreach.some((o) => o.kind === signal.kind && o.customer.id === signal.account));
    const to = next && people().find((p) => p.identities.some((i) => i.value === next.to));
    if (!next || !to) return null;
    const o: Outreach = {
      id: nextId("out"),
      kind: next.kind,
      title: next.title,
      facts: next.facts,
      customer: customer(next.account)!,
      contact: { id: to.id, name: to.name, address: next.to },
      subject: null,
      text: null,
      sources: [],
      language: "en",
      status: "drafting",
      sendAt: null,
      autoBlock: null,
      lastError: null,
      ticketId: null,
      auto: false,
      decidedBy: null,
      drafted: false,
      createdAt: new Date(),
      decidedAt: null,
    };
    s.outreach.unshift(o);
    const k = kindOf(next.kind);
    if (k) k.example = next.title;
    else {
      s.outreachKinds.push({
        kind: next.kind,
        example: next.title,
        stage: "collecting",
        enabledBy: null,
        enabledAt: null,
        pausedAt: null,
        ready: false,
        record: record({ drafts: 3, usedAsIs: 2, lightlyEdited: 1, heavilyEdited: 0, discarded: 0, cameBackUnhappy: 0, flagged: 0, cannotAnswer: 0, sentByAutopilot: 0, reopened: 0, recent: [3, 3], languages: [{ language: "en", drafts: 3, good: 3 }] }),
      });
    }
    onChange();
    setTimeout(() => {
      if (o.status !== "drafting") return;
      const alone = !pilot.stopped && kindOf(o.kind)?.stage === "on";
      Object.assign(o, { subject: next.subject, text: next.text, sources: next.sources, drafted: true, status: alone ? "held" : "pending", sendAt: alone ? new Date(Date.now() + OUTREACH.holdMinutes * 60_000) : null });
      sendLater(o);
      onChange();
    }, 1500);
    return o.id;
  };

  // An incident message goes to one person at each customer who wrote in about the spike's topic.
  const spikeOf = (id: string) => {
    const spike = s.spikes.find((x) => x.id === id);
    if (!spike) throw new Error("That spike doesn't exist.");
    return spike;
  };
  const affected = (spike: Spike): Pick<BroadcastPreview, "recipients" | "skipped"> => {
    const from = +new Date(spike.startedAt);
    const to = spike.endedAt ? +new Date(spike.endedAt) : Infinity;
    const live = s.tickets
      .filter((t) => t.status !== "spam" && s.insights.get(t.id)?.topic === spike.topic && +new Date(t.createdAt) >= from && +new Date(t.createdAt) < to)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const messaged = s.broadcasts.get(spike.id);
    const recipients: BroadcastPreview["recipients"] = [];
    const skipped = { unlinked: 0, alreadyMessaged: 0, unreachable: 0 };
    const seen = new Set<string>();
    for (const t of live) {
      const key = t.customerId ?? `contact:${t.contact.identities[0]?.value}`;
      if (seen.has(key)) continue;
      const address = t.contact.identities.find((i) => i.kind === "email")?.value;
      // The newest ticket of a customer may be from someone we can't write to: an older one may not be.
      if (t.customerId && !address) continue;
      seen.add(key);
      // A sender nobody linked to a customer is not written to.
      if (!t.customerId) skipped.unlinked++;
      else if (messaged?.has(t.customerId)) skipped.alreadyMessaged++;
      else recipients.push({ customer: customer(t.customerId) ?? { id: t.customerId, name: t.customerId }, contact: { id: t.contact.id, name: t.contact.name, address: address! }, ticket: { id: t.id, number: t.number, subject: t.subject } });
    }
    skipped.unreachable = new Set(live.filter((t) => t.customerId && !seen.has(t.customerId)).map((t) => t.customerId)).size;
    return { recipients, skipped };
  };

  /** One line of intent as a sentence to the customer: "tell them payouts are late" reads "Payouts are late." */
  const toCustomer = (intent: string) => {
    const line = intent
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(please )?(tell|let|inform|warn) (them|him|her|the customers?|everyone)( know)?( that)?\s*/i, "")
      .replace(/\bthey are\b/gi, "you are")
      .replace(/\bthey\b/gi, "you")
      .replace(/\btheir\b/gi, "your")
      .replace(/\bthem\b/gi, "you");
    return sentences(line)
      .map((part) => part[0]!.toUpperCase() + part.slice(1).replace(/([^.!?])$/, "$1."))
      .join(" ");
  };

  const agentClient: SupportClient = {
    async startTicket(input) {
      const t = openConversation(input, VIEWER);
      onChange();
      return delay({ ticketId: t.id });
    },

    async listChannels() {
      return delay(
        (Object.keys(CHANNELS) as ChannelKind[]).map(
          (id): StartChannel => ({
            id,
            kind: CHANNELS[id].kind,
            address: CHANNELS[id].address,
            startBlockedReason: id === "whatsapp" ? "needs_template" : null,
            default: id === "email",
            capabilities: { ...CHANNELS[id].capabilities, subject: id === "email" },
          })
        )
      );
    },

    async listContacts({ customerId, search }) {
      const term = search?.trim().toLowerCase();
      if (!customerId && !term) return delay([]);
      return delay(
        people().filter(
          (p) =>
            (!customerId || p.customer?.id === customerId) &&
            (!term || [p.name, p.customer?.name, ...p.identities.map((i) => i.value)].some((v) => v?.toLowerCase().includes(term)))
        )
      );
    },

    async uploadForNewTicket({ file }) {
      return delay(keep(file));
    },

    async listTickets(q) {
      const term = q.search?.toLowerCase();
      let items = s.tickets.filter((t) => (q.status ? t.status === q.status : t.status !== "spam"));
      // What Insights links to: a topic, a channel, a customer, the days tickets were opened in.
      if (q.topic) items = items.filter((t) => s.insights.get(t.id)?.topic === q.topic);
      if (q.channel) items = items.filter((t) => t.channel === q.channel);
      if (q.customerId) items = items.filter((t) => t.customerId === q.customerId);
      if (q.createdFrom) items = items.filter((t) => +new Date(t.createdAt) >= +q.createdFrom!);
      if (q.createdTo) items = items.filter((t) => +new Date(t.createdAt) < +q.createdTo!);
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
      return delay(keep(file));
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

    // The period's totals are generated (see `sample` below); who holds what right now, the longest waits and the reopened tickets are the inbox's own.
    async stats({ from, to, responseTargetMinutes }) {
      const days = Math.max(1, Math.ceil((+to - +from) / DAY_MS));
      const now = Date.now();
      const live = s.tickets.filter((t) => t.status !== "spam");
      const agents = [...AGENTS.map((a) => a as Agent | null), null].map((agent) => {
        const mine = live.filter((t) => (t.assigneeId ?? null) === (agent?.id ?? null));
        const share = agent ? [0.41, 0.34, 0.25][AGENTS.indexOf(agent)]! : 0;
        return {
          agent,
          open: mine.filter((t) => t.status === "open").length,
          waiting: mine.filter((t) => t.status === "waiting").length,
          solved: Math.round(sample.totals(days, 0, responseTargetMinutes).solved * share),
          solvedBefore: Math.round(sample.totals(days, days, responseTargetMinutes).solved * share * 0.97),
        };
      });
      const firstInbound = (t: Ticket) => s.messages.get(t.id)!.find((m) => m.kind === "inbound");
      const firstReply = (t: Ticket) => s.messages.get(t.id)!.find((m) => m.kind === "outbound");
      const late = live
        .flatMap((t) => {
          const asked = firstInbound(t);
          const replied = firstReply(t);
          if (!asked || (!replied && t.status !== "open")) return [];
          const waitedMs = +(replied ? new Date(replied.createdAt) : now) - +new Date(asked.createdAt);
          return waitedMs > responseTargetMinutes * 60_000 ? [{ id: t.id, number: t.number, subject: t.subject, waitedMs, answered: Boolean(replied) }] : [];
        })
        .sort((a, b) => b.waitedMs - a.waitedMs)
        .slice(0, 5);
      const reopened = live
        .flatMap((t) => {
          const event = s.events.get(t.id)!.findLast((e) => e.type === "reopened");
          return event ? [{ id: t.id, number: t.number, subject: t.subject, at: event.createdAt }] : [];
        })
        .slice(0, 5);
      const share = [0.46, 0.21, 0.14, 0.11, 0.08];
      const opened = sample.totals(days, 0, responseTargetMinutes).opened;
      const before = sample.totals(days, days, responseTargetMinutes).opened;
      return delay({
        from,
        to,
        current: sample.totals(days, 0, responseTargetMinutes),
        previous: sample.totals(days, days, responseTargetMinutes),
        days: sample.series(days, null),
        channels: (Object.keys(CHANNELS) as ChannelKind[]).map((id) => {
          const series = sample.series(days, id);
          return { id, kind: CHANNELS[id].kind, address: id === "email" ? CHANNELS[id].address : `${CHANNELS[id].address} (${id === "sms" ? "SMS" : "WhatsApp"})`, opened: series.reduce((sum, day) => sum + day.opened, 0), solved: series.reduce((sum, day) => sum + day.solved, 0), days: series };
        }),
        agents: agents.sort((a, b) => b.open - a.open || b.solved - a.solved),
        customers: ACCOUNTS.slice(0, 5).map(({ id, name }, i) => ({
          customer: { id, name },
          tickets: Math.max(1, Math.round(opened * 0.09 * share[i]! * 2)),
          before: Math.round(before * 0.09 * share[i]! * 2 * [0.7, 1.15, 0.9, 1.3, 1][i]!),
        })).sort((a, b) => b.tickets - a.tickets),
        reopened,
        late,
      });
    },

    ai: {
      async insights({ from, to }) {
        const days = Math.max(1, Math.ceil((+to - +from) / DAY_MS));
        // The visitor's own questions in the portal count on top of the sample history.
        const asked = [...s.asks.values()];
        const history = sample.ai(days);
        const answered = asked.filter((a) => a.turns.some((turn) => turn.kind === "answer"));
        const selfServe = {
          previous: history.selfServe!.previous,
          current: {
            conversations: history.selfServe!.current.conversations + asked.length,
            answered: history.selfServe!.current.answered + answered.length,
            deflected: history.selfServe!.current.deflected + answered.filter((a) => a.helpful && !a.ticketId).length,
            escalated: history.selfServe!.current.escalated + asked.filter((a) => a.ticketId).length,
            helpful: history.selfServe!.current.helpful + asked.filter((a) => a.helpful === true).length,
            notHelpful: history.selfServe!.current.notHelpful + asked.filter((a) => a.helpful === false).length,
          },
        };
        return delay({ ...history, selfServe, gaps: s.gaps.map(({ id, theme, count, lastSeenAt }) => ({ id, theme, count, lastSeenAt })).sort((a, b) => b.count - a.count), spikes: s.spikes.filter((spike) => +new Date(spike.detectedAt) >= +from) });
      },

      async listSpikes() {
        return delay(s.spikes.filter((spike) => !spike.acknowledgedAt));
      },

      async acknowledgeSpike({ id }) {
        const spike = s.spikes.find((x) => x.id === id);
        if (spike && !spike.acknowledgedAt) Object.assign(spike, { acknowledgedAt: new Date(), acknowledgedBy: VIEWER });
        return delay({ ok: true });
      },

      async draftOpening({ intent, customerId, contactId }) {
        const said = toCustomer(intent);
        if (!said) throw new Error("Say what the message should tell them.");
        const who = contactId ? person(contactId) : null;
        const account = ACCOUNTS.find((a) => a.id === (who?.customer?.id ?? customerId));
        const first = who?.name?.split(" ")[0];
        const hello = first ? `Hi ${first},` : "Hi,";
        const facts = accountFacts(account?.id ?? null);
        const fact = (label: string): SuggestionSource[] => {
          const at = facts.findIndex((f) => f.label === label);
          return at < 0 ? [] : [{ type: "fact", id: `fact:${at + 1}`, title: label }];
        };
        const [payout, payoutWhen] = account?.lastPayout?.split(" · ") ?? [];
        const [invoice, amount] = account?.lastOrder.split(" · ") ?? [];
        const close = "Reply to this message if you have any questions and I'll pick it up from here.";
        if (/payout|bank/i.test(intent)) {
          const known = payout && payoutWhen ? `Your last payout of ${payout} was ${payoutWhen}. ` : "";
          return thinking({
            subject: "About your payouts",
            text: `${hello}\n\n${said}\n\n${known}Payouts leave our side every Monday, and banks take up to 3 business days to show them.\n\n${close}`,
            sources: [...fact("Last payout"), ARTICLES.payouts],
          });
        }
        if (/invoice|billing|\bvat\b|\btax|\bcard|charge/i.test(intent)) {
          const known = amount ? `Your latest invoice is ${invoice} for ${amount}. ` : "";
          return thinking({
            subject: "About your billing",
            text: `${hello}\n\n${said}\n\n${known}You can see every invoice under Billing, then Invoices.\n\n${close}`,
            sources: [...fact("Last order"), ARTICLES.invoices],
          });
        }
        if (/trial|verif|onboard|\bset ?up|\bstart/i.test(intent)) {
          const known = account ? `${account.name} is on the ${account.plan} plan with ${account.seats} seats. ` : "";
          return thinking({
            subject: "Getting you set up",
            text: `${hello}\n\n${said}\n\n${known}Our getting started guide covers verification, imports and inviting your team.\n\n${close}`,
            sources: [...fact("Plan"), ARTICLES.start],
          });
        }
        const known = account ? `This is about ${account.name}'s account with us, on the ${account.plan} plan since ${account.since}. ` : "";
        return thinking({
          subject: said.replace(/[.!?]+$/, "").slice(0, 70),
          text: `${hello}\n\n${said}\n\n${known}${close}`,
          sources: [...fact("Customer since"), ARTICLES.start],
        });
      },

      async listOutreach(input) {
        sendDueOutreach();
        const waiting = ["drafting", "pending", "held", "sending", "failed"];
        const rows = s.outreach.filter((o) => (input?.sent ? o.status === "sent" || o.status === "dismissed" : waiting.includes(o.status)));
        if (input?.sent) rows.sort((a, b) => +new Date(b.decidedAt ?? b.createdAt) - +new Date(a.decidedAt ?? a.createdAt));
        return delay(rows.map((o) => ({ ...o })));
      },

      async sendOutreach({ id, subject, text }) {
        const o = s.outreach.find((x) => x.id === id);
        if (!o) throw new Error("That message doesn't exist.");
        if (o.status !== "pending" && o.status !== "held" && o.status !== "failed") throw new Error("This message was already sent or dismissed.");
        const body = (text ?? o.text ?? "").trim();
        if (!body) throw new Error("Write a message first.");
        const t = deliverOutreach(o, VIEWER, (subject ?? o.subject ?? "").replace(/\s+/g, " ").trim(), body);
        onChange();
        return delay({ ticketId: t.id });
      },

      async dismissOutreach({ id }) {
        const o = s.outreach.find((x) => x.id === id);
        if (!o || o.status === "sent" || o.status === "dismissed" || o.status === "sending") throw new Error("This message was already sent or dismissed.");
        Object.assign(o, { status: "dismissed", sendAt: null, decidedBy: VIEWER, decidedAt: new Date() });
        const k = kindOf(o.kind);
        if (k && o.drafted) k.record = { ...k.record, drafts: k.record.drafts + 1, discarded: k.record.discarded + 1 };
        return delay({ ok: true });
      },

      async holdOutreach({ id }) {
        const o = s.outreach.find((x) => x.id === id);
        if (!o) throw new Error("That message doesn't exist.");
        if (o.status !== "held") throw new Error("It has already been sent, or someone else stopped it.");
        Object.assign(o, { status: "pending", sendAt: null, autoBlock: "held_back" });
        return delay({ ok: true });
      },

      async getOutreachKinds() {
        sendDueOutreach();
        return delay({ autoSend: true, stopped: pilot.stopped, ...OUTREACH, kinds: s.outreachKinds.map((k) => ({ ...k, record: { ...k.record } })) });
      },

      async setOutreachKind({ kind, on }) {
        const k = kindOf(kind);
        if (!k) throw new Error("No signal of this kind has been reported.");
        if (on && k.stage !== "on") {
          const { good, drafts } = k.record.recent;
          if (!kindMeets(k)) {
            throw new Error(`"${kind}" isn't ready yet: ${good} of its last ${drafts} messages went out as drafted or lightly edited. It needs ${Math.round(OUTREACH.minRate * 100)}% of at least ${OUTREACH.minDrafts}.`);
          }
          Object.assign(k, { stage: "on", enabledBy: VIEWER, enabledAt: new Date(), pausedAt: null });
        } else if (!on) {
          Object.assign(k, { stage: kindMeets(k) ? "eligible" : "collecting", pausedAt: null });
          // What was about to go out waits for an agent instead.
          for (const o of s.outreach) if (o.kind === kind && o.status === "held") Object.assign(o, { status: "pending", sendAt: null, autoBlock: "held_back" });
        }
        return delay({ ok: true });
      },

      // The service asks for the spike to be acknowledged first; the demo lets you try it either way.
      async previewBroadcast({ spikeId }) {
        const spike = spikeOf(spikeId);
        return delay({ spikeId, topic: spike.topic, channel: { id: "email", kind: CHANNELS.email.kind }, ...affected(spike) });
      },

      async draftBroadcast({ spikeId, intent }) {
        const spike = spikeOf(spikeId);
        const said = toCustomer(intent);
        if (!said) throw new Error("Say what the message should tell them.");
        const topic = spike.topic.toLowerCase();
        return thinking({
          subject: spike.topic === "Payouts" ? "An update on today's payouts" : `An update on ${topic}`,
          text: `Hi {name},\n\nWe're writing because {company} is affected by a problem on our side with ${topic}. ${said}\n\nYou don't need to do anything. We'll write to you here as soon as it's resolved, and you can reply to this message if you have questions.`,
        });
      },

      async sendBroadcast({ spikeId, subject, text }) {
        const spike = spikeOf(spikeId);
        if (!text.trim()) throw new Error("Write a message first.");
        if (!subject.trim()) throw new Error("Add a subject.");
        const { recipients } = affected(spike);
        const messaged = s.broadcasts.get(spikeId) ?? new Set<string>();
        s.broadcasts.set(spikeId, messaged);
        for (const { customer: to, contact } of recipients) {
          const values = { name: contact.name, company: to.name };
          openConversation({ to: { contactId: contact.id }, customerId: to.id, subject: personalise(subject.replace(/\s+/g, " ").trim(), values) || spike.topic, text: personalise(text.trim(), values) }, VIEWER, { outreachId: nextId("out"), kind: INCIDENT_KIND, spikeId });
          messaged.add(to.id);
        }
        spike.messaged = messaged.size;
        if (recipients.length) onChange();
        return delay({ recipients: recipients.length, sent: recipients.length, queued: 0, failed: 0 });
      },

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
        if (patch.selfServe !== undefined) onChange(); // the portal's Ask box follows the switch
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

  /** A request from the portal. `note` is what a hand-off from the Ask box leaves for the agent. */
  const request = (subject: string, text: string, note?: string) => {
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
    s.messages.set(id, [
      message({ kind: "inbound", text, createdAt: at, source: "portal", from: { address: CUSTOMER.email, name: CUSTOMER.name } }),
      ...(note ? [message({ kind: "note", text: note, createdAt: new Date(+at + 1), source: "portal" })] : []),
    ]);
    s.events.set(id, []);
    understand(s.tickets.at(-1)!, `${subject}. ${text}`, null);
    onChange();
    return id;
  };

  // The Ask box: four subjects it can answer from Northwind Coffee's account and the help center.
  const fact = (label: string): SuggestionSource => ({ type: "fact", id: `fact:${accountFacts(CUSTOMER.account).findIndex((f) => f.label === label) + 1}`, title: label });
  const northwind = ACCOUNTS.find((a) => a.id === CUSTOMER.account)!;
  const [lastPayout, payoutWhen] = northwind.lastPayout!.split(" · ");
  const [lastInvoice, lastAmount] = northwind.lastOrder.split(" · ");
  const ANSWERS: { about: RegExp; text: string; sources: SuggestionSource[] }[] = [
    {
      about: /payout|paid out|\bbank|deposit|transfer/i,
      text: `Your last payout of ${lastPayout} was ${payoutWhen}. Payouts leave our side every Monday, and banks take up to 3 business days to show them, so it should reach your account by Thursday.`,
      sources: [fact("Last payout"), ARTICLES.payouts],
    },
    {
      about: /refund|money back|chargeback/i,
      text: `You can refund an order from Orders: open it and choose Refund. Refunds are available for 30 days after the payment and go back to the original payment method within 5 business days. Your most recent order is ${lastInvoice} for ${lastAmount}.`,
      sources: [ARTICLES.refunds, fact("Last order")],
    },
    {
      about: /invoice|receipt|billing|\bvat\b|\btax/i,
      text: `You can download any invoice from Billing, then Invoices: open it and choose Download PDF. To add a VAT number or correct an address, use Billing, then Company details. Your latest invoice is ${lastInvoice} for ${lastAmount}.`,
      sources: [ARTICLES.invoices, fact("Last order")],
    },
    {
      about: /\b(plan|seats?|upgrade|admins?|team|invite|users?)\b/i,
      text: `${northwind.name} is on the ${northwind.plan} plan with ${northwind.seats} seats. To add someone, go to Settings, then Team, choose Invite and pick their role. They'll get an email to join.`,
      sources: [fact("Plan"), ARTICLES.team],
    },
  ];
  const WANTS_PERSON = /\b(person|human|agent|someone|somebody|representative|call|phone)\b/i;

  const portal: SupportPortalClient = {
    async list() {
      const items = mine().sort((a, b) => +b.lastMessageAt - +a.lastMessageAt).map(portalTicket);
      return delay({ items, total: items.length, ask: s.ai.selfServe === true });
    },
    async ask({ question, sessionId }) {
      const asked = question.replace(/\s+/g, " ").trim();
      if (!asked) throw new Error("Write a question first.");
      if (!s.ai.selfServe) throw new Error("Instant answers aren't available right now.");
      const id = sessionId && s.asks.has(sessionId) ? sessionId : nextId("ask");
      const session = s.asks.get(id) ?? { turns: [], helpful: null, ticketId: null };
      s.asks.set(id, session);
      const answer = WANTS_PERSON.test(asked) ? null : ANSWERS.find((a) => a.about.test(asked));
      const result: AskResult = answer
        ? { sessionId: id, kind: "answer", text: answer.text, sources: answer.sources }
        : { sessionId: id, kind: "handoff", reason: WANTS_PERSON.test(asked) ? "asked_for_human" : "cannot_answer" };
      session.turns.push({
        question: asked,
        kind: result.kind,
        text: result.kind === "answer" ? result.text : null,
        reason: result.kind === "handoff" ? result.reason : null,
        sources: result.kind === "answer" ? result.sources : [],
        at: new Date(),
      });
      return thinking(result);
    },
    async rateAnswer({ sessionId, helpful }) {
      const session = s.asks.get(sessionId);
      if (session) session.helpful = helpful;
      return delay({ ok: true });
    },
    async escalate({ sessionId, text }) {
      const session = s.asks.get(sessionId);
      if (!session?.turns.length) throw new Error("This conversation has ended. Send your question as a new request.");
      const id = request(session.turns[0]!.question.slice(0, 200), text?.trim() || session.turns.at(-1)!.question, handoffNote(session.turns));
      session.ticketId = id;
      return delay({ id });
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
      return delay({ id: request(subject, text) });
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

// ----------------------------------------------------------------- Insights

const DAY_MS = 86_400_000;
const TOPIC_NAMES = ["Billing", "Payouts", "Account access", "Exports", "other"] as const;

/**
 * Sample history for the dashboard: what months of tickets would add up to, generated from the
 * date so it reads the same on every visit. The story it tells: replies got faster as drafts
 * took over, Exports is the topic growing fastest (its drafts are the ones agents rewrite, and
 * its gap is open), and Payouts jumped today.
 */
const sample = (() => {
  /** A steady pseudo-random number in 0..1 for a day and a purpose. */
  const noise = (day: number, salt: number) => {
    const x = Math.sin(day * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const today = () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { index: Math.floor(start.getTime() / DAY_MS), elapsed: Math.max(0.05, (Date.now() - start.getTime()) / DAY_MS) };
  };
  const BASE: Record<ChannelKind, number> = { email: 21, whatsapp: 7, sms: 3 };
  const opened = (ago: number, channel: ChannelKind) => {
    const { index, elapsed } = today();
    const weekday = new Date((index - ago) * DAY_MS + DAY_MS / 2).getDay();
    const rhythm = weekday === 0 ? 0.3 : weekday === 6 ? 0.4 : weekday === 1 ? 1.2 : 1;
    const growth = 1 + 0.2 * (1 - Math.min(ago, 180) / 180);
    const value = BASE[channel] * rhythm * growth * (0.75 + 0.5 * noise(index - ago, channel.length));
    return Math.round(value * (ago === 0 ? elapsed : 1)) + (ago === 0 && channel === "email" ? 6 : 0);
  };
  const solved = (ago: number, channel: ChannelKind) => Math.round(0.55 * opened(ago, channel) + 0.43 * opened(ago + 1, channel));
  const channels = Object.keys(BASE) as ChannelKind[];
  const sum = (from: number, to: number, value: (ago: number) => number) => {
    let total = 0;
    for (let ago = from; ago < to; ago++) total += value(ago);
    return total;
  };
  const all = (pick: (ago: number, channel: ChannelKind) => number) => (ago: number) => channels.reduce((total, channel) => total + pick(ago, channel), 0);
  const MINUTE = 60_000;

  /** Each topic's share of a day's tickets. Exports doubles over the last month; Payouts jumps today. */
  const topicShare = (ago: number) => {
    const exports = 0.07 + 0.09 * Math.max(0, 1 - ago / 30);
    const payouts = ago === 0 ? 0.38 : 0.2;
    const rest = 1 - exports - payouts;
    return { Billing: rest * 0.4, Payouts: payouts, "Account access": rest * 0.26, Exports: exports, other: rest * 0.34 };
  };

  return {
    totals(days: number, offset: number, targetMinutes: number): PeriodTotals {
      const count = sum(offset, offset + days, all(opened));
      const done = sum(offset, offset + days, all(solved));
      const middle = offset + days / 2;
      const firstReply = (34 + 0.28 * middle) * MINUTE;
      const solve = (5.6 + 0.022 * middle) * 60 * MINUTE;
      const answered = Math.round(done * 0.96);
      const missed = Math.min(0.6, (0.07 + 0.0007 * middle) * Math.sqrt(240 / Math.max(15, targetMinutes)));
      return {
        opened: count,
        solved: done,
        reopened: Math.round(done * (0.031 + 0.00008 * middle)),
        firstReply: { count: Math.round(count * 0.97), median: firstReply, p90: firstReply * 5.4 },
        timeToSolve: { count: done, median: solve, p90: solve * 5.8 },
        breaches: Math.round(count * missed),
        answered,
        replies: Math.round(answered * (1.62 + 0.0022 * middle)),
        oneReply: Math.round(answered * (0.6 - 0.0009 * middle)),
      };
    },

    /** Oldest day first. The backlog is walked back from what is open today. */
    series(days: number, channel: ChannelKind | null): DaySeries[] {
      const pick = (value: (ago: number, channel: ChannelKind) => number) => (ago: number) => (channel ? value(ago, channel) : all(value)(ago));
      const series: DaySeries[] = [];
      let backlog = channel ? Math.round(BASE[channel] * 1.4) : 44;
      for (let ago = 0; ago < days; ago++) {
        const day = { opened: pick(opened)(ago), solved: pick(solved)(ago), backlog: Math.max(0, backlog) };
        series.unshift(day);
        backlog = backlog - day.opened + day.solved;
      }
      return series;
    },

    ai(days: number): Omit<AiInsights, "gaps" | "spikes"> {
      const { index } = today();
      const accepted: Record<string, number> = { Billing: 0.94, Payouts: 0.89, "Account access": 0.72, Exports: 0.48, other: 0.66 };
      const count = (topic: (typeof TOPIC_NAMES)[number], ago: number) => Math.round(all(opened)(ago) * topicShare(ago)[topic]);
      const topics = TOPIC_NAMES.map((topic) => {
        const tickets = sum(0, days, (ago) => count(topic, ago));
        const drafts = Math.round(tickets * 0.82);
        return {
          topic,
          tickets,
          before: sum(days, 2 * days, (ago) => count(topic, ago)),
          days: Array.from({ length: days }, (_, i) => count(topic, days - 1 - i)),
          drafts,
          accepted: Math.round(drafts * accepted[topic]!),
        };
      }).sort((a, b) => b.tickets - a.tickets);
      const total = (from: number, to: number) => sum(from, to, (ago) => TOPIC_NAMES.reduce((n, topic) => n + count(topic, ago), 0));
      const urgency = (n: number, urgent: number) => ({ urgent: Math.round(n * urgent), high: Math.round(n * 0.15), normal: Math.round(n * 0.61), low: n - Math.round(n * urgent) - Math.round(n * 0.15) - Math.round(n * 0.61) });
      const mood = (ago: number) => {
        const n = TOPIC_NAMES.reduce((m, topic) => m + count(topic, ago), 0);
        const upset = Math.round(n * (0.09 + 0.07 * noise(index - ago, 7) + (ago === 0 ? 0.12 : 0)));
        const angry = Math.round(upset * 0.25);
        const confused = Math.round(n * 0.2);
        return { calm: n - upset - confused, confused, frustrated: upset - angry, angry };
      };
      const moods = (from: number, to: number) => {
        const totals = { calm: 0, confused: 0, frustrated: 0, angry: 0 };
        for (let ago = from; ago < to; ago++) for (const [key, value] of Object.entries(mood(ago))) totals[key as keyof typeof totals] += value;
        return totals;
      };
      const share = (n: number, autopilot: number) => {
        const decided = Math.round(n * 0.8);
        const sent = Math.round(decided * autopilot);
        const rest = decided - sent;
        return {
          autopilotSent: sent,
          usedAsIs: Math.round(rest * 0.52),
          lightlyEdited: Math.round(rest * 0.2),
          rewritten: Math.round(rest * 0.16),
          discarded: rest - Math.round(rest * 0.52) - Math.round(rest * 0.2) - Math.round(rest * 0.16),
          autopilotFlagged: sent > 40 ? 1 : 0,
        };
      };
      const n = total(0, days);
      // About 48 conversations a month in the Ask box, a little more than the month before.
      const asked = (scale: number) => {
        const conversations = Math.round(days * 1.6 * scale);
        return {
          conversations,
          answered: Math.round(conversations * 0.854),
          deflected: Math.round(conversations * 0.604),
          escalated: Math.round(conversations * 0.1875),
          helpful: Math.round(conversations * 0.458),
          notHelpful: Math.round(conversations * 0.083),
        };
      };
      return {
        selfServe: { current: asked(1), previous: asked(0.85) },
        topics,
        urgency: { current: urgency(n, 0.045), previous: urgency(total(days, 2 * days), 0.04) },
        mood: { current: moods(0, days), previous: moods(days, 2 * days), days: Array.from({ length: days }, (_, i) => mood(days - 1 - i)) },
        drafts: { current: share(n, 0.14), previous: share(total(days, 2 * days), 0.05) },
        firstReply: {
          withDraft: { count: Math.round(n * 0.8), median: 19 * MINUTE, p90: 96 * MINUTE },
          withoutDraft: { count: Math.round(n * 0.17), median: 132 * MINUTE, p90: 11 * 60 * MINUTE },
        },
      };
    },
  };
})();

/** The agent client only, for places that don't need the portal. */
export function createDemoClient(onChange: () => void): SupportClient {
  return createDemoClients(onChange).agent;
}
