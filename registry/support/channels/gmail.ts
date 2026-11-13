import { ChannelError, WebhookError, type Channel, type ChannelEvent, type ChannelState, type OutboundMessage } from "../channel";
import { base64Decode, base64UrlEncode, utf8 } from "./crypto";
import { buildRawEmail, parseRawEmail } from "./mime";

export type GmailAuth =
  | { serviceAccount: { clientEmail: string; privateKey: string; privateKeyId?: string } }
  | { oauth: { clientId: string; clientSecret: string; refreshToken: string } };

export type GmailChannelOptions = {
  id: string;
  /** The mailbox customers write to, such as "support@acme.com". */
  mailbox: string;
  replyAddress?: string;
  auth: GmailAuth;
  /** Push notifications through Cloud Pub/Sub. Without it the inbox is polled by `sync` only. */
  pubsub?: {
    /** "projects/<project>/topics/<topic>", in the same Cloud project as the credentials. */
    topic: string;
    /** The push subscription's authentication audience. Defaults to the webhook URL, Pub/Sub's own default. */
    audience?: string;
    /** The push subscription's service account. When set, push requests must carry its OIDC token. */
    serviceAccountEmail?: string;
  };
  fetch?: typeof fetch;
  baseUrl?: string;
};

type GmailState = {
  historyId: string;
  /** ms since epoch: when the last sync finished, for recovery when the history id expires. */
  syncedAt: number;
  watchRenewedAt?: number;
  watchError?: string | null;
};

const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Messages fetched per sync; the rest wait for the next run. */
const MAX_MESSAGES_PER_SYNC = 100;
/** Workers allow 6 open connections per request; keep room for the database. */
const FETCH_CONCURRENCY = 4;
/** Above this the message goes through the media upload endpoint instead of a JSON body. */
const JSON_SEND_LIMIT = 4 * 1024 * 1024;

/**
 * A Gmail or Google Workspace mailbox through the Gmail API: mail to the mailbox opens tickets,
 * replies go out from it, and replies your team writes in Gmail show up on the ticket.
 *
 * Setup, Google Workspace (recommended):
 * 1. In Google Cloud, enable the Gmail API and create a service account with a JSON key.
 * 2. Admin console → Security → API controls → Domain-wide delegation: add the service account's
 *    client ID with scope `https://www.googleapis.com/auth/gmail.modify` (can take up to 24 h).
 * 3. Pass `auth: { serviceAccount: { clientEmail, privateKey } }` from the key file.
 *
 * Setup, a single Gmail account: create an OAuth client, run the consent flow once with
 * `access_type=offline&prompt=consent` and scope gmail.modify, and pass `auth: { oauth: … }`
 * with the refresh token. Refresh tokens of apps in "Testing" expire after 7 days.
 *
 * Then run `runScheduled()` every few minutes: it polls the mailbox history and renews the watch.
 *
 * Optional push, for replies within seconds:
 * 1. Create a Pub/Sub topic and grant `gmail-api-push@system.gserviceaccount.com` the Publisher role on it.
 * 2. Create a push subscription to `https://<your app>/…/webhooks/<id>` with authentication
 *    enabled; pass its service account (and audience, if you set one) as `pubsub`.
 * 3. Pass `pubsub.topic`; `sync` calls `users.watch` once a day (Google requires every 7 days).
 */
export function gmailChannel(options: GmailChannelOptions): Channel {
  const f = options.fetch ?? fetch;
  const base = `${(options.baseUrl ?? "https://gmail.googleapis.com").replace(/\/$/, "")}/gmail/v1/users/${encodeURIComponent(options.mailbox)}`;
  const uploadBase = base.replace("/gmail/v1/", "/upload/gmail/v1/");
  let token: { value: string; expiresAt: number } | null = null;
  /** The history id of the last sync in this process, which a push notification fetches from. */
  let lastHistoryId: string | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const body =
      "serviceAccount" in options.auth
        ? new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: await serviceAccountAssertion(options.auth.serviceAccount, options.mailbox),
          })
        : new URLSearchParams({
            grant_type: "refresh_token",
            client_id: options.auth.oauth.clientId,
            client_secret: options.auth.oauth.clientSecret,
            refresh_token: options.auth.oauth.refreshToken,
          });
    const res = await f(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (!res.ok) throw await failure("Google sign-in", res);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return token.value;
  }

  async function api<T>(path: string, init: RequestInit = {}, url = `${base}${path}`): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await f(url, {
        ...init,
        headers: { authorization: `Bearer ${await accessToken()}`, "user-agent": "tendkit", ...init.headers },
      });
      if (res.status === 401 && attempt === 0) {
        token = null;
        continue;
      }
      if (!res.ok) throw await failure("Gmail", res);
      return (await res.json()) as T;
    }
  }

  async function fetchMessage(id: string): Promise<ChannelEvent | null> {
    let message: { id: string; threadId: string; labelIds?: string[]; internalDate?: string; raw: string };
    try {
      message = await api(`/messages/${id}?format=raw`);
    } catch (error) {
      if (error instanceof ChannelError && error.status === 404) return null; // deleted since
      throw error;
    }
    const labels = message.labelIds ?? [];
    const direction = labels.includes("SENT") ? "outbound" : labels.includes("INBOX") ? "inbound" : null;
    if (!direction) return null; // drafts, spam, archived-by-filter
    const parsed = await parseRawEmail(base64Decode(message.raw), {
      providerMessageId: message.id,
      receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : undefined,
    });
    return { type: "message", message: { ...parsed, direction, providerThreadId: message.threadId } };
  }

  /** Message ids added since `startHistoryId`, oldest first, and the history id to continue from. */
  async function historySince(startHistoryId: string) {
    const ids: string[] = [];
    let next = startHistoryId;
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await api<{
        history?: { id: string; messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
        historyId: string;
        nextPageToken?: string;
      }>(`/history?${query}`);
      for (const record of page.history ?? []) {
        for (const { message } of record.messagesAdded ?? []) {
          // Skip drafts (every autosave adds one) and mail filtered past the inbox; fetchMessage re-checks.
          const labels = message.labelIds;
          const wanted = !labels || (!labels.includes("DRAFT") && (labels.includes("INBOX") || labels.includes("SENT")));
          if (wanted && !ids.includes(message.id)) ids.push(message.id);
        }
        if (ids.length >= MAX_MESSAGES_PER_SYNC) return { ids, historyId: record.id };
      }
      next = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { ids, historyId: next };
  }

  async function fetchAll(ids: string[]) {
    const events: (ChannelEvent | null)[] = new Array(ids.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const i = cursor++;
        events[i] = await fetchMessage(ids[i]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) }, worker));
    return events.filter((e): e is ChannelEvent => e !== null);
  }

  async function currentHistoryId() {
    return (await api<{ historyId: string }>("/profile")).historyId;
  }

  return {
    id: options.id,
    kind: "email",
    identityKind: "email",
    address: options.mailbox,
    replyAddress: options.replyAddress,
    capabilities: {
      subject: true,
      attachments: { maxBytes: 25 * 1024 * 1024, maxCount: 20 },
      maxTextLength: null,
      conversation: "thread",
      replyWindowHours: null,
      deliveryReceipts: false,
      canStartConversation: true,
    },

    async sync(previous) {
      const state = previous as GmailState | null;
      const now = Date.now();
      let events: ChannelEvent[] = [];
      let historyId: string;
      if (!state?.historyId) {
        // First run: start from now rather than importing the whole mailbox.
        historyId = await currentHistoryId();
      } else {
        try {
          const history = await historySince(state.historyId);
          events = await fetchAll(history.ids);
          historyId = history.historyId;
        } catch (error) {
          if (!(error instanceof ChannelError && error.status === 404)) throw error;
          // The history id expired (usually after a week, sometimes hours): list what arrived since
          // the last sync instead. Ingestion is idempotent, so overlap is harmless.
          historyId = await currentHistoryId();
          const since = Math.floor((state.syncedAt ?? now - DAY_MS) / 1000) - 60;
          const query = new URLSearchParams({ q: `after:${since}`, maxResults: String(MAX_MESSAGES_PER_SYNC) });
          const list = await api<{ messages?: { id: string }[] }>(`/messages?${query}`);
          events = await fetchAll((list.messages ?? []).map((m) => m.id).reverse());
        }
      }
      const next: GmailState = { historyId, syncedAt: now, watchRenewedAt: state?.watchRenewedAt, watchError: state?.watchError ?? null };
      if (options.pubsub && (!state?.watchRenewedAt || now - state.watchRenewedAt > DAY_MS)) {
        try {
          await api("/watch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ topicName: options.pubsub.topic, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "INCLUDE" }),
          });
          next.watchRenewedAt = now;
          next.watchError = null;
        } catch (error) {
          // Polling still works without push; keep syncing and surface the reason in the state.
          next.watchError = String(error);
        }
      }
      lastHistoryId = historyId;
      return { events, state: next as ChannelState };
    },

    async webhook(request) {
      if (options.pubsub?.serviceAccountEmail) {
        const ok = await verifyPubSubToken(request.headers.get("authorization"), {
          audience: options.pubsub.audience ?? request.url,
          serviceAccountEmail: options.pubsub.serviceAccountEmail,
          fetch: f,
        });
        if (!ok) throw new WebhookError("Invalid Pub/Sub token");
      }
      let notification: { emailAddress?: string; historyId?: string | number };
      try {
        const body = (await request.json()) as { message?: { data?: string } };
        notification = JSON.parse(new TextDecoder().decode(base64Decode(body.message?.data ?? "")));
      } catch {
        throw new WebhookError("Not a Pub/Sub push", 400);
      }
      if (notification.emailAddress?.toLowerCase() !== options.mailbox.toLowerCase()) return { events: [] };
      // A notification only says "something changed, the mailbox is now at historyId N"; history.list
      // returns changes *after* a start id, so N itself yields nothing, and history ids are not dense
      // enough to subtract a safe margin. The webhook has no access to the stored sync state, so it
      // reads from the history id this process last synced to, when it has one (long-lived servers),
      // and otherwise answers 200 and leaves it to the next scheduled sync (Workers isolates, cold
      // starts). The stored state is never advanced here, so a webhook can't skip mail: at worst
      // the next sync re-reads messages that ingestion then drops as duplicates.
      if (!lastHistoryId) return { events: [] };
      const history = await historySince(lastHistoryId);
      return { events: await fetchAll(history.ids) };
    },

    async send(message) {
      const { raw, messageId } = buildRawEmail({
        from: { address: options.mailbox, name: message.fromName },
        to: message.to,
        cc: message.cc,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
        messageId: message.rfcMessageId,
        inReplyTo: message.inReplyTo,
        references: message.references,
        headers: message.headers,
      });
      const sent = await sendRaw(message, raw);
      // Gmail keeps a Message-ID the sender sets; read it back so threading never relies on that.
      let rfcMessageId = messageId;
      try {
        const meta = await api<{ payload?: { headers?: { name: string; value: string }[] } }>(
          `/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`
        );
        rfcMessageId = meta.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? messageId;
      } catch {
        // The message is sent; the id we set is the best answer.
      }
      return { providerMessageId: sent.id, providerThreadId: sent.threadId, rfcMessageId, status: "sent" };
    },
  };

  function sendRaw(message: OutboundMessage, raw: string) {
    const threadId = message.providerThreadId ?? undefined;
    if (raw.length <= JSON_SEND_LIMIT) {
      return api<{ id: string; threadId: string }>("/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw: base64UrlEncode(utf8(raw)), threadId }),
      });
    }
    const boundary = `tendkit_${crypto.randomUUID()}`;
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({ threadId }),
      `--${boundary}`,
      "Content-Type: message/rfc822",
      "",
      raw,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    return api<{ id: string; threadId: string }>(
      "",
      { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body },
      `${uploadBase}/messages/send?uploadType=multipart`
    );
  }
}

async function failure(what: string, res: Response) {
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  const retryable = res.status === 429 || res.status >= 500;
  return new ChannelError(`${what} answered ${res.status}${detail ? `: ${detail}` : ""}`, retryable, res.status);
}

// ------------------------------------------------------------------------------------- JWTs

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** The signed JWT a service account exchanges for an access token, impersonating `subject`. */
export async function serviceAccountAssertion(
  account: { clientEmail: string; privateKey: string; privateKeyId?: string },
  subject: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
  const der = base64Decode(account.privateKey.replace(/-----[^-]+-----/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der as unknown as ArrayBuffer, RS256, false, ["sign"]);
  const header = { alg: "RS256", typ: "JWT", ...(account.privateKeyId ? { kid: account.privateKeyId } : {}) };
  const claims = { iss: account.clientEmail, sub: subject, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 };
  const input = `${base64UrlEncode(utf8(JSON.stringify(header)))}.${base64UrlEncode(utf8(JSON.stringify(claims)))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(RS256, key, utf8(input) as unknown as ArrayBuffer));
  return `${input}.${base64UrlEncode(signature)}`;
}

type Jwks = { keys: (Parameters<typeof crypto.subtle.importKey>[1] & { kid?: string })[] };
let certs: { jwks: Jwks; expiresAt: number; fetchedAt: number } | null = null;

async function googleCerts(f: typeof fetch, refresh: boolean): Promise<Jwks> {
  const now = Date.now();
  // A forced refresh (unknown kid) happens at most once a minute, so bad tokens can't hammer Google.
  if (certs && (refresh ? now - certs.fetchedAt < 60_000 : certs.expiresAt > now)) return certs.jwks;
  const res = await f(CERTS_URL);
  if (!res.ok) throw new ChannelError(`Google certificates answered ${res.status}`, true, res.status);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  certs = { jwks: (await res.json()) as Jwks, expiresAt: now + maxAge * 1000, fetchedAt: now };
  return certs.jwks;
}

/**
 * Verifies the OIDC token on an authenticated Pub/Sub push: RS256 signature against Google's
 * certificates, issuer, audience, expiry and the push service account's verified email.
 */
export async function verifyPubSubToken(
  authorization: string | null,
  expected: { audience: string; serviceAccountEmail: string; fetch?: typeof fetch; nowSeconds?: number }
): Promise<boolean> {
  const parts = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(authorization ?? "");
  if (!parts) return false;
  const [, h, c, s] = parts as unknown as [string, string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean | string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64Decode(h)));
    claims = JSON.parse(new TextDecoder().decode(base64Decode(c)));
  } catch {
    return false;
  }
  if (header.alg !== "RS256" || !header.kid) return false;
  const f = expected.fetch ?? fetch;
  let jwk = (await googleCerts(f, false)).keys.find((k) => k.kid === header.kid);
  jwk ??= (await googleCerts(f, true)).keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey("jwk", { ...jwk, alg: "RS256" }, RS256, false, ["verify"]);
  const valid = await crypto.subtle.verify(RS256, key, base64Decode(s) as unknown as ArrayBuffer, utf8(`${h}.${c}`) as unknown as ArrayBuffer);
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  return (
    valid &&
    (claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com") &&
    claims.aud === expected.audience &&
    typeof claims.exp === "number" &&
    claims.exp > now &&
    claims.email === expected.serviceAccountEmail &&
    String(claims.email_verified) === "true"
  );
}
