import type { Address, DeliveryStatus, IdentityKind } from "./types";

/**
 * A channel adapter connects one provider account (a Resend domain, a Microsoft 365 mailbox,
 * a Twilio number, a WhatsApp business number, …) to the inbox. Adapters only translate:
 * provider payloads in, provider API calls out. Threading, storage and rules live in the service.
 */
export interface Channel {
  /** Stable id from your config, stored on every ticket. Never change it once tickets exist. */
  id: string;
  kind: "email" | "sms" | "whatsapp" | "telegram" | "api";
  /** How senders on this channel are identified. */
  identityKind: IdentityKind;
  /** What customers write to, for display: "support@acme.com", "+1 415 555 0133". */
  address: string;
  capabilities: ChannelCapabilities;
  /**
   * Email only: an address on a receiving domain that routes back to this channel, such as
   * "support@in.acme.com". Replies carry a ticket token in it ("support+t-<token>@in.acme.com"),
   * which threads them even when the customer's mail client drops the headers.
   */
  replyAddress?: string;

  /**
   * Verifies and parses a provider webhook. Return `response` when the provider expects a
   * specific reply (a verification challenge, empty TwiML); otherwise the handler answers 200.
   * Throw `WebhookError` for requests that fail verification.
   */
  webhook?(request: Request): Promise<WebhookResult>;

  /**
   * For providers that are polled or need subscriptions renewed. Called on a schedule with the
   * state the previous call returned (null the first time). Must be safe to run concurrently
   * with itself returning the same events: ingestion is idempotent.
   */
  sync?(state: ChannelState | null): Promise<{ events: ChannelEvent[]; state: ChannelState }>;

  send(message: OutboundMessage): Promise<SendResult>;
}

export type ChannelCapabilities = {
  subject: boolean;
  attachments: { maxBytes: number; maxCount: number } | false;
  /** Longest message the provider accepts, in characters; null when effectively unlimited. */
  maxTextLength: number | null;
  /**
   * thread: each subject is its own conversation (email).
   * contact: one running conversation per person (SMS, WhatsApp, Telegram).
   */
  conversation: "thread" | "contact";
  /** Hours after the customer's last message during which free-form replies are allowed. */
  replyWindowHours: number | null;
  deliveryReceipts: boolean;
  /**
   * Whether your team can write first on this channel (`startTicket`). Email and SMS can.
   * Channels where the customer has to write first can't: WhatsApp outside its 24-hour window
   * needs an approved template, a Telegram bot can only answer, and the API channel only receives.
   * Left out, a channel can when it has no reply window and isn't the API channel.
   */
  canStartConversation?: boolean;
};

/** Whether your team can write first on a channel, and why not when it can't. */
export function startBlockedReason(channel: Pick<Channel, "kind" | "capabilities">): "needs_template" | "not_supported" | null {
  const { canStartConversation, replyWindowHours } = channel.capabilities;
  if (canStartConversation === true) return null;
  if (replyWindowHours !== null) return "needs_template";
  if (canStartConversation === false || channel.kind === "api") return "not_supported";
  return null;
}

export type ChannelState = Record<string, unknown>;

export type WebhookResult = { events: ChannelEvent[]; response?: Response };

export type ChannelEvent =
  | { type: "message"; message: InboundMessage }
  | {
      type: "status";
      providerMessageId: string;
      status: DeliveryStatus;
      error?: string | null;
      /** The RFC Message-ID the provider assigned, when it reports it with the status. */
      rfcMessageId?: string | null;
      at: Date;
    };

export type InboundAttachment = {
  filename: string;
  contentType: string;
  size: number | null;
  contentId?: string | null;
  inline?: boolean;
  /** Downloads the bytes. Called once, after the message is accepted. */
  read(): Promise<Uint8Array>;
};

export type InboundMessage = {
  /** Unique per channel; used to drop duplicates. */
  providerMessageId: string;
  /**
   * Mailbox-backed channels (Microsoft 365, Gmail) also see mail your team sent from the mailbox
   * itself. Those arrive as "outbound" so they appear in the ticket as replies.
   */
  direction?: "inbound" | "outbound";
  from: Address;
  to: Address[];
  cc?: Address[];
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  /** Lower-cased header names. Only what the core needs: auto-reply and bounce detection. */
  headers?: Record<string, string>;
  rfcMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  providerThreadId?: string | null;
  receivedAt: Date;
  attachments?: InboundAttachment[];
  /**
   * "api" for messages your app creates itself (a contact form). They become tickets like any
   * other, but never get the automatic acknowledgement: your form already confirms.
   */
  source?: "channel" | "api";
};

export type OutboundAttachment = { filename: string; contentType: string; content: Uint8Array };

export type OutboundMessage = {
  /** Our message id. Adapters pass it as an idempotency key where the provider supports one. */
  id: string;
  to: Address[];
  cc?: Address[];
  /** Display name to send as; the adapter's configured address is used. */
  fromName?: string | null;
  replyTo?: Address | null;
  subject?: string | null;
  text: string;
  html?: string | null;
  attachments?: OutboundAttachment[];
  /** The Message-ID to use, when the adapter lets us choose it. Includes angle brackets. */
  rfcMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  providerThreadId?: string | null;
  /** The provider message this replies to, for channels that quote (WhatsApp context). */
  replyToProviderMessageId?: string | null;
  headers?: Record<string, string>;
};

export type SendResult = {
  providerMessageId: string;
  /** The RFC Message-ID the provider actually used, when it reports one. */
  rfcMessageId?: string | null;
  providerThreadId?: string | null;
  status?: DeliveryStatus;
};

/** A webhook that failed verification. The handler answers with `status` and logs nothing sensitive. */
export class WebhookError extends Error {
  constructor(
    message: string,
    readonly status = 401
  ) {
    super(message);
    this.name = "WebhookError";
  }
}

/** A provider call that failed. `retryable` tells the caller whether trying again can help. */
export class ChannelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message);
    this.name = "ChannelError";
  }
}
