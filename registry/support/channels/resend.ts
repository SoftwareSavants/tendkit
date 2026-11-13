import {
  ChannelError,
  WebhookError,
  type Channel,
  type ChannelEvent,
  type InboundAttachment,
  type OutboundMessage,
} from "../channel";
import type { Address, DeliveryStatus } from "../types";
import { base64Encode, verifyStandardWebhook } from "./crypto";

export type ResendChannelConfig = {
  id: string;
  /** A full access key: reading received mail needs more than a sending-only key. */
  apiKey: string;
  /** The webhook's signing secret, "whsec_…". */
  webhookSecret: string;
  /** What customers write to and what replies are sent from, such as "support@acme.com". */
  address: string;
  /** An address on your Resend receiving domain, such as "support@in.acme.com". */
  replyAddress: string;
  /**
   * Only accept inbound mail addressed to these domains. Resend webhooks are account-wide, so set
   * this when several products share one Resend account. Unset, all received mail is accepted.
   */
  receivingDomains?: string[];
  fetch?: typeof fetch;
  baseUrl?: string;
};

/**
 * Email through Resend: sending with the Emails API, receiving with Resend Receiving.
 *
 * Setup:
 * 1. Verify your sending domain (acme.com) in Resend.
 * 2. Add a receiving domain such as in.acme.com (its MX pointing at Resend) and use an address on
 *    it as `replyAddress`. To keep your existing mailbox on acme.com, forward or Bcc a copy of
 *    support@acme.com to support@in.acme.com.
 * 3. Create a full access API key.
 * 4. Add a webhook pointing at your support webhook route for this channel id, with the events
 *    email.received, email.sent, email.delivered, email.bounced, email.failed, email.suppressed
 *    and email.complained, and pass its signing secret as `webhookSecret`.
 */
export function resendChannel(config: ResendChannelConfig): Channel {
  const baseUrl = (config.baseUrl ?? "https://api.resend.com").replace(/\/$/, "");
  const fetchFn = config.fetch ?? ((input, init) => fetch(input, init));
  const domains = config.receivingDomains?.map((d) => d.toLowerCase());

  async function call<T>(path: string, action: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          // Resend rejects requests without one, and Workers' fetch doesn't add it.
          "User-Agent": "tendkit",
          ...init.headers,
        },
      });
    } catch {
      throw new ChannelError("Couldn't reach Resend. Try again in a moment.", true);
    }
    if (!res.ok) throw await resendError(res, action);
    return (await res.json()) as T;
  }

  async function download(url: string): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await fetchFn(url);
    } catch {
      throw new ChannelError("Couldn't download the attachment from Resend.", true);
    }
    if (!res.ok) throw new ChannelError(`Resend couldn't provide the attachment (HTTP ${res.status}).`, res.status >= 500, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function received(data: ReceivedEvent): Promise<ChannelEvent[]> {
    if (domains) {
      const recipients = [...(data.to ?? []), ...(data.cc ?? []), ...(data.bcc ?? []), ...(data.received_for ?? [])];
      const ours = recipients.some((r) => domains.includes(domainOf(parseAddress(r).address)));
      if (!ours) return [];
    }
    const id = data.email_id;
    const email = await call<ReceivedEmail>(
      `/emails/receiving/${encodeURIComponent(id)}?html_format=cid`,
      "load the received email"
    );
    const headers = lowerCaseKeys(email.headers ?? {});
    // The API's header map may leave out the threading and auto-reply headers we need, so read
    // the header block of the original message too. Its values stay encoded, hence API first.
    if (email.raw?.download_url) {
      Object.assign(headers, { ...(await readRawHeaders(fetchFn, email.raw.download_url)), ...headers });
    }
    const attachments: InboundAttachment[] = (email.attachments ?? data.attachments ?? []).map((a) => ({
      filename: a.filename || "attachment",
      contentType: a.content_type || "application/octet-stream",
      size: a.size ?? null,
      contentId: a.content_id?.replace(/^<|>$/g, "") || null,
      inline: a.content_disposition === "inline",
      async read() {
        const file = await call<{ download_url: string }>(
          `/emails/receiving/${encodeURIComponent(id)}/attachments/${encodeURIComponent(a.id)}`,
          "load the attachment"
        );
        return download(file.download_url);
      },
    }));
    return [
      {
        type: "message",
        message: {
          providerMessageId: id,
          from: parseAddress(headers.from ?? email.from ?? data.from),
          to: (email.to ?? data.to ?? []).map(parseAddress),
          cc: (email.cc ?? data.cc ?? []).map(parseAddress),
          subject: email.subject ?? data.subject ?? null,
          text: email.text ?? null,
          html: email.html ?? null,
          headers,
          rfcMessageId: email.message_id ?? data.message_id ?? headers["message-id"] ?? null,
          inReplyTo: messageIds(headers["in-reply-to"])[0] ?? null,
          references: messageIds(headers.references),
          receivedAt: parseDate(email.created_at ?? data.created_at),
          attachments,
        },
      },
    ];
  }

  return {
    id: config.id,
    kind: "email",
    identityKind: "email",
    address: config.address,
    replyAddress: config.replyAddress,
    capabilities: {
      subject: true,
      // Resend caps the whole email at 40 MB after base64, which inflates attachments by 4/3.
      // It documents no count limit; 50 keeps a single reply sane.
      attachments: { maxBytes: 28_000_000, maxCount: 50 },
      maxTextLength: null,
      conversation: "thread",
      replyWindowHours: null,
      deliveryReceipts: true,
      canStartConversation: true,
    },

    async webhook(request) {
      const body = await request.text();
      if (!(await verifyStandardWebhook(config.webhookSecret, request.headers, body))) {
        throw new WebhookError("Invalid Resend webhook signature");
      }
      let event: ResendEvent;
      try {
        event = JSON.parse(body);
      } catch {
        throw new WebhookError("Malformed Resend webhook payload", 400);
      }
      if (event.type === "email.received") return { events: await received(event.data as ReceivedEvent) };
      const status = statusEvent(event);
      return { events: status ? [status] : [] };
    },

    async send(message) {
      const headers: Record<string, string> = { ...message.headers };
      if (message.inReplyTo) headers["In-Reply-To"] = message.inReplyTo;
      if (message.references?.length) headers["References"] = message.references.join(" ");
      const result = await call<{ id: string }>("/emails", "send the email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": message.id },
        body: JSON.stringify({
          from: formatAddress({ address: config.address, name: message.fromName }),
          to: message.to.map(formatAddress),
          ...(message.cc?.length ? { cc: message.cc.map(formatAddress) } : {}),
          ...(message.replyTo ? { reply_to: formatAddress(message.replyTo) } : {}),
          subject: message.subject?.trim() || "(no subject)",
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.attachments?.length ? { attachments: message.attachments.map(attachment) } : {}),
          ...(Object.keys(headers).length ? { headers } : {}),
        }),
      });
      return { providerMessageId: result.id, rfcMessageId: await sentMessageId(result.id), status: "sent" };
    },
  };

  /**
   * The Message-ID Resend assigned, so customer replies thread by header. Status events can't
   * carry it, so it's read back once; replies still thread by the reply address without it.
   */
  async function sentMessageId(id: string): Promise<string | null> {
    try {
      const email = await call<{ message_id?: string | null }>(`/emails/${encodeURIComponent(id)}`, "load the sent email");
      return email.message_id ?? null;
    } catch {
      return null;
    }
  }
}

function statusEvent(event: ResendEvent): ChannelEvent | null {
  const data = event.data as StatusEventData;
  const mapped = ((): { status: DeliveryStatus; error?: string } | null => {
    switch (event.type) {
      case "email.sent":
        return { status: "sent" };
      case "email.delivered":
        return { status: "delivered" };
      case "email.bounced":
        return { status: "failed", error: bounceReason(data.bounce) };
      case "email.failed":
        return { status: "failed", error: failureReason(data.failed?.reason) };
      case "email.suppressed":
        return {
          status: "failed",
          error: "Not sent: the recipient is on Resend's suppression list after earlier bounces or complaints.",
        };
      case "email.complained":
        return { status: "failed", error: "Marked as spam by the recipient" };
      default:
        return null;
    }
  })();
  if (!mapped || !data?.email_id) return null;
  return {
    type: "status",
    providerMessageId: data.email_id,
    status: mapped.status,
    error: mapped.error ?? null,
    rfcMessageId: data.message_id ?? null,
    at: parseDate(event.created_at ?? data.created_at),
  };
}

function bounceReason(bounce: StatusEventData["bounce"]): string {
  const kind = bounce?.type === "Transient" ? "The email bounced temporarily" : "The email bounced";
  return bounce?.message ? `${kind}: ${bounce.message}` : `${kind}.`;
}

function failureReason(reason: string | undefined): string {
  if (reason === "reached_daily_quota") return "Not sent: the Resend daily sending quota is used up.";
  return reason ? `Resend couldn't send the email (${reason.replace(/_/g, " ")}).` : "Resend couldn't send the email.";
}

async function resendError(res: Response, action: string): Promise<ChannelError> {
  let body: { name?: string; message?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Not JSON; the status says enough.
  }
  const detail = body.message?.trim().replace(/\.$/, "") || `HTTP ${res.status}`;
  const fail = (message: string, retryable = false) => new ChannelError(message, retryable, res.status);
  switch (body.name) {
    case "rate_limit_exceeded":
    case "concurrent_idempotent_requests":
      return fail("Resend is busy with too many requests. Try again in a moment.", true);
    case "daily_quota_exceeded":
      return fail("The Resend daily sending quota is used up. It resets at midnight UTC.");
    case "monthly_quota_exceeded":
      return fail("The Resend monthly sending quota is used up.");
    case "missing_api_key":
      return fail("The Resend API key is missing.");
    case "restricted_api_key":
      return fail(`Resend refused the API key: ${detail}. Receiving mail needs a full access key.`);
    case "email_above_quota":
      return fail("Resend received this email while over quota and won't release its content.");
  }
  if (res.status === 401) return fail(`Resend refused the API key: ${detail}.`);
  if (res.status === 429 || res.status >= 500) return fail(`Resend is having trouble (${detail}). Try again in a moment.`, true);
  return fail(`Resend couldn't ${action}: ${detail}.`);
}

/** Reads only the header block of a raw message, so a large email isn't downloaded whole. */
async function readRawHeaders(fetchFn: typeof fetch, url: string): Promise<Record<string, string>> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    return {};
  }
  if (!res.ok || !res.body) return {};
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    const end = text.search(/\r?\n\r?\n/);
    if (end !== -1 || text.length > 512_000) {
      if (end !== -1) text = text.slice(0, end);
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return parseHeaderBlock(text);
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    // The first occurrence is the newest (Received) or the only one that counts.
    headers[name] ??= line.slice(colon + 1).trim();
  }
  return headers;
}

/** "Emma <m@example.com>", "\"Doe, J\" <j@example.com>" or "j@example.com". */
function parseAddress(value: string): Address {
  const match = /^(.*)<([^<>]+)>\s*$/.exec(value.trim());
  if (!match) return { address: value.trim(), name: null };
  const name = match[1]!.trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
  return { address: match[2]!.trim(), name: name || null };
}

function formatAddress({ address, name }: Address): string {
  const clean = name?.replace(/[\r\n]+/g, " ").trim();
  if (!clean) return address;
  return /[()<>[\]:;@\\,."]/.test(clean) ? `"${clean.replace(/[\\"]/g, "\\$&")}" <${address}>` : `${clean} <${address}>`;
}

function attachment(file: NonNullable<OutboundMessage["attachments"]>[number]) {
  return { filename: file.filename, content: base64Encode(file.content), content_type: file.contentType };
}

const messageIds = (value: string | undefined) => value?.match(/<[^<>\s]+>/g) ?? [];

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

const lowerCaseKeys = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

/** Resend mixes ISO timestamps with Postgres ones ("2026-04-03 22:13:42.674981+00"). */
function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const date = new Date(value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

type ResendEvent = { type: string; created_at?: string; data: unknown };

type ResendAttachment = {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  content_id?: string | null;
  size?: number | null;
};

type ReceivedEvent = {
  email_id: string;
  created_at?: string;
  from: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  received_for?: string[];
  message_id?: string | null;
  subject?: string | null;
  attachments?: ResendAttachment[];
};

type ReceivedEmail = {
  id: string;
  created_at?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string> | null;
  message_id?: string | null;
  raw?: { download_url: string; expires_at: string } | null;
  attachments?: ResendAttachment[];
};

type StatusEventData = {
  email_id?: string;
  message_id?: string | null;
  created_at?: string;
  bounce?: { type?: string; subType?: string; message?: string };
  failed?: { reason?: string };
};
