import { ChannelError, WebhookError, type Channel, type InboundAttachment, type SendResult } from "../channel";
import { hmac, verifyHmac } from "./crypto";

export type TelegramChannelOptions = {
  /** Stable channel id, stored on every ticket. */
  id: string;
  /** From @BotFather. It is also part of file download URLs, so never log or expose those. */
  botToken: string;
  /** The `secret_token` you pass to setWebhook: 1–256 characters, A-Z a-z 0-9 _ -. */
  secretToken: string;
  /** Without the "@", for display. */
  botUsername: string;
  fetch?: typeof fetch;
  baseUrl?: string;
};

/**
 * Telegram bot. Customers open a private chat with the bot; one conversation per chat.
 *
 * Setup:
 * 1. Create the bot with @BotFather (/newbot) and copy the token.
 * 2. Register the webhook once:
 *    curl https://api.telegram.org/bot<token>/setWebhook \
 *      -d url=https://acme.com/api/support/webhooks/telegram \
 *      -d secret_token=<secretToken> -d 'allowed_updates=["message"]'
 *
 * Behaviour: only private chats are handled (group messages are ignored). The bot can only write to
 * people who messaged it first. There are no delivery receipts. Downloads are limited to 20 MB.
 */
export function telegramChannel(options: TelegramChannelOptions): Channel {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.telegram.org").replace(/\/$/, "");

  async function call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    const json = !(body instanceof FormData);
    const res = await doFetch(`${baseUrl}/bot${options.botToken}/${method}`, {
      method: "POST",
      headers: json ? { "content-type": "application/json" } : {},
      body: json ? JSON.stringify(body) : body,
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !data.ok) {
      const status = res.status;
      const message =
        status === 403
          ? "The customer has blocked the bot or never started a chat with it."
          : `Telegram: ${data.description ?? `error ${status}`}`;
      throw new ChannelError(message, status === 429 || status >= 500, status);
    }
    return data.result as T;
  }

  async function download(fileId: string): Promise<Uint8Array> {
    const file = await call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) throw new ChannelError("Telegram file is not available", false);
    const res = await doFetch(`${baseUrl}/file/bot${options.botToken}/${file.file_path}`);
    if (!res.ok) throw new ChannelError(`Telegram file download failed (${res.status})`, res.status >= 500, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  return {
    id: options.id,
    kind: "telegram",
    identityKind: "telegram",
    address: `@${options.botUsername}`,
    capabilities: {
      subject: false,
      attachments: { maxBytes: 50_000_000, maxCount: 10 },
      maxTextLength: 4096,
      conversation: "contact",
      replyWindowHours: null,
      deliveryReceipts: false,
      // A bot can only write to people who wrote to it first.
      canStartConversation: false,
    },

    async webhook(request) {
      const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (request.method !== "POST" || !(await safeEqual(secret, options.secretToken))) {
        throw new WebhookError("Invalid Telegram secret token");
      }
      const update = (await request.json()) as { message?: TelegramMessage };
      const m = update.message;
      if (!m || m.chat.type !== "private" || m.from?.is_bot) return { events: [] };

      const attachments: InboundAttachment[] = [];
      const photo = m.photo?.at(-1); // sizes come smallest first
      if (photo) {
        attachments.push(file(photo, "photo.jpg", "image/jpeg"));
      }
      for (const [kind, name, type] of FILE_KINDS) {
        const f = m[kind];
        if (f) attachments.push(file(f, f.file_name ?? name, f.mime_type ?? type));
      }
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || null;
      return {
        events: [
          {
            type: "message",
            message: {
              // message_id is only unique within a chat.
              providerMessageId: `${m.chat.id}:${m.message_id}`,
              from: { address: String(m.chat.id), name },
              to: [{ address: `@${options.botUsername}` }],
              text: m.text ?? m.caption ?? "",
              receivedAt: new Date(m.date * 1000),
              attachments,
            },
          },
        ],
      };
    },

    async send(message): Promise<SendResult> {
      const chatId = message.to[0]?.address;
      if (!chatId) throw new ChannelError("No recipient", false);
      const replyTo = message.replyToProviderMessageId?.split(":");
      const reply =
        replyTo?.[0] === chatId && replyTo[1]
          ? { reply_parameters: { message_id: Number(replyTo[1]), allow_sending_without_reply: true } }
          : {};
      const sent: { message_id: number }[] = [];
      if (message.text.trim()) sent.push(await call("sendMessage", { chat_id: chatId, text: message.text, ...reply }));
      for (const a of message.attachments ?? []) {
        const form = new FormData();
        form.set("chat_id", chatId);
        form.set("document", new Blob([a.content as unknown as ArrayBuffer], { type: a.contentType }), a.filename);
        sent.push(await call("sendDocument", form));
      }
      if (!sent[0]) throw new ChannelError("Nothing to send", false);
      return { providerMessageId: `${chatId}:${sent[0].message_id}` };
    },
  };

  function file(f: TelegramFile, filename: string, contentType: string): InboundAttachment {
    return { filename, contentType, size: f.file_size ?? null, read: () => download(f.file_id) };
  }
}

type TelegramFile = { file_id: string; file_size?: number; file_name?: string; mime_type?: string };
type FileKind = "document" | "video" | "audio" | "voice";
type TelegramMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string };
  from?: { is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  photo?: TelegramFile[];
} & Partial<Record<FileKind, TelegramFile>>;

const FILE_KINDS: [FileKind, string, string][] = [
  ["document", "document", "application/octet-stream"],
  ["video", "video.mp4", "video/mp4"],
  ["audio", "audio.mp3", "audio/mpeg"],
  ["voice", "voice.ogg", "audio/ogg"],
];

/** Constant-time string comparison: compares HMACs of both values under a throwaway key. */
async function safeEqual(a: string, b: string) {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return verifyHmac(key, b, await hmac(key, a));
}
