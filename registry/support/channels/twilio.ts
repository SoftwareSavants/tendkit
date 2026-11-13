import {
  ChannelError,
  WebhookError,
  type Channel,
  type ChannelEvent,
  type InboundAttachment,
  type SendResult,
} from "../channel";
import type { DeliveryStatus } from "../types";
import { base64Decode, base64Encode, utf8, verifyHmac } from "./crypto";

export type TwilioChannelOptions = {
  /** Stable channel id, stored on every ticket. */
  id: string;
  /** "AC…". */
  accountSid: string;
  /** The account's primary Auth Token. Always required: Twilio signs webhooks with it. */
  authToken: string;
  /** Optional API key ("SK…") for REST calls; recommended over the Auth Token. */
  apiKeySid?: string;
  apiKeySecret?: string;
  /** The number customers write to: "+14155550100", or "whatsapp:+14155550100" for WhatsApp. */
  from: string;
  /** Send through a Messaging Service ("MG…") instead of `from`. `from` still sets the channel's kind and address. */
  messagingServiceSid?: string;
  /**
   * The exact public URL configured in Twilio for incoming messages, e.g.
   * "https://acme.com/api/support/webhooks/sms". Signatures cover it, so it must match character
   * for character (scheme, host, path, query). Don't rebuild it from `request.url` behind a proxy.
   */
  webhookUrl: string;
  /** Where Twilio posts delivery updates. Defaults to `webhookUrl`; both URLs are accepted when verifying. */
  statusCallbackUrl?: string;
  /** Shown to agents. Defaults to `from` without the "whatsapp:" prefix. */
  address?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
};

/**
 * Twilio Programmable Messaging: SMS, or WhatsApp through Twilio, depending on `from`.
 *
 * Setup:
 * 1. Buy a number (or connect a WhatsApp sender) in the Twilio Console.
 * 2. Under the number's (or Messaging Service's) "A message comes in", set `webhookUrl`, method POST.
 * 3. Create an API key (Account → API keys) and pass `apiKeySid`/`apiKeySecret`; keep `authToken`
 *    for webhook signatures. If you rotate the Auth Token, update it here when you promote the
 *    secondary token.
 *
 * Limits:
 * - SMS: no attachments here (MMS needs a public media URL), 1,600 characters, billed per segment;
 *   Arabic and other non-GSM text uses 70-character segments. No reply window.
 * - WhatsApp: 24-hour customer service window; outside it Twilio only sends approved templates
 *   (error 63016), which this adapter doesn't send.
 * - Two-way SMS isn't available in every country, so customers in some countries can't text a
 *   Twilio number. Check https://www.twilio.com/en-us/guidelines/<country-code>/sms before relying
 *   on SMS replies.
 */
export function twilioChannel(options: TwilioChannelOptions): Channel {
  const doFetch = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? "https://api.twilio.com").replace(/\/$/, "");
  const whatsapp = /^whatsapp:/i.test(options.from);
  const user = options.apiKeySid ?? options.accountSid;
  const authorization = `Basic ${base64Encode(utf8(`${user}:${options.apiKeySecret ?? options.authToken}`))}`;
  const statusCallbackUrl = options.statusCallbackUrl ?? options.webhookUrl;
  const signedUrls = [...new Set([options.webhookUrl, statusCallbackUrl].flatMap(urlCandidates))];

  async function download(url: string): Promise<Uint8Array> {
    // Twilio redirects media to temporary storage. Follow by hand so credentials never leave Twilio.
    let res = await doFetch(url, { headers: { authorization }, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) res = await doFetch(new URL(location, url).toString());
    if (!res.ok) throw new ChannelError(`Twilio media download failed (${res.status})`, res.status >= 500, res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  function toEvents(params: URLSearchParams): ChannelEvent[] {
    const sid = params.get("MessageSid") ?? params.get("SmsSid");
    if (!sid) return [];
    const state = params.get("MessageStatus") ?? params.get("SmsStatus");
    if (state && state !== "received" && state !== "receiving") {
      const status = STATUS[state];
      if (!status) return [];
      const code = params.get("ErrorCode");
      const error = code && code !== "0" ? errorText(code, params.get("ErrorMessage")) : null;
      return [{ type: "status", providerMessageId: sid, status, error, at: new Date() }];
    }

    const attachments: InboundAttachment[] = [];
    const count = Number(params.get("NumMedia") ?? 0);
    for (let i = 0; i < count; i++) {
      const url = params.get(`MediaUrl${i}`);
      if (!url) continue;
      const contentType = params.get(`MediaContentType${i}`) ?? "application/octet-stream";
      attachments.push({
        filename: `attachment-${i + 1}${extension(contentType)}`,
        contentType,
        size: null,
        read: () => download(url),
      });
    }
    return [
      {
        type: "message",
        message: {
          providerMessageId: sid,
          from: { address: stripPrefix(params.get("From") ?? ""), name: params.get("ProfileName") || null },
          to: [{ address: stripPrefix(params.get("To") ?? "") }],
          text: params.get("Body") ?? "",
          receivedAt: new Date(),
          attachments,
        },
      },
    ];
  }

  return {
    id: options.id,
    kind: whatsapp ? "whatsapp" : "sms",
    identityKind: whatsapp ? "whatsapp" : "phone",
    address: options.address ?? stripPrefix(options.from),
    capabilities: {
      subject: false,
      attachments: false,
      maxTextLength: 1600,
      conversation: "contact",
      replyWindowHours: whatsapp ? 24 : null,
      deliveryReceipts: true,
      // SMS can write first. WhatsApp needs an approved template outside its 24-hour window.
      canStartConversation: !whatsapp,
    },

    async webhook(request) {
      if (request.method !== "POST") throw new WebhookError("Method not allowed", 405);
      const raw = await request.text();
      const params = new URLSearchParams(raw);
      const signature = request.headers.get("x-twilio-signature");
      if (!signature || !(await verifyTwilioSignature(options.authToken, signedUrls, params, signature))) {
        throw new WebhookError("Invalid Twilio signature");
      }
      return {
        events: toEvents(params),
        // Empty TwiML: no automatic reply. A text/plain body would be sent to the customer.
        response: new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
          headers: { "content-type": "text/xml" },
        }),
      };
    },

    async send(message): Promise<SendResult> {
      const recipient = message.to[0]?.address;
      if (!recipient) throw new ChannelError("No recipient", false);
      if (message.attachments?.length) throw new ChannelError("This channel doesn't support attachments.", false);
      const form = new URLSearchParams({ To: (whatsapp ? "whatsapp:" : "") + e164(recipient), Body: message.text });
      if (options.messagingServiceSid) form.set("MessagingServiceSid", options.messagingServiceSid);
      else form.set("From", options.from);
      form.set("StatusCallback", statusCallbackUrl);

      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/2010-04-01/Accounts/${options.accountSid}/Messages.json`, {
          method: "POST",
          headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
      } catch (error) {
        // Twilio has no idempotency key for messages, so a lost response may still have sent it.
        throw new ChannelError(`Twilio unreachable: ${String(error)}`, false);
      }
      const body = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number; message?: string };
      if (!res.ok || !body.sid) {
        const code = body.code ? String(body.code) : null;
        const retryable = res.status === 429 || res.status >= 500 || code === "20429";
        throw new ChannelError(code ? errorText(code, body.message) : `Twilio error ${res.status}`, retryable, res.status);
      }
      return { providerMessageId: body.sid, status: STATUS[body.status ?? ""] ?? "queued" };
    },
  };
}

const STATUS: Record<string, DeliveryStatus> = {
  accepted: "queued",
  scheduled: "queued",
  queued: "queued",
  sending: "queued",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  undelivered: "failed",
  failed: "failed",
  canceled: "failed",
};

const ERRORS: Record<string, string> = {
  "63016":
    "The 24-hour WhatsApp reply window has closed. The customer has to message you first; outside the window WhatsApp only allows approved templates.",
  "21610": "The recipient has unsubscribed (replied STOP) and can't receive messages from this number.",
  "21211": "The phone number is not valid.",
  "21614": "The number can't receive text messages.",
  "21408": "Sending to this country isn't enabled on the Twilio account.",
  "21617": "The message is too long.",
  "63003": "The recipient isn't reachable on WhatsApp.",
  "30003": "The phone is unreachable.",
  "30005": "The number doesn't exist.",
  "30006": "The number can't receive text messages.",
  "30007": "The carrier filtered the message.",
  "30008": "The message couldn't be delivered.",
};

function errorText(code: string, message: string | null | undefined) {
  return `${ERRORS[code] ?? message ?? "The message couldn't be delivered."} (Twilio error ${code})`;
}

const stripPrefix = (address: string) => address.replace(/^whatsapp:/i, "");
const e164 = (address: string) => {
  const digits = stripPrefix(address).replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "video/mp4": ".mp4",
  "text/vcard": ".vcf",
};
const extension = (contentType: string) => EXTENSIONS[contentType.split(";")[0]!.trim().toLowerCase()] ?? "";

/**
 * Twilio's signature: HMAC-SHA1 (Auth Token) over the URL followed by every POST parameter as
 * name+value, sorted by name, base64-encoded. Twilio may sign with or without the default port,
 * so both forms are tried, as the official SDKs do.
 */
export async function verifyTwilioSignature(
  authToken: string,
  urls: string[],
  params: URLSearchParams,
  signature: string
): Promise<boolean> {
  let expected: Uint8Array;
  try {
    expected = base64Decode(signature);
  } catch {
    return false;
  }
  const byName = new Map<string, string[]>();
  for (const [name, value] of params) byName.set(name, [...(byName.get(name) ?? []), value]);
  let signed = "";
  for (const name of [...byName.keys()].sort()) {
    for (const value of [...new Set(byName.get(name))].sort()) signed += name + value;
  }
  for (const url of urls) {
    if (await verifyHmac(authToken, url + signed, expected, "SHA-1")) return true;
  }
  return false;
}

function urlCandidates(raw: string): string[] {
  const url = raw.split("#")[0]!;
  const match = /^(https?:\/\/)([^/?]*)(.*)$/i.exec(url);
  if (!match) return [url];
  const [, scheme, authority, rest] = match as unknown as [string, string, string, string];
  const host = authority.replace(/:\d+$/, "");
  const port = scheme.toLowerCase() === "https://" ? ":443" : ":80";
  return [...new Set([url, scheme + host + rest, scheme + host + port + rest])];
}
