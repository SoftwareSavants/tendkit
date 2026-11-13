import type { Metadata } from "next";
import Link from "next/link";
import { Code } from "@/site/code";
import { Callout, DocsShell, H2, Props, Step, Steps } from "@/site/docs/shell";

export const metadata: Metadata = {
  title: "AI",
  description: "Optional AI for the inbox: triage, one-line summaries and suggested replies written from your docs, with any AI SDK model.",
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
        { id: "methods", title: "Methods" },
        { id: "privacy", title: "Privacy" },
      ]}
    >
      <p>
        AI is optional. Without it, nothing in Tendkit changes. With it, every customer message is read as it arrives: the
        inbox shows what the customer needs and how urgent it is, and the ticket opens with a reply already written from
        your docs. An agent reviews, changes and sends it. Nothing is ever sent on its own.
      </p>

      <H2 id="set-it-up">Set it up</H2>
      <Steps>
        <Step title="Add the item for your database">
          <Code title="Terminal" lang="bash" code={`npx shadcn@latest add @tendkit/support-ai-postgres   # or @tendkit/support-ai-d1\nnpm install @ai-sdk/anthropic                        # the provider you use`} className="mt-1" />
          <p className="mt-3 text-muted-foreground">
            It brings <code>support-ai</code> (the engine, which depends on the{" "}
            <a href="https://ai-sdk.dev" target="_blank" rel="noreferrer">AI SDK</a>&apos;s <code>ai</code> package and nothing
            else) and four tables. If you installed Tendkit before AI existed, update <code>support</code>, your store item
            and <code>support-ui</code> first: see <Link href="/docs/upgrading">Upgrading</Link>.
          </p>
        </Step>
        <Step title="Create the tables">
          <Code title="db/schema.ts" lang="ts" code={`export * from "@/lib/support/postgres/ai-schema";`} className="mt-1" />
          <p className="mt-3 text-muted-foreground">
            Then generate and apply a migration with Drizzle as usual. <code>lib/support/postgres/0001_ai.sql</code> is the
            reference.
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
          { name: "defer", type: "(work: Promise) => void", description: "Runs the model calls after the webhook has answered. Without it they run in the next runScheduled." },
          { name: "agentLanguage", type: "string", default: '"en"', description: "The language your agents read (BCP-47), for summaries, reasons and translations." },
          { name: "knowledgeBudget", type: "number", default: "120000", description: "Characters of knowledge a prompt may carry. Past it, only the articles closest to the conversation are sent." },
          { name: "cache", type: "providerOptions", description: "Set on the shared prompt prefix, for providers that only cache a prefix when it's marked." },
          { name: "transcriptionModel", type: "TranscriptionModel", description: "Speech to text for voice in the reply box. Without it, voice uses the browser's own speech recognition. See Voice." },
          { name: "transcriptionOptions", type: "({ language? }) => providerOptions", description: "Provider options for each transcription, such as a language hint." },
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
          in Chrome, Edge and Safari), listening in the <code>locale</code> you give <code>SupportProvider</code>. This is
          what you get with a provider that has no speech to text, such as Anthropic.
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

      <H2 id="methods">Methods</H2>
      <p>
        <code>support().ai</code> exists only when <code>ai</code> is configured.
      </p>
      <Props
        rows={[
          { name: "getSettings / updateSettings", type: "{ guidance, topics, draftOnArrival }", description: "Team guidance (up to 20,000 characters), up to 30 topics, and whether to suggest a reply as messages arrive (on by default)." },
          { name: "syncKnowledge / listKnowledgeSources", type: "", description: "Sync every source now; list each source with its article count and last sync." },
          { name: "draft", type: "({ ticketId }) => Suggestion", description: "Suggest a reply now, for teams that turned suggestions on arrival off." },
          { name: "refine", type: "({ ticketId, text, instruction, language? }) => { text }", description: 'instruction is "shorter", "friendlier", "formal", "translate" or { custom }. Translate goes to the customer\'s language unless you pass one.' },
          { name: "writeUp", type: "({ ticketId, notes }) => { text }", description: "An agent's notes as a finished reply, with the main model." },
          { name: "translate", type: "({ messageId, to? }) => { text }", description: "A message in another language; to defaults to agentLanguage." },
          { name: "transcribe", type: "({ audio, language? }) => { text, language }", description: "Speech to text with transcriptionModel. audio is a Blob, Uint8Array or ArrayBuffer of up to 10 MB; language is a hint passed to transcriptionOptions. Nothing is stored." },
          { name: "discardSuggestion", type: "(id)", description: "Records that the agent didn't want it." },
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
        else. Attachments are never sent. Voice recordings go to your transcription provider, or to the browser&apos;s
        speech service when you haven&apos;t set one, and are never stored.
      </Callout>
      <p>
        Insights, suggestions and their outcomes are stored in your database, in <code>support_ticket_insights</code> and{" "}
        <code>support_suggestions</code>, and are deleted with the ticket. Tell your customers about the provider where
        your privacy policy requires it, and choose one whose data terms fit your product.
      </p>
    </DocsShell>
  );
}
