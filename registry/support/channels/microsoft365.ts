import {
  ChannelError,
  WebhookError,
  type Channel,
  type ChannelEvent,
  type ChannelState,
  type InboundAttachment,
  type InboundMessage,
  type OutboundAttachment,
} from "../channel";
import { htmlToText } from "../text";
import type { Address } from "../types";
import { base64Decode, base64Encode } from "./crypto";

export type Microsoft365ChannelOptions = {
  id: string;
  /** Directory (tenant) id of the Entra tenant that owns the mailbox. */
  tenantId: string;
  /** Application (client) id of the app registration. */
  clientId: string;
  clientSecret: string;
  /** The user or shared mailbox the inbox reads and sends from, e.g. "support@acme.com". */
  mailbox: string;
  /** Public URL of this channel's webhook. Omit to rely on polling (sync) only. */
  notificationUrl?: string;
  /** Secret Graph echoes in every notification. Required with `notificationUrl`. */
  clientState?: string;
  fetch?: typeof fetch;
  /** Microsoft Graph base URL; change it for national clouds. */
  baseUrl?: string;
};

type Recipient = { emailAddress?: { name?: string | null; address?: string | null } };
type GraphMessage = {
  id: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
  internetMessageHeaders?: { name: string; value: string }[];
  from?: Recipient | null;
  sender?: Recipient | null;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  subject?: string | null;
  body?: { contentType: "html" | "text"; content: string } | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  hasAttachments?: boolean;
  isDraft?: boolean;
  singleValueExtendedProperties?: { id: string; value: string }[];
};
type GraphAttachment = {
  "@odata.type"?: string;
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean;
  contentId?: string | null;
  contentBytes?: string | null;
};
type DeltaPage = {
  value?: { id: string; receivedDateTime?: string; "@removed"?: unknown }[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};
type Subscription = { id: string; expirationDateTime: string; resource?: string; notificationUrl?: string };
type FolderState = { link: string; seen: string[] };
type SyncState = {
  /** Mail received before this instant is never imported. */
  since: string;
  syncedAt?: string;
  inbox?: FolderState;
  sent?: FolderState;
  subscription?: { id: string; expiresAt: string } | null;
  /** Why the change-notification subscription couldn't be created or renewed. Polling keeps working. */
  subscriptionError?: string | null;
};

/**
 * Marks mail sent through this adapter (a named MAPI property, invisible in Outlook), so the Sent
 * Items sweep doesn't record our own replies a second time as replies "sent from Outlook".
 */
const SENT_BY_TENDKIT = "String {6f1c4a52-3b8e-4d27-9a0f-2c5e7b1d9e43} Name TendkitMessageId";
const MESSAGE_SELECT =
  "id,internetMessageId,conversationId,internetMessageHeaders,from,sender,toRecipients,ccRecipients," +
  "subject,body,receivedDateTime,sentDateTime,hasAttachments,isDraft";
/** Headers the core reads for auto-reply and bounce detection, plus threading. */
const KEPT_HEADERS = new Set([
  "auto-submitted",
  "precedence",
  "x-precedence",
  "list-id",
  "list-unsubscribe",
  "list-post",
  "x-auto-response-suppress",
  "x-autoreply",
  "x-autorespond",
  "x-autoresponder",
  "x-autoreply-from",
  "x-mail-autoreply",
  "x-failed-recipients",
  "return-path",
  "content-type",
]);
const DAY = 24 * 3_600_000;
/** Outlook message subscriptions live at most 10,080 minutes; we ask for 6 days and renew with 3 left. */
const SUBSCRIPTION_LIFETIME = 6 * DAY;
const RENEW_BEFORE = 3 * DAY;
/** Graph takes attachments under 3 MB inline; larger ones go through an upload session in < 4 MB ranges. */
const INLINE_ATTACHMENT_LIMIT = 3_000_000;
const UPLOAD_CHUNK = 3 * 1024 * 1024;
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const SEEN_LIMIT = 500;

/**
 * A Microsoft 365 (Exchange Online) mailbox through Microsoft Graph, app-only. Inbound mail comes
 * from change notifications (when `notificationUrl` is set) and a delta sweep of Inbox on every
 * `sync()`; replies your team sends from Outlook come from a delta sweep of Sent Items and are
 * recorded as outbound. Junk Email is never read.
 *
 * Setup:
 * 1. Entra admin center → App registrations → New registration (single tenant). Copy the
 *    Directory (tenant) id and Application (client) id; add a client secret.
 * 2. Don't grant Mail.* API permissions on the app in Entra: a tenant-wide grant there overrides any
 *    mailbox scoping. Scope access to the one mailbox with Exchange RBAC for Applications
 *    (Exchange Online PowerShell; the enterprise app's service principal object id, not the app id):
 *      New-ServicePrincipal -AppId <clientId> -ObjectId <servicePrincipalObjectId> -DisplayName "Tendkit"
 *      New-ManagementScope -Name "Tendkit mailbox" -RecipientRestrictionFilter "EmailAddresses -eq 'SMTP:support@acme.com'"
 *      New-ManagementRoleAssignment -App <servicePrincipalObjectId> -Role "Application Mail.ReadWrite" -CustomResourceScope "Tendkit mailbox"
 *      New-ManagementRoleAssignment -App <servicePrincipalObjectId> -Role "Application Mail.Send" -CustomResourceScope "Tendkit mailbox"
 *      Test-ServicePrincipalAuthorization -Identity <servicePrincipalObjectId> -Resource support@acme.com
 *    Permission changes can take up to 2 hours to apply.
 * 3. Shared mailbox: agents who reply from Outlook with "Send As" keep the copy in their own Sent
 *    Items unless you run `Set-Mailbox support@acme.com -MessageCopyForSentAsEnabled $true
 *    -MessageCopyForSendOnBehalfEnabled $true`. Without it those replies don't reach the inbox.
 * 4. Optional push: set `notificationUrl` to this channel's public webhook URL and `clientState` to a
 *    long random secret. `sync()` creates and renews the subscription; run it every few minutes
 *    either way, since Graph can drop notifications.
 *
 * Sending: mail goes out as the mailbox itself, so `fromName` can't be applied; Exchange uses the
 * mailbox's display name (set it in the admin center). Graph JSON only accepts custom headers named
 * "x-…", so `Auto-Submitted` is sent as `X-Auto-Response-Suppress: All` instead.
 */
export function microsoft365Channel(options: Microsoft365ChannelOptions): Channel {
  const { mailbox, notificationUrl, clientState } = options;
  if (notificationUrl && !clientState) throw new Error("microsoft365Channel: clientState is required with notificationUrl");
  const doFetch = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
  const box = `/users/${encodeURIComponent(mailbox)}`;
  const enc = encodeURIComponent;

  let cachedToken: { value: string; expiresAt: number } | null = null;
  let pendingToken: Promise<string> | null = null;

  async function call(url: string, init: RequestInit, what: string) {
    try {
      return await doFetch(url, init);
    } catch (error) {
      throw new ChannelError(`Microsoft 365 ${what}: could not reach the server (${String(error)}).`, true);
    }
  }

  async function token(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt - 5 * 60_000 > Date.now()) return cachedToken.value;
    pendingToken ??= (async () => {
      try {
        const res = await call(
          `https://login.microsoftonline.com/${enc(options.tenantId)}/oauth2/v2.0/token`,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: options.clientId,
              client_secret: options.clientSecret,
              scope: "https://graph.microsoft.com/.default",
              grant_type: "client_credentials",
            }),
          },
          "sign-in"
        );
        const body = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          expires_in?: number;
          error?: string;
          error_description?: string;
        };
        if (!res.ok || !body.access_token) {
          const reason = body.error_description?.split("\r\n")[0] ?? body.error ?? `HTTP ${res.status}`;
          throw new ChannelError(
            `Microsoft 365 sign-in failed: ${reason}. Check the tenant id, client id and client secret.`,
            res.status === 429 || res.status >= 500,
            res.status
          );
        }
        cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
        return body.access_token;
      } finally {
        pendingToken = null;
      }
    })();
    return pendingToken;
  }

  async function graphError(res: Response, what: string) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      detail = [body.error?.code, body.error?.message].filter(Boolean).join(": ");
    } catch {}
    if (res.status === 401) cachedToken = null;
    const hint =
      res.status === 403
        ? " Check that the app has Mail.ReadWrite and Mail.Send for this mailbox."
        : res.status === 429
          ? ` Throttled by Microsoft; retry after ${res.headers.get("retry-after") ?? "a few"} seconds.`
          : "";
    return new ChannelError(
      `Microsoft 365 ${what} failed (HTTP ${res.status}${detail ? `, ${detail}` : ""}).${hint}`,
      res.status === 429 || res.status >= 500,
      res.status
    );
  }

  /** A Graph call. Every request asks for immutable ids, which survive moves between folders. */
  async function graph<T>(method: string, pathOrUrl: string, init: { json?: unknown; prefer?: string } = {}): Promise<T> {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${await token()}`,
      prefer: ['IdType="ImmutableId"', init.prefer].filter(Boolean).join(", "),
    };
    if (init.json !== undefined) headers["content-type"] = "application/json";
    const what = `${method} ${new URL(url).pathname.replace(/^.*?\/users\/[^/]+/, "")}`;
    const res = await call(url, { method, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) }, what);
    if (!res.ok) throw await graphError(res, what);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async function bytes(path: string) {
    const res = await call(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${await token()}` } }, "download");
    if (!res.ok) throw await graphError(res, "attachment download");
    return new Uint8Array(await res.arrayBuffer());
  }

  const isStatus = (error: unknown, ...statuses: number[]) =>
    error instanceof ChannelError && error.status !== undefined && statuses.includes(error.status);

  async function getMessage(id: string): Promise<GraphMessage | null> {
    const expand = `singleValueExtendedProperties($filter=id eq '${SENT_BY_TENDKIT}')`;
    try {
      return await graph<GraphMessage>("GET", `${box}/messages/${enc(id)}?$select=${MESSAGE_SELECT}&$expand=${enc(expand)}`);
    } catch (error) {
      if (isStatus(error, 404)) return null; // deleted or moved out of the mailbox since the change
      throw error;
    }
  }

  async function listAttachments(messageId: string): Promise<InboundAttachment[]> {
    const path = `${box}/messages/${enc(messageId)}/attachments`;
    const { value } = await graph<{ value: GraphAttachment[] }>("GET", path);
    return value.flatMap((a): InboundAttachment[] => {
      const type = a["@odata.type"] ?? "#microsoft.graph.fileAttachment";
      if (type.endsWith("referenceAttachment")) return []; // a cloud link, already in the body
      const item = type.endsWith("itemAttachment"); // an attached email or event; $value is its MIME
      return [
        {
          filename: item ? `${a.name || "message"}.eml` : a.name || "attachment",
          contentType: item ? "message/rfc822" : a.contentType || "application/octet-stream",
          size: item ? null : (a.size ?? null),
          contentId: a.contentId?.replace(/^<|>$/g, "") || null,
          inline: a.isInline ?? false,
          read: () => (a.contentBytes ? Promise.resolve(base64Decode(a.contentBytes)) : bytes(`${path}/${enc(a.id)}/$value`)),
        },
      ];
    });
  }

  /**
   * Bodies are fetched as Graph stores them (usually HTML) rather than with
   * `Prefer: outlook.body-content-type="text"`: one request gives us both the HTML for display and,
   * through htmlToText, text that keeps Outlook's quote markers (divRplyFwdMsg, blockquote), so the
   * core can trim quoted history. Graph's own text conversion flattens those away.
   */
  async function toInbound(m: GraphMessage, direction: "inbound" | "outbound"): Promise<InboundMessage> {
    const raw: Record<string, string> = {};
    for (const h of m.internetMessageHeaders ?? []) raw[h.name.toLowerCase()] = h.value;
    const ids = (value?: string) => value?.match(/<[^<>\s]+>/g) ?? [];
    const html = m.body?.contentType === "html" ? m.body.content : null;
    const at = direction === "outbound" ? (m.sentDateTime ?? m.receivedDateTime) : m.receivedDateTime;
    return {
      providerMessageId: m.id,
      direction,
      from: toAddress(m.from) ?? toAddress(m.sender) ?? { address: mailbox },
      to: toAddresses(m.toRecipients),
      cc: toAddresses(m.ccRecipients),
      subject: m.subject ?? null,
      text: html !== null ? htmlToText(html) : (m.body?.content ?? null),
      html,
      headers: Object.fromEntries(Object.entries(raw).filter(([name]) => KEPT_HEADERS.has(name))),
      rfcMessageId: m.internetMessageId ?? null,
      inReplyTo: ids(raw["in-reply-to"])[0] ?? null,
      references: ids(raw["references"]),
      providerThreadId: m.conversationId ?? null,
      receivedAt: at ? new Date(at) : new Date(),
      attachments: m.hasAttachments || html?.includes("cid:") ? await listAttachments(m.id) : [],
    };
  }

  /**
   * Walks one folder's delta. The first run starts from "now": delta's only supported filter,
   * `receivedDateTime ge …`, is baked into the delta token, so later rounds return mail that arrives
   * after setup and never import the mailbox's history. Each new id is then read in full (headers,
   * body) the same way the webhook does; delta itself returns only ids.
   */
  async function syncFolder(
    folder: "inbox" | "sentitems",
    direction: "inbound" | "outbound",
    prev: FolderState | undefined,
    since: string,
    resumeFrom: string,
    events: ChannelEvent[]
  ): Promise<FolderState> {
    const start = (from: string) =>
      `${baseUrl}${box}/mailFolders('${folder}')/messages/delta?changeType=created&$select=id,receivedDateTime` +
      `&$filter=${enc(`receivedDateTime ge ${from}`)}`;
    let link = prev?.link ?? start(since);
    const seen = [...(prev?.seen ?? [])];
    let restarted = !prev;
    for (let page = 0; page < MAX_PAGES; page++) {
      let res: DeltaPage;
      try {
        res = await graph<DeltaPage>("GET", link, { prefer: `odata.maxpagesize=${PAGE_SIZE}` });
      } catch (error) {
        // An expired delta token: restart from the last successful sweep; the core drops repeats.
        if (!restarted && (isStatus(error, 410) || /syncstatenotfound/i.test(String(error)))) {
          restarted = true;
          link = start(resumeFrom);
          continue;
        }
        throw error;
      }
      for (const item of res.value ?? []) {
        // Delta also reports removals and read/unread changes, even of mail older than the filter.
        if (item["@removed"] || seen.includes(item.id)) continue;
        if (item.receivedDateTime && Date.parse(item.receivedDateTime) < Date.parse(since)) continue;
        const m = await getMessage(item.id);
        seen.push(item.id);
        if (!m || m.isDraft) continue;
        if (direction === "outbound" && m.singleValueExtendedProperties?.length) continue; // sent by send()
        events.push({ type: "message", message: await toInbound(m, direction) });
      }
      const next = res["@odata.deltaLink"] ?? res["@odata.nextLink"];
      if (!next) break;
      link = next;
      if (res["@odata.deltaLink"]) break;
    }
    return { link, seen: seen.slice(-SEEN_LIMIT) };
  }

  async function ensureSubscription(current: SyncState["subscription"], now: number) {
    const resource = `users/${mailbox}/mailFolders('inbox')/messages`;
    const expirationDateTime = new Date(now + SUBSCRIPTION_LIFETIME).toISOString();
    const saved = (s: Subscription) => ({ subscription: { id: s.id, expiresAt: s.expirationDateTime }, subscriptionError: null });
    const create = () =>
      graph<Subscription>("POST", "/subscriptions", {
        json: {
          changeType: "created",
          notificationUrl,
          lifecycleNotificationUrl: notificationUrl,
          resource,
          expirationDateTime,
          clientState,
        },
      });
    try {
      if (current) {
        try {
          if (Date.parse(current.expiresAt) - now > RENEW_BEFORE) {
            await graph("GET", `/subscriptions/${enc(current.id)}`); // still there? Graph can remove it
            return { subscription: current, subscriptionError: null };
          }
          return saved(await graph<Subscription>("PATCH", `/subscriptions/${enc(current.id)}`, { json: { expirationDateTime } }));
        } catch (error) {
          if (!isStatus(error, 404)) throw error;
        }
      }
      try {
        return saved(await create());
      } catch (error) {
        // Our state was lost but the subscription survived: replace it so the clientState matches.
        if (!isStatus(error, 409)) throw error;
        const { value } = await graph<{ value: Subscription[] }>("GET", "/subscriptions");
        const same = (r?: string) => r?.replace(/^\//, "").toLowerCase() === resource.toLowerCase();
        for (const s of value.filter((s) => same(s.resource) && s.notificationUrl === notificationUrl)) {
          await graph("DELETE", `/subscriptions/${enc(s.id)}`);
        }
        return saved(await create());
      }
    } catch (error) {
      return { subscription: current ?? null, subscriptionError: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Creates a reply draft, or null when the original isn't (or is no longer) in the mailbox. */
  async function replyDraft(originalId: string, headers: { name: string; value: string }[]) {
    try {
      const body = headers.length ? { message: { internetMessageHeaders: headers } } : {};
      return await graph<GraphMessage>("POST", `${box}/messages/${enc(originalId)}/createReply`, { json: body });
    } catch (error) {
      if (isStatus(error, 400, 404)) return null; // malformed (not a Graph id) or deleted
      throw error;
    }
  }

  async function findByRfcId(rfcMessageId: string) {
    const filter = `internetMessageId eq '${rfcMessageId.replace(/'/g, "''")}'`;
    const { value } = await graph<{ value: { id: string }[] }>(
      "GET",
      `${box}/messages?$filter=${enc(filter)}&$select=id&$top=1`
    );
    return value[0]?.id ?? null;
  }

  async function attach(draftId: string, file: OutboundAttachment) {
    const path = `${box}/messages/${enc(draftId)}/attachments`;
    const size = file.content.byteLength;
    if (size < INLINE_ATTACHMENT_LIMIT) {
      await graph("POST", path, {
        json: {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: file.filename,
          contentType: file.contentType,
          contentBytes: base64Encode(file.content),
        },
      });
      return;
    }
    const { uploadUrl } = await graph<{ uploadUrl: string }>("POST", `${path}/createUploadSession`, {
      json: { AttachmentItem: { attachmentType: "file", name: file.filename, size, contentType: file.contentType } },
    });
    for (let offset = 0; offset < size; offset += UPLOAD_CHUNK) {
      const chunk = file.content.subarray(offset, offset + UPLOAD_CHUNK);
      // The upload URL is pre-authenticated; Graph rejects an Authorization header here.
      const res = await call(
        uploadUrl,
        {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            "content-range": `bytes ${offset}-${offset + chunk.byteLength - 1}/${size}`,
          },
          body: chunk as unknown as ArrayBuffer,
        },
        "attachment upload"
      );
      if (!res.ok) throw await graphError(res, `upload of ${file.filename}`);
    }
  }

  return {
    id: options.id,
    kind: "email",
    identityKind: "email",
    address: mailbox,
    capabilities: {
      subject: true,
      // Exchange Online's default send limit is 35 MB per message after MIME encoding (~25 MB of files).
      attachments: { maxBytes: 25_000_000, maxCount: 20 },
      maxTextLength: null,
      conversation: "thread",
      replyWindowHours: null,
      // Graph only confirms that it accepted the message; bounces arrive later as Inbox mail.
      deliveryReceipts: false,
      canStartConversation: true,
    },

    async webhook(request) {
      const validationToken = new URL(request.url).searchParams.get("validationToken");
      if (validationToken !== null) {
        // Subscription handshake (notification and lifecycle URLs): echo the decoded token as plain text.
        return {
          events: [],
          response: new Response(validationToken, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }),
        };
      }
      if (!clientState) throw new WebhookError("This channel isn't configured for notifications (no clientState).", 404);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new WebhookError("Expected a JSON change notification.", 400);
      }
      const notifications = (body as { value?: unknown }).value;
      if (!Array.isArray(notifications)) throw new WebhookError("Expected a JSON change notification.", 400);
      type Notification = {
        clientState?: string;
        changeType?: string;
        lifecycleEvent?: string;
        subscriptionId?: string;
        resourceData?: { id?: string };
      };
      const list = notifications as Notification[];
      if (!list.every((n) => typeof n.clientState === "string" && safeEqual(n.clientState, clientState))) {
        throw new WebhookError("clientState doesn't match.", 401);
      }
      const events: ChannelEvent[] = [];
      for (const n of list) {
        if (n.lifecycleEvent) {
          // Renewal, recreation and catch-up after "missed" happen in sync(). Reauthorizing here is
          // cheap and keeps notifications flowing until then.
          if (n.lifecycleEvent === "reauthorizationRequired" && n.subscriptionId) {
            await graph("POST", `/subscriptions/${enc(n.subscriptionId)}/reauthorize`).catch(() => {});
          }
          continue;
        }
        if (n.changeType !== "created" || !n.resourceData?.id) continue;
        const m = await getMessage(n.resourceData.id);
        if (m && !m.isDraft) events.push({ type: "message", message: await toInbound(m, "inbound") });
      }
      return { events };
    },

    async sync(prev) {
      const state = (prev ?? {}) as Partial<SyncState>;
      const now = Date.now();
      const since = state.since ?? new Date(now).toISOString();
      // After an expired delta token, sweep again from shortly before the last good run.
      const resumeFrom = new Date(Math.max(Date.parse(since), Date.parse(state.syncedAt ?? since) - 10 * 60_000)).toISOString();
      const events: ChannelEvent[] = [];
      const inbox = await syncFolder("inbox", "inbound", state.inbox, since, resumeFrom, events);
      const sent = await syncFolder("sentitems", "outbound", state.sent, since, resumeFrom, events);
      const next: SyncState = { since, syncedAt: new Date(now).toISOString(), inbox, sent };
      if (notificationUrl) Object.assign(next, await ensureSubscription(state.subscription, now));
      return { events, state: next as unknown as ChannelState };
    },

    /**
     * Builds a draft, then sends it: a reply draft (createReply) when the message we answer is in the
     * mailbox, which sets In-Reply-To/References and keeps the Outlook conversation; otherwise a new
     * draft. Drafts rather than sendMail because sendMail returns nothing, while a draft gives us its
     * immutable id (providerMessageId), conversationId and internetMessageId before sending.
     */
    async send(message) {
      const headers = outboundHeaders(message.headers);
      const content = {
        subject: message.subject ?? "",
        body: message.html ? { contentType: "html", content: message.html } : { contentType: "text", content: message.text },
        toRecipients: toRecipients(message.to),
        ccRecipients: toRecipients(message.cc ?? []),
        ...(message.replyTo ? { replyTo: toRecipients([message.replyTo]) } : {}),
        singleValueExtendedProperties: [{ id: SENT_BY_TENDKIT, value: message.id }],
      };
      let draft = message.replyToProviderMessageId ? await replyDraft(message.replyToProviderMessageId, headers) : null;
      if (!draft && message.inReplyTo) {
        const originalId = await findByRfcId(message.inReplyTo);
        if (originalId) draft = await replyDraft(originalId, headers);
      }
      const isReply = Boolean(draft);
      draft ??= await graph<GraphMessage>("POST", `${box}/messages`, {
        json: { ...content, ...(headers.length ? { internetMessageHeaders: headers } : {}) },
      });
      const path = `${box}/messages/${enc(draft.id)}`;
      try {
        // PATCH replaces the reply draft's quoted body: the core sends only the new text.
        if (isReply) draft = await graph<GraphMessage>("PATCH", path, { json: content });
        for (const file of message.attachments ?? []) await attach(draft.id, file);
        await graph("POST", `${path}/send`);
      } catch (error) {
        await graph("DELETE", path).catch(() => {});
        throw error;
      }
      return {
        providerMessageId: draft.id,
        // Exchange assigns the Message-ID when the draft is created and keeps it on send.
        rfcMessageId: draft.internetMessageId ?? null,
        providerThreadId: draft.conversationId ?? null,
      };
    },
  };
}

function toAddress(r?: Recipient | null): Address | null {
  const address = r?.emailAddress?.address;
  return address ? { address, name: r.emailAddress?.name || null } : null;
}

function toAddresses(list?: Recipient[]): Address[] {
  return (list ?? []).map(toAddress).filter((a): a is Address => a !== null);
}

function toRecipients(list: Address[]) {
  return list.map((a) => ({ emailAddress: { address: a.address, ...(a.name ? { name: a.name } : {}) } }));
}

/** Graph JSON accepts only "x-" headers; Auto-Submitted becomes Exchange's X-Auto-Response-Suppress. */
function outboundHeaders(input: Record<string, string> = {}) {
  const entries = Object.entries(input);
  const headers = entries.filter(([name]) => /^x-/i.test(name)).map(([name, value]) => ({ name, value }));
  const auto = entries.find(([name]) => name.toLowerCase() === "auto-submitted")?.[1];
  if (auto && !/^no\b/i.test(auto) && !headers.some((h) => h.name.toLowerCase() === "x-auto-response-suppress")) {
    headers.push({ name: "X-Auto-Response-Suppress", value: "All" });
  }
  return headers;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
