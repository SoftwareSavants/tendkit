import { WebhookError, type Channel, type ChannelCapabilities, type OutboundMessage, type SendResult } from "../channel";
import { base64Decode, signStandardWebhook, verifyStandardWebhook } from "./crypto";

/** What your app posts to the channel's webhook route. */
export type ApiMessage = {
  /** Your id for the submission; resending the same id is a no-op. */
  id: string;
  from: { email: string; name?: string | null };
  subject?: string | null;
  text: string;
  html?: string | null;
  attachments?: { filename: string; contentType: string; contentBase64: string }[];
  /** ISO 8601; defaults to when the request arrives. */
  receivedAt?: string;
};

export type ApiChannelConfig = {
  id: string;
  /** "whsec_" + base64 of 24–64 random bytes, shared with the app that signs requests. */
  secret: string;
  /** Shown as where the ticket came from, such as "Contact form". */
  address: string;
  /**
   * "email" when replies go out by email (through `deliver`): replies then get a subject, HTML,
   * acknowledgements and, with `replyAddress`, a reply address that threads the customer's answer.
   */
  kind?: "api" | "email";
  /** The email channel's receiving address, so customer replies land back in the same ticket. */
  replyAddress?: string;
  /** Sends replies. Most apps pass their email channel's send: `(m) => resend.send(m)`. */
  deliver(message: OutboundMessage): Promise<SendResult>;
  /** Usually the delivering channel's capabilities. */
  capabilities?: Partial<ChannelCapabilities>;
};

/**
 * Creates tickets from your own forms or backends: POST a signed JSON `ApiMessage` to the support
 * webhook route for this channel id. Sign on your server with `signApiRequest`, never in a browser.
 *
 * Setup:
 * 1. Generate a secret: "whsec_" + base64 of 32 random bytes. Keep it server-side.
 * 2. Configure `apiChannel({ id: "contact-form", secret, address: "Contact form", kind: "email",
 *    replyAddress: "support@in.acme.com", deliver: (m) => resend.send(m) })`.
 * 3. From your backend: `const body = JSON.stringify(message)` and
 *    `fetch(url, { method: "POST", headers: await signApiRequest(secret, body), body })`.
 */
export function apiChannel(config: ApiChannelConfig): Channel {
  return {
    id: config.id,
    kind: config.kind ?? "api",
    identityKind: "email",
    address: config.address,
    replyAddress: config.replyAddress,
    capabilities: {
      subject: true,
      attachments: { maxBytes: 10_000_000, maxCount: 10 },
      maxTextLength: null,
      conversation: "thread",
      replyWindowHours: null,
      ...config.capabilities,
      // Receipts for delivered replies reach the delivering channel's webhook, not this channel.
      deliveryReceipts: false,
      // It only receives: replies go out on the delivering channel.
      canStartConversation: false,
    },

    async webhook(request) {
      const body = await request.text();
      if (!(await verifyStandardWebhook(config.secret, request.headers, body))) {
        throw new WebhookError("Invalid signature");
      }
      const message = parseMessage(body);
      return {
        events: [
          {
            type: "message",
            message: {
              providerMessageId: message.id,
              // Anyone can type any address into a form: never link it to that account or auto-reply.
              source: "api",
              from: { address: message.from.email.trim(), name: message.from.name?.trim() || null },
              to: [{ address: config.address }],
              subject: message.subject ?? null,
              text: message.text,
              html: message.html ?? null,
              receivedAt: message.receivedAt ? new Date(message.receivedAt) : new Date(),
              attachments: (message.attachments ?? []).map((file) => {
                const bytes = decodeAttachment(file);
                return {
                  filename: file.filename,
                  contentType: file.contentType,
                  size: bytes.byteLength,
                  read: async () => bytes,
                };
              }),
            },
          },
        ],
      };
    },

    send: (message) => config.deliver(message),
  };
}

function parseMessage(body: string): ApiMessage {
  const invalid = (reason: string) => new WebhookError(`Invalid message: ${reason}`, 400);
  let value: ApiMessage;
  try {
    value = JSON.parse(body);
  } catch {
    throw invalid("the body isn't JSON");
  }
  const isString = (v: unknown) => typeof v === "string";
  if (!value || typeof value !== "object") throw invalid("expected a JSON object");
  if (!isString(value.id) || !value.id) throw invalid("`id` is required");
  if (!isString(value.from?.email) || !/^[^\s@]+@[^\s@]+$/.test(value.from.email.trim())) {
    throw invalid("`from.email` must be an email address");
  }
  if (!isString(value.text)) throw invalid("`text` is required");
  if (value.receivedAt !== undefined && Number.isNaN(new Date(value.receivedAt).getTime())) {
    throw invalid("`receivedAt` must be an ISO 8601 date");
  }
  for (const file of value.attachments ?? []) {
    if (!isString(file?.filename) || !isString(file.contentType) || !isString(file.contentBase64)) {
      throw invalid("each attachment needs `filename`, `contentType` and `contentBase64`");
    }
  }
  return value;
}

function decodeAttachment(file: NonNullable<ApiMessage["attachments"]>[number]): Uint8Array {
  try {
    return base64Decode(file.contentBase64);
  } catch {
    throw new WebhookError(`Invalid message: attachment "${file.filename}" isn't valid base64`, 400);
  }
}

/** Headers that sign `body` for an API channel. Send the body exactly as signed. */
export async function signApiRequest(secret: string, body: string): Promise<Record<string, string>> {
  const id = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": await signStandardWebhook(secret, id, timestamp, body),
  };
}
