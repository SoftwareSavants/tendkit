import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { Callout, DocsShell, H2, H3, Props, Step, Steps } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "AI",
  description: "Optional AI for the inbox: triage, one-line summaries and suggested replies written from your docs, with any AI SDK model, a memory of what your team teaches it, and actions in your product that agents approve.",
  alternates: { canonical: "/docs/ai" },
};

const CONFIG = `import { anthropic } from "@ai-sdk/anthropic"; // or any other AI SDK provider
import { supportAi } from "@/lib/support/ai";
import { docsFromUrl } from "@/lib/support/knowledge";
import { createPostgresAiStore } from "@/lib/support/postgres/ai-store";

export const support = () =>
  createSupport({
    // …your existing options
    ai: supportAi({
      model: anthropic("claude-sonnet-4-5"),
      store: createPostgresAiStore(db),
      knowledge: [docsFromUrl("https://acme.com/llms-full.txt")],
    }),
  });`;

const PROVIDERS = `import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

supportAi({ model: openai("gpt-5"), fastModel: openai("gpt-5-mini"), store });
supportAi({ model: google("gemini-2.5-pro"), fastModel: google("gemini-2.5-flash"), store });
// Through the Vercel AI Gateway, a model is just a string:
supportAi({ model: "anthropic/claude-sonnet-4-5", store });`;

const KNOWLEDGE = `import { readFileSync, readdirSync } from "node:fs";
import { docsFromFiles, docsFromUrl, type KnowledgeSource } from "@/lib/support/knowledge";

// Markdown or MDX you already have. Frontmatter titles are read; imports and JSX tags are left out.
const dir = "content/docs";
const files = Object.fromEntries(
  (readdirSync(dir, { recursive: true }) as string[])
    .filter((path) => /\\.mdx?$/.test(path))
    .map((path) => [path, readFileSync(\`\${dir}/\${path}\`, "utf8")])
);
const docs = docsFromFiles(files, { url: (path) => \`https://acme.com/docs/\${path.replace(/\\.mdx?$/, "")}\` });

// One file with everything, split on its top-level "# " headings.
const helpCenter = docsFromUrl("https://acme.com/llms-full.txt", { id: "help-center" });

// Or anything else: a CMS, a database table, saved replies.
const policies: KnowledgeSource = {
  id: "policies",
  load: async () => (await cms.list("policy")).map((p) => ({ id: p.slug, title: p.title, url: p.url, text: p.body })),
};`;

const FACTS = `export const directory: SupportDirectory = {
  // …identify, searchCustomers, getCustomers, listAgents

  async describeCustomer(customerId) {
    const account = await db.query.accounts.findFirst({ where: eq(accounts.id, customerId) });
    if (!account) return [];
    return [
      { label: "Plan", value: account.plan, url: \`https://admin.acme.com/accounts/\${account.id}\` },
      { label: "Balance", value: formatMoney(account.balance) },
      { label: "Last payout", value: account.lastPayout ? formatPayout(account.lastPayout) : "None yet" },
    ];
  },
};`;

const DEFER = `// Cloudflare Workers
supportAi({ model, store, defer: (work) => ctx.waitUntil(work) });

// Next.js
import { after } from "next/server";
supportAi({ model, store, defer: (work) => after(() => work) });`;

const VOICE = `import { openai } from "@ai-sdk/openai"; // or elevenlabs, deepgram, groq…

supportAi({
  model,
  store,
  transcriptionModel: openai.transcription("gpt-4o-transcribe"),
  // Optional. The AI SDK has no shared language setting, so a hint goes to your provider here.
  transcriptionOptions: ({ language }) => ({ openai: { ...(language ? { language } : {}) } }),
});`;

const VOICE_ROUTE = `// app/api/support/transcribe/route.ts
export async function POST(request: Request) {
  await requireAgent(request);
  const audio = (await request.formData()).get("audio") as File;
  return Response.json(await support().ai.transcribe({ audio }));
}

// app/admin/support/client.ts
ai: {
  // …the methods above
  async transcribe({ audio }) {
    const body = new FormData();
    body.set("audio", audio);
    const response = await fetch("/api/support/transcribe", { method: "POST", body });
    if (!response.ok) throw new Error("Transcription failed");
    return response.json();
  },
},`;

const API = `case "listTickets":
  return Response.json(
    await s.listTickets(
      {
        status: input.status,
        assigneeId: input.assignee === "me" ? agent.id : input.assignee,
        search: input.search,
        // The inbox asks for "priority" on open tickets when the client has \`ai\`.
        sort: input.sort ?? (input.status === "open" ? "waiting" : "recent"),
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      },
      agent.id
    )
  );
case "ai.refine":
  return Response.json(await s.ai.refine(input));
case "ai.writeUp":
  return Response.json(await s.ai.writeUp(input));
case "ai.translate":
  return Response.json(await s.ai.translate(input));
case "ai.draft":
  return Response.json(await s.ai.draft(input));
case "ai.discardSuggestion":
  return Response.json(await s.ai.discardSuggestion(input.id));
case "ai.setInsight":
  return Response.json(await s.ai.setInsight({ ...input, actorId: agent.id }));
case "ai.getSettings":
  return Response.json({ ...(await s.ai.getSettings()), sources: await s.ai.listKnowledgeSources() });
case "ai.updateSettings":
  return Response.json(await s.ai.updateSettings(input));
case "ai.syncKnowledge":
  return Response.json(await s.ai.syncKnowledge());`;

const CLIENT = `export const supportClient: SupportClient = {
  // …the methods you already have
  ai: {
    refine: (input) => call("ai.refine", input),
    writeUp: (input) => call("ai.writeUp", input),
    translate: (input) => call("ai.translate", input),
    draft: (input) => call("ai.draft", input),
    discardSuggestion: (input) => call("ai.discardSuggestion", input),
    setInsight: (input) => call("ai.setInsight", input),
    getSettings: () => call("ai.getSettings"),
    updateSettings: (input) => call("ai.updateSettings", input),
    syncKnowledge: () => call("ai.syncKnowledge"),
  },
};

// app/admin/support/ai/page.tsx
import { SupportAiSettings } from "@/components/support/support-ai-settings";

export default function Page() {
  return <SupportAiSettings />;
}`;

const MEMORY_API = `case "ai.listApprovedAnswers":
  return Response.json(await s.ai.listApprovedAnswers());
case "ai.generaliseAnswer":
  return Response.json(await s.ai.generaliseAnswer(input));
case "ai.saveApprovedAnswer":
  return Response.json(await s.ai.saveApprovedAnswer({ ...input, actorId: agent.id }));
case "ai.deleteApprovedAnswer":
  return Response.json(await s.ai.deleteApprovedAnswer(input.id));
case "ai.listGuidanceSuggestions":
  return Response.json(await s.ai.listGuidanceSuggestions());
case "ai.decideGuidanceSuggestion":
  return Response.json(await s.ai.decideGuidanceSuggestion({ ...input, actorId: agent.id }));
case "ai.listGaps":
  return Response.json(await s.ai.listGaps());
case "ai.dismissGap":
  return Response.json(await s.ai.dismissGap({ ...input, actorId: agent.id }));
case "ai.draftArticle":
  return Response.json(await s.ai.draftArticle(input));`;

const MEMORY_CLIENT = `ai: {
  // …the methods above. Each of these is optional: the screens show what you provide.
  listApprovedAnswers: () => call("ai.listApprovedAnswers"),
  generaliseAnswer: (input) => call("ai.generaliseAnswer", input),
  saveApprovedAnswer: (input) => call("ai.saveApprovedAnswer", input),
  deleteApprovedAnswer: (input) => call("ai.deleteApprovedAnswer", input),
  listGuidanceSuggestions: () => call("ai.listGuidanceSuggestions"),
  decideGuidanceSuggestion: (input) => call("ai.decideGuidanceSuggestion", input),
  listGaps: () => call("ai.listGaps"),
  dismissGap: (input) => call("ai.dismissGap", input),
  draftArticle: (input) => call("ai.draftArticle", input),
},`;

const ACTIONS = `import { z } from "zod";
import { supportAi, supportAction } from "@/lib/support/ai";

supportAi({
  model,
  store,
  actions: [
    // A lookup: read-only, so it may run while a reply is drafted.
    supportAction({
      name: "last_invoice",
      title: "Look up last invoice",
      description: "The customer's most recent invoice and whether it's paid.",
      input: z.object({}),
      approval: "never",
      run: async ({ customer }) => {
        const invoice = await billing.lastInvoice(customer.id);
        if (!invoice) return { ok: true, summary: "No invoices yet." };
        return {
          ok: true,
          summary: \`Invoice \${invoice.number} for \${invoice.total}, \${invoice.status}\`,
          data: { number: invoice.number, total: invoice.total, status: invoice.status, url: invoice.url },
        };
      },
    }),

    // A change: proposed with the reply, run when an agent approves it.
    supportAction({
      name: "extend_trial",
      title: "Extend trial",
      description: "Extends the customer's trial. Use when they ask for more time to evaluate.",
      input: z.object({ days: z.number().int().min(1).max(30).describe("Days to add") }),
      available: ({ customer }) => billing.isOnTrial(customer.id),
      run: async ({ input, customer, agent }) => {
        const until = await billing.extendTrial(customer.id, input.days, { by: agent?.id });
        return { ok: true, summary: \`Trial extended to \${until}\` };
      },
    }),

    supportAction({
      name: "resend_verification",
      title: "Resend verification email",
      description: "Sends the account's verification email again.",
      input: z.object({ email: z.string().email() }),
      run: async ({ input, customer }) => {
        const sent = await accounts.resendVerification(customer.id, input.email);
        return sent ? { ok: true, summary: \`Sent to \${input.email}\` } : { ok: false, summary: "That address isn't on this account." };
      },
    }),
  ],
});`;

const ACTIONS_API = `case "ai.listActions":
  return Response.json(await s.ai.ticketActions(input));
case "ai.runAction":
  // The signed-in agent is the approval. Never take actorId from the request body.
  return Response.json(await s.ai.runAction({ ...input, actorId: agent.id }));
case "ai.declineAction":
  return Response.json(await s.ai.declineAction({ ...input, actorId: agent.id }));
case "ai.setActionEnabled":
  return Response.json(await s.ai.setActionEnabled(input));
case "ai.getSettings":
  return Response.json({
    ...(await s.ai.getSettings()),
    sources: await s.ai.listKnowledgeSources(),
    actions: await s.ai.listActions(),
  });`;

const ACTIONS_CLIENT = `ai: {
  // …the methods above. Each of these is optional: the screens show what you provide.
  listActions: (input) => call("ai.listActions", input),
  runAction: (input) => call("ai.runAction", input),
  declineAction: (input) => call("ai.declineAction", input),
  setActionEnabled: (input) => call("ai.setActionEnabled", input),
},`;

const AUTOPILOT = `supportAi({
  model,
  store,
  knowledge: [docs],
  // Every value is optional. These are the defaults.
  autopilot: {
    minDrafts: 30,          // decided drafts a topic needs before it can be switched on
    minRate: 0.9,           // share of them sent as drafted or lightly edited
    windowDays: 30,         // how far back a track record looks
    holdMinutes: 10,        // "hold for review" waits this long before sending
    maxPerHour: 30,         // across all topics
    blockMoods: ["angry"],
    blockUrgencies: ["urgent"],
    maxCustomerMessages: 3, // the customer's third message without a resolution goes to a person
    minLanguageDrafts: 5,   // drafts a language needs within the topic before it's answered alone
    // channels: ["email"],                         // channel ids; defaults to every email channel
    // signature: ({ language }) => "Acme Support", // what an Autopilot reply signs with
    // canManage: (agentId) => isSupportLead(agentId),
  },
});`;

const AUTOPILOT_API = `case "ai.getAutopilot":
  return Response.json(await s.ai.getAutopilot());
case "ai.setAutopilotTopic":
  // Who switched a topic on is recorded. Never take actorId from the request body.
  return Response.json(await s.ai.setAutopilotTopic({ ...input, actorId: agent.id }));
case "ai.setAutopilot":
  return Response.json(await s.ai.setAutopilot({ ...input, actorId: agent.id }));
case "ai.autopilotExamples":
  return Response.json(await s.ai.autopilotExamples(input));
case "ai.holdAutopilotReply":
  return Response.json(await s.ai.holdAutopilotReply({ ...input, actorId: agent.id }));
case "ai.flagAutopilotReply":
  return Response.json(await s.ai.flagAutopilotReply({ ...input, actorId: agent.id }));`;

const AUTOPILOT_CLIENT = `ai: {
  // …the methods above. Each of these is optional: the screens show what you provide.
  getAutopilot: () => call("ai.getAutopilot"),
  setAutopilotTopic: (input) => call("ai.setAutopilotTopic", input),
  setAutopilot: (input) => call("ai.setAutopilot", input),
  autopilotExamples: (input) => call("ai.autopilotExamples", input),
  holdAutopilotReply: (input) => call("ai.holdAutopilotReply", input),
  flagAutopilotReply: (input) => call("ai.flagAutopilotReply", input),
},`;

const EMBEDDER = `import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";

supportAi({
  model,
  store,
  embedder: {
    embed: async (texts) => (await embedMany({ model: openai.embedding("text-embedding-3-small"), values: texts })).embeddings,
  },
});`;

export default function Ai() {
  return (
    <DocsShell
      href="/docs/ai"
      toc={[
        { id: "set-it-up", title: "Set it up" },
        { id: "what-it-does", title: "What it does" },
        { id: "options", title: "Options" },
        { id: "providers", title: "Providers" },
        { id: "knowledge", title: "Knowledge" },
        { id: "account-facts", title: "Account facts" },
        { id: "when-it-runs", title: "When it runs" },
        { id: "screens", title: "Screens" },
        { id: "voice", title: "Voice" },
        { id: "memory", title: "Memory" },
        { id: "actions", title: "Actions" },
        { id: "autopilot", title: "Autopilot" },
        { id: "methods", title: "Methods" },
        { id: "privacy", title: "Privacy" },
      ]}
    >
      <p>
        AI is optional. Without it, nothing in Tendkit changes. With it, every customer message is read as it arrives: the
        inbox shows what the customer needs and how urgent it is, and the ticket opens with a reply already written from
        your docs. An agent reviews, changes and sends it. Nothing is sent on its own, except on the topics your team
        switches to <a href="#autopilot">Autopilot</a> once their track record has earned it.
      </p>
      <p>
        AI also works before a ticket exists: it drafts the message when your product reports a problem on a
        customer&apos;s account, writes an incident message for every customer a spike affects, and answers questions
        in the portal. Those are on their own page, <Link href="/docs/proactive">Proactive and self-serve</Link>.
      </p>

      <H2 id="set-it-up">Set it up</H2>
      <Steps>
        <Step title="Add the item for your database">
          <Code title="Terminal" lang="bash" code={`npx shadcn@latest add @tendkit/support-ai-postgres   # or @tendkit/support-ai-d1\nnpm install @ai-sdk/anthropic                        # the provider you use`} className="mt-1" />
          <p className="mt-3 text-muted-foreground">
            It brings <code>support-ai</code> (the engine, which depends on the{" "}
            <a href="https://ai-sdk.dev" target="_blank" rel="noreferrer">AI SDK</a>&apos;s <code>ai</code> package and nothing
            else) and its tables. If you installed Tendkit before AI existed, update <code>support</code>, your store item
            and <code>support-ui</code> first: see <Link href="/docs/upgrading">Upgrading</Link>.
          </p>
        </Step>
        <Step title="Create the tables">
          <Code title="db/schema.ts" lang="ts" code={`export * from "@/lib/support/postgres/ai-schema";`} className="mt-1" />
          <p className="mt-3 text-muted-foreground">
            Then generate and apply a migration with Drizzle as usual. <code>lib/support/postgres/0001_ai.sql</code>,{" "}
            <code>0002_memory.sql</code>, <code>0003_actions.sql</code>, <code>0004_autopilot.sql</code>,{" "}
            <code>0006_insights_ai.sql</code>, <code>0007_proactive.sql</code> and{" "}
            <code>0008_outreach_record.sql</code> are the reference.
          </p>
        </Step>
        <Step title="Give it a model and your docs">
          <Code title="lib/support/index.ts" lang="ts" code={CONFIG} className="mt-1" />
        </Step>
        <Step title="Turn the screens on">
          <p className="text-muted-foreground">
            Add <code>ai</code> to your <code>SupportClient</code>. See <a href="#screens">Screens</a> below.
          </p>
        </Step>
      </Steps>
      <p>
        The first knowledge sync happens on the next <code>runScheduled</code>. Call <code>support().ai.syncKnowledge()</code>{" "}
        once to have it right away.
      </p>

      <H2 id="what-it-does">What it does</H2>
      <ul>
        <li>
          <strong>Understands each message.</strong> For every new customer message (never automatic mail, your team&apos;s
          mail or spam), the fast model reports a topic from your list, an urgency with its reason, the customer&apos;s mood
          and language, and a one-line summary. The inbox lists open tickets by urgency, then by wait, and shows the summary.
          Agents can correct the topic and urgency; their choice is kept and recorded on the ticket.
        </li>
        <li>
          <strong>Suggests the reply.</strong> The main model then writes a reply in the customer&apos;s language from your
          team guidance, your knowledge, the customer&apos;s account facts and the conversation, within the channel&apos;s
          length limit and without a signature (yours is added on sending). When those don&apos;t hold the answer, it says
          so in one line instead of guessing. Each suggestion lists what it&apos;s based on.
        </li>
        <li>
          <strong>Helps with the wording.</strong> In the reply box: Shorter, Friendlier, More formal, Translate, any
          instruction you type or <a href="#voice">say</a>, and Undo. &quot;Write it up&quot; turns an agent&apos;s rough notes
          into the reply.
          Customers&apos; messages in another language can be translated in place.
        </li>
        <li>
          <strong>Remembers what happened.</strong> Each suggestion is stored with its model, token counts and outcome: used
          as written, edited (with the text that was sent), discarded, or stale because the customer wrote again.
        </li>
      </ul>
      <Callout title="Customer text is data">
        Messages go into the prompt as quoted data with their markup escaped, and the model is told never to follow
        instructions inside them. Internal notes are passed as context that must never be quoted. Source titles and links
        shown to agents come from your stored articles and your directory, never from the model&apos;s output.
      </Callout>

      <H2 id="options">Options</H2>
      <Props
        rows={[
          { name: "model", type: "LanguageModel", required: true, description: "Writes suggested replies and write-ups." },
          { name: "store", type: "AiStore", required: true, description: "createPostgresAiStore(db) or createD1AiStore(db), on the same database as your support store." },
          { name: "fastModel", type: "LanguageModel", default: "model", description: "Triage, rewrites and translations. A small, fast model is enough." },
          { name: "knowledge", type: "KnowledgeSource[]", default: "[]", description: "What suggestions may answer from. See Knowledge." },
          { name: "actions", type: "SupportAction[]", default: "[]", description: "What AI may do in your product for the customer on the ticket. See Actions." },
          { name: "autopilot", type: "false | AutopilotOptions", description: "Thresholds, checks and limits for the topics your team lets answer on their own. Nothing is on until someone switches a topic on. false removes it. See Autopilot." },
          { name: "spikes", type: "false | { minCustomers?, windowMinutes?, factor?, baselineDays? }", description: <>When a topic counts as a likely incident: by default 5 different customers within 120 minutes, at 3 times its usual volume over the last 14 days. false switches detection off. See <Link href="/docs/insights#spikes">Spikes</Link>.</> },
          { name: "proactive", type: "false | ProactiveOptions", description: <>Limits and thresholds for outreach from <code>support.signal()</code>. false switches signals off. See <Link href="/docs/proactive#signals">Proactive and self-serve</Link>.</> },
          { name: "selfServe", type: "false | { maxPerHour?, maxQuestions?, quietHours? }", description: <>Caps for the portal&apos;s Ask box (20 questions a customer an hour, 8 a conversation), which answers nothing until your team switches it on in AI settings. false removes it. See <Link href="/docs/proactive#self-serve">Self-serve</Link>.</> },
          { name: "defer", type: "(work: Promise) => void", description: "Runs the model calls after the webhook has answered. Without it they run in the next runScheduled." },
          { name: "agentLanguage", type: "string", default: '"en"', description: "The language your agents read (BCP-47), for summaries, reasons and translations." },
          { name: "knowledgeBudget", type: "number", default: "120000", description: "Characters of knowledge a prompt may carry. Past it, only the articles closest to the conversation are sent." },
          { name: "cache", type: "providerOptions", description: "Set on the shared prompt prefix, for providers that only cache a prefix when it's marked." },
          { name: "transcriptionModel", type: "TranscriptionModel", description: "Speech to text for voice in the reply box. Without it, voice uses the browser's own speech recognition. See Voice." },
          { name: "transcriptionOptions", type: "({ language? }) => providerOptions", description: "Provider options for each transcription, such as a language hint." },
          { name: "shareStyleNotes", type: "boolean", default: "true", description: "Lets what agents changed in one customer's draft shape other customers' drafts, as a style note without customer details. Set false to keep every correction within its customer. See Memory." },
          { name: "embedder", type: "{ embed(texts) => number[][] }", description: "Orders the earlier corrections found for a draft by meaning instead of shared words. Optional; nothing is stored." },
        ]}
      />

      <H2 id="providers">Providers</H2>
      <p>
        Tendkit imports only the <code>ai</code> package, never a provider. <code>model</code> is any AI SDK language
        model, so you choose the provider, the model and where the key lives:
      </p>
      <Code lang="ts" code={PROVIDERS} />
      <p>
        Guidance and knowledge come first in every drafting prompt, in a stable order, so providers that cache prompt
        prefixes reuse them from one ticket to the next. For a provider that needs the prefix marked, pass the marker as{" "}
        <code>cache</code>, for example <code>{`{ anthropic: { cacheControl: { type: "ephemeral" } } }`}</code>.
      </p>

      <H2 id="knowledge">Knowledge</H2>
      <p>
        A knowledge source has an <code>id</code> and a <code>load()</code> that returns articles:{" "}
        <code>{`{ id, title, url?, text }`}</code>. Two are included, and writing your own takes a few lines.
      </p>
      <Code title="lib/support/knowledge-sources.ts" lang="ts" code={KNOWLEDGE} />
      <p>
        Articles are copied into <code>support_knowledge</code> once a day by <code>runScheduled</code>, and whenever you
        call <code>ai.syncKnowledge()</code> or press Sync now. Only articles whose content changed are rewritten; articles
        that disappeared from a source are removed, and so is a source you take out of the config. If a source fails to
        load, its stored articles keep answering until the next sync.
      </p>
      <Callout title="No file system at runtime?">
        On Cloudflare Workers and similar runtimes, use <code>docsFromUrl</code> with a file you publish, or import your
        Markdown as strings at build time and pass them to <code>docsFromFiles</code>.
      </Callout>

      <H2 id="account-facts">Account facts</H2>
      <p>
        Add <code>describeCustomer</code> to <Link href="/docs/directory">your directory</Link> to return a few lines
        about a customer&apos;s account. They appear in the ticket&apos;s sidebar, with or without AI. With AI, they go
        into the prompt for that customer&apos;s own tickets only, and a suggestion can cite them.
      </p>
      <Code title="lib/support/directory.ts" lang="ts" code={FACTS} />
      <p>It&apos;s only called for tickets linked to a customer, so unknown and spoofed senders never see account data in a reply.</p>

      <H2 id="when-it-runs">When it runs</H2>
      <p>
        Receiving a message only queues the work, so a slow or failing model never delays or breaks a webhook. Pass{" "}
        <code>defer</code> to start right after the response is sent:
      </p>
      <Code lang="ts" code={DEFER} />
      <p>
        Without <code>defer</code>, the next <code>runScheduled</code> picks it up, so suggestions arrive within your cron
        interval. Either way, a failed attempt is logged and retried by <code>runScheduled</code>, three times at most.
        The model is never called inside a database transaction or while a connection is held: Tendkit reads, calls the
        model, then writes.
      </p>

      <H2 id="screens">Screens</H2>
      <p>
        The AI parts are in <code>support-ui</code> and appear when your client has <code>ai</code>. Expose the methods
        through your API, then add them to the client:
      </p>
      <Code title="app/api/support/route.ts" lang="ts" code={API} />
      <Code title="app/admin/support/client.ts" lang="tsx" code={CLIENT} />
      <p>
        <code>getTicket</code> and <code>listTickets</code> already return what the screens need (<code>insight</code>,{" "}
        <code>suggestion</code>, <code>accountFacts</code>, <code>urgency</code>, <code>summary</code>,{" "}
        <code>draftReady</code>), and the reply box sends <code>suggestionId</code> with <code>reply</code>.{" "}
        <code>SupportAiSettings</code> is the screen where your team writes its guidance, lists its topics, turns
        suggestions on arrival on or off and syncs knowledge. Try all of it in the <Link href="/demo">demo</Link>, where
        the AI is scripted.
      </p>

      <H2 id="voice">Voice</H2>
      <p>
        The reply box has one microphone button, so an agent can speak instead of type, in any language. What happens
        with their words follows from what&apos;s in the box:
      </p>
      <ul>
        <li>
          <strong>An empty reply box takes notes.</strong> &quot;Tell her verification is pending, offer the onboarding
          call&quot; goes through Write it up and comes back as a finished reply in the customer&apos;s language and your
          tone.
        </li>
        <li>
          <strong>A reply box with text takes a change.</strong> &quot;Shorter, and mention the call&quot; is applied to
          the reply like a typed instruction, and Undo brings the earlier text back.
        </li>
        <li>
          <strong>Insert as spoken</strong> puts the words in as text at the cursor, with no rewrite. The choice sits next
          to the transcript while the agent speaks and is remembered in that browser. Internal notes always work this
          way.
        </li>
      </ul>
      <p>
        While listening, the agent sees the input level, the time against the two-minute limit, and the transcript, which
        stays in view while it&apos;s applied. Done (or the button again) applies it, Escape cancels at any point, and{" "}
        <code>⌘ Shift Space</code> (<code>Ctrl Shift Space</code> on Windows and Linux) starts and stops without the mouse. At two minutes the recording stops and is applied. If the model call
        fails, the transcript is kept so the agent can try again without repeating themselves.
      </p>
      <p>Where speech becomes text depends on your setup:</p>
      <ul>
        <li>
          <strong>With a transcription model.</strong> Set <code>transcriptionModel</code> to any AI SDK transcription
          model (OpenAI, ElevenLabs, Deepgram, Groq and others) and add <code>transcribe</code> to your client. The
          browser records, your server passes the audio to the provider, and the provider detects the language.
        </li>
        <li>
          <strong>Without one.</strong> The reply box uses the browser&apos;s own speech recognition (the Web Speech API,
          in Chrome, Edge and Safari), listening in the <code>speechLocale</code> you give <code>SupportProvider</code>,
          or its <code>locale</code> when you give none. Speech recognition wants a region, so pass{" "}
          <code>&quot;fr-FR&quot;</code> when your UI locale is a bare <code>&quot;fr&quot;</code>. This is what you get
          with a provider that has no speech to text, such as Anthropic.
        </li>
        <li>
          <strong>With neither</strong> (Firefox without a transcription model, for example), there is no microphone
          button.
        </li>
      </ul>
      <Code title="lib/support/index.ts" lang="ts" code={VOICE} />
      <Code title="Sending the recording" lang="ts" code={VOICE_ROUTE} />
      <Callout title="Use a transcription model for languages other than English">
        Browser speech recognition listens in one language at a time and is noticeably weaker outside English. For teams
        that speak Arabic, French or a mix of languages, a transcription model is far more accurate and detects the
        language on its own.
      </Callout>
      <p>
        Audio is never stored: the recording lives in the browser&apos;s memory until it&apos;s sent, and{" "}
        <code>ai.transcribe</code> hands it to the provider and returns the text. Recordings are about half a megabyte
        for two minutes; <code>ai.transcribe</code> refuses anything over 10 MB. With browser speech recognition, the
        browser decides where audio is processed, and Chrome sends it to Google. If the microphone is blocked, missing or
        hears nothing, the reply box says so and how to fix it.
      </p>

      <H2 id="memory">Memory</H2>
      <p>
        Every day your team answers questions your docs don&apos;t cover and rewrites drafts that missed the tone. Memory
        keeps that work, so the next draft starts from it. It needs the <code>0002_memory</code> migration and nothing
        else: no vector database, on Postgres and on D1 alike.
      </p>
      <ul>
        <li>
          <strong>Approved answers.</strong> On any sent reply, or on what&apos;s in the reply box, an agent chooses Save
          as approved answer. The fast model proposes the question it answers and takes the customer&apos;s details out
          of the text (the names on the ticket are also replaced in code, whatever the model returns); the agent reviews
          both and saves. From then on it is the drafts&apos; most trusted source, ahead of your articles and cited the
          same way, and any agent inserts it by typing <code>/</code> at the start of a line in the reply box: no model
          call, with <code>{`{name}`}</code>, <code>{`{company}`}</code> and <code>{`{agent}`}</code> filled in for
          the ticket. Answers apply to every language unless you keep one to customers who write in a given language.
          They are listed, edited and deleted in <code>SupportAiSettings</code>.
        </li>
        <li>
          <strong>Learning from edits.</strong> When an agent changes a draft before sending it, the draft and what was
          sent are kept with the customer&apos;s question. Later drafts on the same topic or a similar question get them
          as guidance on tone and structure, never as a source of facts.
        </li>
        <li>
          <strong>Guidance suggestions.</strong> Once a day, the drafts agents rewrote in the last 30 days are read
          together. When the same change shows up on at least two tickets, it is proposed as a rule for your guidance,
          with the reason and the tickets (&quot;In 3 of 5 replies about verification, agents added the onboarding call
          link&quot;). A person rewords, accepts or dismisses it in the settings. Nothing is added to the guidance
          without that, and a dismissed rule isn&apos;t proposed again.
        </li>
        <li>
          <strong>Gaps.</strong> Questions that got &quot;no suggested reply&quot;, and drafts an agent discarded, are
          grouped once a day by what was asked: the theme, how many tickets asked, when last, and links to them. Close a
          gap by writing its approved answer right there, or dismiss it. If a question comes back after its gap was
          resolved, a new gap opens: the answer isn&apos;t working.
        </li>
        <li>
          <strong>Articles from solved tickets.</strong> Draft an article, on a gap or on a solved ticket&apos;s menu,
          writes a Markdown help article from what your agents actually replied, and says so when no ticket has an answer
          yet. Copy it into your docs (your knowledge sync brings it back as a source) or save it as an approved answer.
          Tendkit has no docs CMS and doesn&apos;t try to be one.
        </li>
      </ul>
      <Callout title="One customer's ticket never writes another customer's reply">
        A corrected draft is full of one customer&apos;s details, so the two uses are kept apart. Replies sent to the{" "}
        <em>same</em> customer go into that customer&apos;s later drafts as they were sent: their data serves them. For
        everyone else, each correction is first reduced to one sentence about style (&quot;Open with what was already
        done, then explain the policy&quot;), and that sentence is thrown away unless it passes a check written in code,
        not in a prompt: no digits, no links or addresses, none of the names on the ticket, and no five words in a row
        from the conversation. Tickets that aren&apos;t linked to a customer only ever get style notes. Set{" "}
        <code>shareStyleNotes: false</code> to keep every correction within its customer.
      </Callout>
      <p>
        Earlier corrections are found with a plain word index (<code>support_example_terms</code>), the ticket&apos;s
        topic and the customer, which works the same on Postgres and SQLite. It isn&apos;t a full-text extension on
        purpose: D1 can&apos;t export a database that has FTS5 virtual tables, and Drizzle can&apos;t generate them. For
        ranking by meaning, pass an <code>embedder</code>; the candidates are re-ordered in memory and no vectors are
        stored.
      </p>
      <Code title="lib/support/index.ts" lang="ts" code={EMBEDDER} />
      <p>
        Style notes are drawn by <code>runScheduled</code> a few at a time with the fast model; the daily review uses the
        main model for guidance suggestions and the fast one for gaps. None of it runs while a reply is being sent, and
        a failure is logged and tried again later without touching the inbox. To turn the screens on, expose the methods
        and add the ones you want to your client:
      </p>
      <Code title="app/api/support/route.ts" lang="ts" code={MEMORY_API} />
      <Code title="app/admin/support/client.ts" lang="ts" code={MEMORY_CLIENT} />

      <H2 id="actions">Actions</H2>
      <p>
        A reply that says &quot;done&quot; beats one that says &quot;we&apos;ll look into it&quot;. Actions are what
        your product can do for a customer from a ticket: look up an invoice, resend an email, extend a trial. You
        declare them in code; AI looks things up while it drafts and proposes changes with the reply; an agent approves
        each change before it happens. It needs the <code>0003_actions</code> migration, and <code>zod</code> (or any
        Standard Schema library) for the inputs.
      </p>
      <Code title="lib/support/index.ts" lang="ts" code={ACTIONS} />
      <Props
        rows={[
          { name: "name", type: "string", required: true, description: "How the model and the log refer to it: lowercase letters, digits and underscores, unique." },
          { name: "title", type: "string", required: true, description: 'What agents see, such as "Extend trial".' },
          { name: "description", type: "string", required: true, description: "For the model: what it does and when to use it." },
          { name: "input", type: "schema", required: true, description: "A Zod schema, any Standard Schema, or the AI SDK's jsonSchema(). An object. It is what the model must fill in, what an agent's edits are checked against, and what the form is built from." },
          { name: "approval", type: '"always" | "never"', default: '"always"', description: '"never" is for read-only lookups: AI may run them on its own while drafting. Everything else waits for an agent.' },
          { name: "portal", type: "boolean", default: "false", description: <>For lookups only: also lets the portal&apos;s <Link href="/docs/proactive#self-serve">Ask box</Link> run it, for the signed-in customer. <code>run</code> and <code>available</code> then get <code>ticket: null</code> and <code>contact: null</code>, since no ticket exists yet.</> },
          { name: "run", type: "({ input, ticket, customer, contact, agent, signal }) => { ok, summary, data? }", required: true, description: "Does it. summary is one line for the agent and the timeline; data is what a draft may quote. Answer ok: false when it didn't happen; throw only when you can't tell." },
          { name: "available", type: "({ ticket, customer }) => boolean", description: "Whether it applies to this ticket: a plan, a status, a channel. Defaults to always. ticket is null only for lookups marked portal: true." },
          { name: "timeoutMs", type: "number", default: "15000", description: "How long a run may take. After that the signal is aborted and the run is logged as timed out." },
        ]}
      />
      <ul>
        <li>
          <strong>Lookups.</strong> While drafting, the model can call your <code>&quot;never&quot;</code> actions
          through the AI SDK&apos;s tool calling, up to six per draft, and state what they returned. Each one the reply
          relies on is listed under &quot;Based on&quot; with its result, next to your articles and account facts. A
          lookup that fails tells the model there is no answer, never what was thrown.
        </li>
        <li>
          <strong>Proposed actions.</strong> When the customer&apos;s request calls for a change, the suggestion comes
          with it: a card under the suggested reply with what it will do, why, and its inputs, which the agent can edit.
          The reply is written as if it has been done. Approve runs it and records the result on the ticket&apos;s
          timeline, which only agents see. Skip rewrites the reply so it no longer says so; changing the inputs before
          approving rewrites it to what was actually done. Sending while a proposal is still undecided asks first.
        </li>
        <li>
          <strong>By hand.</strong> Every available action is also in the ticket&apos;s ⋯ menu, with a small form built
          from its schema: text, number, date, a switch, a select for an enum, and a JSON field for lists and nested
          objects.
        </li>
        <li>
          <strong>Settings.</strong> <code>SupportAiSettings</code> lists your actions and how each one runs. The team
          can stop a lookup from running on its own (agents can still run it). Whether an action needs approval is not
          a setting: it is in your code, where a change to it is reviewed.
        </li>
      </ul>
      <Callout title="What keeps an action safe">
        <strong>The customer is never an input.</strong> An action runs for the customer the ticket is linked to, passed
        by Tendkit; a ticket from an unknown sender has no actions at all. <strong>A message can&apos;t run a change.</strong>{" "}
        When the model calls an action that needs approval, the call only records a proposal: your <code>run</code> is
        reachable through <code>runAction</code> alone, which takes the signed-in agent&apos;s id from your server.
        Inputs are checked against your schema when proposed and again when approved. <strong>One approval runs once.</strong>{" "}
        A double click, or two agents approving the same proposal, get the first run; after a failure, approving again
        is a new attempt. <strong>Every run is logged</strong> in <code>support_action_runs</code>: who approved it, the
        inputs, how it ended and how long it took, including lookups. A run that throws or times out is shown to the
        agent as unconfirmed, with advice to check the account before trying again, and what was thrown stays in your
        log.
      </Callout>
      <p>To turn the screens on, expose the methods and add them to your client:</p>
      <Code title="app/api/support/route.ts" lang="ts" code={ACTIONS_API} />
      <Code title="app/admin/support/client.ts" lang="ts" code={ACTIONS_CLIENT} />

      <H2 id="autopilot">Autopilot</H2>
      <p>
        Some questions get the same correct answer every time. Autopilot lets those be answered in minutes with no
        person involved, topic by topic, so your team spends its time on what needs judgment. It is never switched on
        for you: a topic earns it with evidence, a person on your team grants it, and every reply still has to pass
        each check below. It needs the <code>0004_autopilot</code> migration, which also files the outcomes you have
        already recorded under their topics, so a team that has used suggested replies for a while starts with a track
        record.
      </p>
      <H3>The track record</H3>
      <p>
        Every suggested reply is stored with how it ended. For each topic, over the last 30 days, Tendkit counts the
        drafts agents decided on:
      </p>
      <ul>
        <li><strong>Sent as drafted.</strong> The agent sent it unchanged.</li>
        <li>
          <strong>Lightly edited.</strong> Under 15% of the words changed, and every number, link and address stayed.
          Changing &quot;3 business days&quot; to &quot;5&quot; is one word and a different answer, so any edit that adds,
          removes or replaces a number, a link or an email address counts as a rewrite.
        </li>
        <li><strong>Rewritten</strong> and <strong>discarded.</strong> The draft wasn&apos;t what the agent wanted to say.</li>
        <li>
          <strong>Came back unhappy.</strong> It was sent as drafted or lightly edited, and the customer&apos;s next
          message sounded frustrated or angry, or said the reply didn&apos;t help. It counts against the topic.
        </li>
        <li><strong>Flagged.</strong> Autopilot sent it and an agent marked it as wrong.</li>
      </ul>
      <p>
        Next to those it shows how many questions it couldn&apos;t answer (they always go to a person), how many replies
        Autopilot sent, how many were followed by a reopened ticket, and the split by language. Drafts still waiting, or
        replaced because the customer wrote again, are no evidence either way and aren&apos;t counted.
      </p>
      <H3>Eligible, then switched on by a person</H3>
      <p>
        A topic is <strong>ready</strong> when its latest 30 decided drafts are at least 90% sent as drafted or lightly
        edited, with no flagged reply waiting for review. Both numbers are set in code; in AI settings your team can raise
        them and never lower them. <code>SupportAiSettings</code> shows every topic with its numbers and a link to the
        drafts behind them, each with what was sent instead and its ticket.
      </p>
      <p>
        Ready is an invitation. Someone switches the topic on, choosing how it sends, and their name and the date are
        kept. <code>setAutopilotTopic</code> refuses a topic that isn&apos;t ready, whoever asks.
      </p>
      <ul>
        <li>
          <strong>Hold for review</strong> (start here). The reply is queued on the ticket, which stays open, and is sent
          after 10 minutes unless someone steps in: stopping it, answering, leaving a note, or changing the status. A
          stopped reply stays as an ordinary suggestion. A held reply is taken in one conditional update before
          anything is done with it, by the scheduler to send it or by an agent who stops it or answers, so the
          customer never gets two: an agent who replies in the seconds Autopilot is sending is asked to reload
          instead. Held replies are sent by <code>runScheduled</code>, so the wait
          is the hold time plus up to one interval of your schedule.
        </li>
        <li><strong>Send immediately.</strong> The reply goes out as soon as it is written.</li>
      </ul>
      <H3>What a reply must pass</H3>
      <p>Autopilot sends a reply only when all of these hold. Otherwise it stays a suggested reply, and says why.</p>
      <ul>
        <li>The ticket&apos;s topic is on, and Autopilot isn&apos;t stopped.</li>
        <li>The ticket is linked to a customer. Unknown senders, contact forms and mail that failed authentication never are.</li>
        <li>The channel is allowed: every email channel by default, or the ids in <code>channels</code>.</li>
        <li>
          The draft is confident and fully sourced: the model marked every statement as backed by a source, every
          source it cited exists, and at least one of them is an article, an approved answer, an account fact or a
          lookup. Guidance alone is tone, not an answer.
        </li>
        <li>
          Nothing on the ticket reads like an attempt to steer the assistant (&quot;ignore your instructions&quot;, a
          request for another customer&apos;s data), and the reply doesn&apos;t recite your guidance. Either one
          leaves the draft to an agent as <code>not_confident</code>. A false alarm costs one review.
        </li>
        <li>It proposes no action. Changes to an account always wait for an agent.</li>
        <li>The customer doesn&apos;t sound angry and the ticket isn&apos;t urgent (<code>blockMoods</code>, <code>blockUrgencies</code>).</li>
        <li>The customer hasn&apos;t asked for a person, and hasn&apos;t said the last reply didn&apos;t help.</li>
        <li>It isn&apos;t the customer&apos;s third message since the ticket was opened or reopened.</li>
        <li>The topic has at least five decided drafts in the customer&apos;s language, at the same rate.</li>
        <li>Fewer than 30 replies went out in the last hour.</li>
      </ul>
      <p>
        A reply asked for by an agent (<code>ai.draft</code>) is theirs to send, and &quot;I can&apos;t answer this&quot;
        is never sent.
      </p>
      <H3>What the customer and the team see</H3>
      <p>
        The reply goes out from your team, to the people a reply would go to by default. It never signs as a person. By
        default it ends with your <code>fromName</code> and one line: &quot;This reply was sent automatically. If it
        doesn&apos;t help, reply to say so and a person will take over.&quot; That line is true by construction: a
        customer who says so, or comes back sounding unhappy, is never answered by Autopilot again on that message. Set{" "}
        <code>signature</code> to word it your way or in the customer&apos;s language, or to <code>false</code> if you
        tell customers some other way. The signature is left off when a channel has no room for it.
      </p>
      <p>
        Agents see the reply on the timeline as &quot;Autopilot&quot;, marked &quot;Sent by Autopilot&quot; with its topic.
        Customers and the portal never see that mark. The ticket moves to Waiting on customer with its assignee unchanged, and the
        customer&apos;s next message brings it back to Open like any other.
      </p>
      <H3>Brakes</H3>
      <ul>
        <li>
          <strong>Flag as wrong.</strong> One click, by any agent, under a reply Autopilot sent, with a note if they
          want to say what was wrong. The topic pauses at once,
          the ticket goes back to Open, and the question is filed with the next daily review as an{" "}
          <a href="#memory">unanswered question</a>. The topic stays paused until someone with permission resumes it,
          which records the review.
        </li>
        <li>
          <strong>Automatic pause.</strong> When fewer than 90% of a topic&apos;s latest 30 drafts are right (judged from
          10 drafts on), it pauses: checked before every send and on every scheduled run. It can be resumed once the
          record has recovered.
        </li>
        <li>
          <strong>Stop Autopilot.</strong> A kill switch in AI settings that any agent can pull. Nothing more is sent,
          held replies included; topics keep their switches for when it is started again.
        </li>
        <li><strong>An hourly cap</strong> across all topics, <code>maxPerHour</code>.</li>
        <li>
          <strong>Failures fall back.</strong> A reply the channel didn&apos;t take stays on the ticket as failed, with the
          draft as a suggestion. If anything in Autopilot errors, the draft waits for an agent.
        </li>
      </ul>
      <Code title="lib/support/index.ts" lang="ts" code={AUTOPILOT} />
      <Callout title="Who may switch it on">
        Stopping, switching a topic off, holding a reply and flagging are open to every agent. Switching a topic on,
        resuming one, starting Autopilot again and raising the bar go through <code>canManage(agentId)</code> when you
        set it. Either way, pass the signed-in agent&apos;s id as <code>actorId</code> from your server: it is who the
        decision is recorded under.
      </Callout>
      <p>To turn the screens on, expose the methods and add them to your client:</p>
      <Code title="app/api/support/route.ts" lang="ts" code={AUTOPILOT_API} />
      <Code title="app/admin/support/client.ts" lang="ts" code={AUTOPILOT_CLIENT} />

      <H2 id="methods">Methods</H2>
      <p>
        <code>support().ai</code> exists only when <code>ai</code> is configured.
      </p>
      <Props
        rows={[
          { name: "getSettings / updateSettings", type: "{ guidance, topics, draftOnArrival, selfServe }", description: "Team guidance (up to 20,000 characters), up to 30 topics, whether to suggest a reply as messages arrive (on by default), and whether the portal's Ask box answers customers (off by default)." },
          { name: "syncKnowledge / listKnowledgeSources", type: "", description: "Sync every source now; list each source with its article count and last sync." },
          { name: "draft", type: "({ ticketId }) => Suggestion", description: "Suggest a reply now, for teams that turned suggestions on arrival off." },
          { name: "refine", type: "({ ticketId, text, instruction, language? }) => { text }", description: 'instruction is "shorter", "friendlier", "formal", "translate" or { custom }. Translate goes to the customer\'s language unless you pass one.' },
          { name: "writeUp", type: "({ ticketId, notes }) => { text }", description: "An agent's notes as a finished reply, with the main model." },
          { name: "translate", type: "({ messageId, to? }) => { text }", description: "A message in another language; to defaults to agentLanguage." },
          { name: "transcribe", type: "({ audio, language? }) => { text, language }", description: "Speech to text with transcriptionModel. audio is a Blob, Uint8Array or ArrayBuffer of up to 10 MB; language is a hint passed to transcriptionOptions. Nothing is stored." },
          { name: "discardSuggestion", type: "(id)", description: "Records that the agent didn't want it." },
          { name: "listApprovedAnswers", type: "() => ApprovedAnswer[]", description: "Every approved answer: { id, title, text, language, … }." },
          { name: "generaliseAnswer", type: "({ ticketId, text }) => { title, text, language }", description: "A reply with the customer's details taken out and a title proposed, for the agent to review. Saves nothing." },
          { name: "saveApprovedAnswer", type: "({ id?, title, text, language?, ticketId?, gapId?, actorId })", description: "Creates an answer, or changes the one with id. gapId marks that gap resolved. Up to 10,000 characters." },
          { name: "deleteApprovedAnswer", type: "(id)", description: "Drafts stop using it at once." },
          { name: "listGuidanceSuggestions", type: "() => { id, rule, reason, tickets }[]", description: "Rules waiting for a decision." },
          { name: "decideGuidanceSuggestion", type: "({ id, accept, rule?, actorId })", description: "Accepting appends the rule (or your rewording of it) to the guidance and returns the settings. Dismissing keeps it from coming back." },
          { name: "listGaps / dismissGap", type: "", description: "Open gaps, most asked first: { id, theme, count, lastSeenAt, tickets }." },
          { name: "draftArticle", type: "({ gapId } | { ticketIds }) => { title, markdown }", description: "A help article from the answered tickets of a gap, or from up to six tickets you choose." },
          { name: "ticketActions", type: "({ ticketId }) => TicketAction[]", description: "The actions that apply to a ticket, each with its form fields. Empty when the ticket isn't linked to a customer." },
          { name: "runAction", type: "({ ticketId, action, input, actorId, suggestionId?, text? }) => { run, text }", description: "Runs an action for the ticket's customer and logs it. With suggestionId it approves a proposal, once. text is the reply box, returned rewritten when the inputs were changed." },
          { name: "declineAction", type: "({ ticketId, suggestionId, action, actorId, text? }) => { text }", description: "Skips a proposal and returns the reply rewritten without it." },
          { name: "listActions / setActionEnabled", type: "", description: "Every declared action as { name, title, description, approval, enabled }; setActionEnabled({ name, enabled }) only accepts lookups." },
          { name: "listActionRuns", type: "({ ticketId, limit? }) => ActionRun[]", description: "A ticket's log, newest first: action, input, trigger (draft, suggestion or manual), status, summary, approvedBy, durationMs." },
          { name: "getAutopilot", type: "() => AutopilotOverview", description: "Every topic with its stage (collecting, eligible, on, paused), track record, mode and who switched it on, plus the thresholds in force and the kill switch." },
          { name: "setAutopilotTopic", type: "({ topic, on, mode?, actorId })", description: 'Switches a topic on ("hold" or "immediate"), off, or changes its mode. Switching on or resuming is refused unless the record meets the thresholds.' },
          { name: "setAutopilot", type: "({ stopped?, minDrafts?, minRate?, actorId })", description: "The kill switch, and thresholds stricter than the ones in code (minRate is 0 to 1; null goes back to the code's)." },
          { name: "autopilotExamples", type: "({ topic, only?, limit? }) => AutopilotExample[]", description: 'A topic\'s recent drafts with how each ended, the text sent instead and the ticket. only: "changed" leaves out the ones that were right.' },
          { name: "holdAutopilotReply", type: "({ suggestionId, actorId })", description: "Stops a held reply. It stays on the ticket as a suggestion." },
          { name: "flagAutopilotReply", type: "({ suggestionId, actorId, note? })", description: "Marks a reply Autopilot sent as wrong: pauses its topic, reopens the ticket and files the question as a gap." },
          { name: "draftOpening", type: "({ intent, customerId?, contactId?, channelId? }) => { subject, text, sources }", description: <>The first message of a conversation an agent starts, from one line of intent. Sends nothing. See <Link href="/docs/proactive#start-a-conversation">Start a conversation</Link>.</> },
          { name: "listOutreach / sendOutreach / dismissOutreach / holdOutreach", type: "", description: <>The Outreach queue: messages proposed from signals, sent or dismissed by an agent (<code>actorId</code>). See <Link href="/docs/proactive#signals">Signals</Link>.</> },
          { name: "getOutreachKinds / setOutreachKind", type: "", description: <>Each kind of outreach with its track record, and the switch that lets one send on its own. See <Link href="/docs/proactive#sending-on-its-own">Sending on its own</Link>.</> },
          { name: "previewBroadcast / draftBroadcast / sendBroadcast", type: "", description: <>One message to every customer an acknowledged spike affects. See <Link href="/docs/proactive#broadcast">Incident broadcast</Link>.</> },
          { name: "setInsight", type: "({ ticketId, actorId, topic?, urgency? })", description: "An agent's correction. Kept on later messages and recorded on the timeline." },
        ]}
      />
      <p>
        <code>reply</code> takes an optional <code>suggestionId</code> and records the outcome.{" "}
        <code>listTickets</code> accepts <code>sort: &quot;priority&quot;</code>, which falls back to the longest wait when
        AI isn&apos;t configured.
      </p>

      <H2 id="privacy">Privacy</H2>
      <Callout title="What leaves your servers">
        With AI on, the conversation on a ticket (customer messages, your replies and internal notes), that
        customer&apos;s account facts, your guidance and your knowledge articles are sent to the model provider you
        configure, under your own account and its terms. Tendkit has no service of its own and sends nothing anywhere
        else. So is what a lookup returns (<code>summary</code> and <code>data</code>): return only what a reply may
        say. Attachments are never sent. Voice recordings go to your transcription provider, or to the browser&apos;s
        speech service when you haven&apos;t set one, and are never stored.
      </Callout>
      <p>
        Insights, suggestions and their outcomes are stored in your database, in <code>support_ticket_insights</code> and{" "}
        <code>support_suggestions</code>, and are deleted with the ticket. So are the corrections memory keeps (
        <code>support_examples</code>), a ticket&apos;s place in a gap, and the log of the actions run on it (
        <code>support_action_runs</code>, with their inputs and results). Autopilot adds no new copy of a conversation: a
        track record is counted from <code>support_suggestions</code>, and <code>support_autopilot_topics</code> holds
        only each topic&apos;s switch and who set it. Approved answers and accepted guidance are your
        team&apos;s own text and stay until you delete them. The daily review sends the month&apos;s rewritten drafts, and
        the questions that went unanswered, to the same provider as everything else. Tell your customers about the provider where
        your privacy policy requires it, and choose one whose data terms fit your product.
      </p>
    </DocsShell>
  );
}
