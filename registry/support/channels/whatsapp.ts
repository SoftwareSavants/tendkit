import {
  ChannelError,
  WebhookError,
  type Channel,
  type ChannelEvent,
  type InboundAttachment,
  type OutboundAttachment,
  type SendResult,
} from "../channel";
import type { DeliveryStatus } from "../types";
import { hexDecode, hmac, verifyHmac } from "./crypto";

export type WhatsAppChannelOptions = {
  /** Stable channel id, stored on every ticket. */
  id: string;
  /** The business phone number's id (not the number itself), from WhatsApp Manager or the API setup page. */
  phoneNumberId: string;
  /** A System User access token with whatsapp_business_messaging and whatsapp_business_management. */
  accessToken: string;
  /** The Meta app's secret (App settings → Basic); signs webhook deliveries. */
  appSecret: string;
  /** Any string you choose; Meta echoes it back when you register the webhook. */
  verifyToken: string;
  /** The number customers write to, for display: "+1 415 555 0100". */
  displayNumber: string;
  apiVersion?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
};

/**
 * WhatsApp Business Cloud API, direct with Meta.
 *
 * Setup:
 * 1. Create a Meta app (type Business) with the WhatsApp product, and add your business number.
 * 2. Business settings → System users: create one, assign the app and the WhatsApp account, and
 *    generate a token with whatsapp_business_messaging + whatsapp_business_management.
 * 3. App → WhatsApp → Configuration: callback URL = your webhook route for this channel, verify
 *    token = `verifyToken`; subscribe to the "messages" field. Meta calls the URL with GET to verify.
 * 4. Add a payment method in Billing Hub: since October 2026 replies are charged per message after
 *    a monthly free tier, and Meta stops delivering them once the tier runs out without one.
 *
 * Behaviour:
 * - Replies are allowed for 24 hours after the customer's last message (error 131047 otherwise);
 *   templates for re-engaging aren't sent by this adapter.
 * - Customers are identified by phone number. Users who adopted a WhatsApp username may arrive with
 *   only a business-scoped user id ("US.1349…") and no phone; those messages are kept with the id
 *   as the address and replies go to it as `recipient`, but the id doesn't match an earlier
 *   phone-based contact, and `normalizeIdentity` treats it like a phone number.
 * - Reactions and system notices (number changes) are ignored: they aren't messages to answer and
 *   shouldn't reopen tickets. Other types we can't show arrive as a short placeholder text.
 */
export function whatsappChannel(options: WhatsAppChannelOptions): Channel {
  const doFetch = options.fetch ?? fetch;
  const graph = `${(options.baseUrl ?? "https://graph.facebook.com").replace(/\/$/, "")}/${options.apiVersion ?? "v27.0"}`;
  const bearer = { authorization: `Bearer ${options.accessToken}` };

  async function graphCall<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(`${graph}/${path}`, { ...init, headers: { ...bearer, ...init.headers } });
    const body = (await res.json().catch(() => ({}))) as T & { error?: MetaError };
    if (!res.ok || body.error) throw toChannelError(res.status, body.error);
    return body;
  }

  async function download(mediaId: string): Promise<Uint8Array> {
    // The media URL expires after 5 minutes, so it's resolved only when the bytes are needed.
    const { url } = await graphCall<{ url: string }>(`${mediaId}?phone_number_id=${options.phoneNumberId}`);
    let res = await doFetch(url, { headers: { ...bearer, "user-agent": "tendkit" }, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) res = await doFetch(new URL(location, url).toString());
    if (!res.ok) throw new ChannelError(`WhatsApp media download failed (${res.status})`, res.status >= 500, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  function toMessage(m: MetaMessage, contacts: MetaContact[]): ChannelEvent | null {
    const contact = contacts.find((c) => (m.from && c.wa_id === m.from) || (m.from_user_id && c.user_id === m.from_user_id));
    const address = m.from ? `+${m.from}` : m.from_user_id;
    if (!address) return null;
    let text: string | null = null;
    const attachments: InboundAttachment[] = [];
    const media = MEDIA_TYPES.includes(m.type) ? (m[m.type] as MetaMedia | undefined) : undefined;
    if (m.type === "reaction" || m.type === "system") return null;
    if (m.type === "text") text = m.text?.body ?? "";
    else if (media) {
      text = media.caption ?? null;
      const contentType = media.mime_type ?? "application/octet-stream";
      attachments.push({
        filename: media.filename ?? `${m.type}${extension(contentType)}`,
        contentType,
        size: media.file_size ?? null,
        read: () => download(media.id),
      });
    } else if (m.type === "interactive") {
      text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
    } else if (m.type === "button") text = m.button?.text ?? "";
    else if (m.type === "location" && m.location) {
      const { latitude, longitude, name, address: place } = m.location;
      text = [name, place, `https://maps.google.com/?q=${latitude},${longitude}`].filter(Boolean).join("\n");
    } else text = `(${m.type} message: open WhatsApp to see it)`;
    return {
      type: "message",
      message: {
        providerMessageId: m.id,
        from: { address, name: contact?.profile?.name ?? null },
        to: [{ address: options.displayNumber }],
        text,
        receivedAt: new Date(Number(m.timestamp) * 1000),
        attachments,
      },
    };
  }

  return {
    id: options.id,
    kind: "whatsapp",
    identityKind: "whatsapp",
    address: options.displayNumber,
    capabilities: {
      subject: false,
      // Images are capped at 5 MB, the smallest of WhatsApp's per-type limits.
      attachments: { maxBytes: 5_000_000, maxCount: 10 },
      maxTextLength: 4096,
      conversation: "contact",
      replyWindowHours: 24,
      deliveryReceipts: true,
      // Writing first needs an approved template, which this adapter doesn't send.
      canStartConversation: false,
    },

    async webhook(request) {
      const url = new URL(request.url);
      if (request.method === "GET") {
        const token = url.searchParams.get("hub.verify_token") ?? "";
        if (url.searchParams.get("hub.mode") !== "subscribe" || !(await safeEqual(token, options.verifyToken))) {
          throw new WebhookError("Invalid verify token", 403);
        }
        return { events: [], response: new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) };
      }
      const raw = new Uint8Array(await request.arrayBuffer());
      const header = request.headers.get("x-hub-signature-256") ?? "";
      const signature = header.startsWith("sha256=") ? hexDecode(header.slice(7)) : null;
      if (!signature || signature.length !== 32 || !(await verifyHmac(options.appSecret, raw, signature))) {
        throw new WebhookError("Invalid WhatsApp signature");
      }
      const payload = JSON.parse(new TextDecoder().decode(raw)) as MetaPayload;
      const events: ChannelEvent[] = [];
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (change.field !== "messages" || value?.metadata?.phone_number_id !== options.phoneNumberId) continue;
          for (const m of value.messages ?? []) {
            const event = toMessage(m, value.contacts ?? []);
            if (event) events.push(event);
          }
          for (const s of value.statuses ?? []) {
            const status = STATUS[s.status];
            if (!status) continue;
            const error = s.errors?.[0];
            events.push({
              type: "status",
              providerMessageId: s.id,
              status,
              error: status === "failed" ? errorText(error) : null,
              at: new Date(Number(s.timestamp) * 1000),
            });
          }
        }
      }
      return { events };
    },

    async send(message): Promise<SendResult> {
      const recipient = message.to[0]?.address;
      if (!recipient) throw new ChannelError("No recipient", false);
      // Phone numbers go in `to` with the country code; business-scoped user ids go in `recipient`.
      const target = /^\+?[\d\s().-]+$/.test(recipient)
        ? { to: `+${recipient.replace(/\D/g, "")}` }
        : { recipient };
      const base = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...target,
        biz_opaque_callback_data: message.id,
        ...(message.replyToProviderMessageId ? { context: { message_id: message.replyToProviderMessageId } } : {}),
      };
      // Upload everything first, so a rejected file fails the send before anything reaches the customer.
      const uploads = await Promise.all((message.attachments ?? []).map(upload));
      const bodies: Record<string, unknown>[] = [];
      if (message.text.trim()) bodies.push({ ...base, type: "text", text: { body: message.text, preview_url: true } });
      for (const u of uploads) {
        const media = u.type === "document" ? { id: u.id, filename: u.filename } : { id: u.id };
        bodies.push({ ...base, type: u.type, [u.type]: media });
      }
      let first: string | null = null;
      for (const body of bodies) {
        const result = await graphCall<{ messages?: { id: string }[] }>(`${options.phoneNumberId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        first ??= result.messages?.[0]?.id ?? null;
      }
      if (!first) throw new ChannelError("WhatsApp didn't return a message id", false);
      return { providerMessageId: first };
    },
  };

  async function upload(file: OutboundAttachment) {
    const type = mediaType(file.contentType);
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", file.contentType);
    form.set("file", new Blob([file.content as unknown as ArrayBuffer], { type: file.contentType }), file.filename);
    const { id } = await graphCall<{ id: string }>(`${options.phoneNumberId}/media`, { method: "POST", body: form });
    return { id, type, filename: file.filename };
  }
}

type MetaError = { code?: number; title?: string; message?: string; error_data?: { details?: string } };
type MetaMedia = { id: string; mime_type?: string; caption?: string; filename?: string; file_size?: number };
type MetaContact = { wa_id?: string; user_id?: string; profile?: { name?: string } };
type MetaMessage = {
  id: string;
  from?: string;
  from_user_id?: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  button?: { text: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
} & Record<string, unknown>;
type MetaStatus = { id: string; status: string; timestamp: string; errors?: MetaError[] };
type MetaPayload = {
  entry?: {
    changes?: {
      field: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: MetaContact[];
        messages?: MetaMessage[];
        statuses?: MetaStatus[];
      };
    }[];
  }[];
};

const MEDIA_TYPES = ["image", "document", "audio", "video", "sticker"];

const STATUS: Record<string, DeliveryStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  played: "read",
  failed: "failed",
};

const WINDOW_CLOSED =
  "The 24-hour WhatsApp reply window has closed. The customer has to message you first; outside the window WhatsApp only allows approved templates.";

const RETRYABLE = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131056, 133004]);

function errorText(error: MetaError | undefined) {
  if (!error) return "WhatsApp couldn't deliver the message.";
  if (error.code === 131047) return `${WINDOW_CLOSED} (WhatsApp error 131047)`;
  const detail = error.error_data?.details ?? error.message ?? error.title ?? "WhatsApp couldn't deliver the message.";
  return error.code ? `${detail} (WhatsApp error ${error.code})` : detail;
}

function toChannelError(status: number, error: MetaError | undefined) {
  const retryable = status === 429 || status >= 500 || (error?.code !== undefined && RETRYABLE.has(error.code));
  return new ChannelError(error ? errorText(error) : `WhatsApp error ${status}`, retryable, status);
}

function mediaType(contentType: string): "image" | "video" | "audio" | "document" {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  if (type === "image/jpeg" || type === "image/png") return "image";
  if (type === "video/mp4" || type === "video/3gpp") return "video";
  if (type.startsWith("audio/")) return "audio";
  return "document";
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/amr": ".amr",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "application/pdf": ".pdf",
};
const extension = (contentType: string) => EXTENSIONS[contentType.split(";")[0]!.trim().toLowerCase()] ?? "";

/** Constant-time string comparison: compares HMACs of both values under a throwaway key. */
async function safeEqual(a: string, b: string) {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return verifyHmac(key, b, await hmac(key, a));
}
