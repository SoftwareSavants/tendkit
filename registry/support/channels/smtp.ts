import type { Channel, ChannelEvent, ChannelState } from "../channel";
import { utf8 } from "./crypto";
import { buildRawEmail, parseRawEmail } from "./mime";

export type SmtpTransport = {
  /** Delivers one message. `raw` is the complete RFC 5322 message; `envelope` is MAIL FROM / RCPT TO. */
  send(raw: Uint8Array, envelope: { from: string; to: string[] }): Promise<void>;
};

export type ImapPoller = {
  /**
   * Returns messages that arrived since `state` (null on the first call) and the state to pass next
   * time. Put the mailbox's UIDVALIDITY in `state.uidValidity`: message ids become
   * "<uidValidity>:<uid>", which stay unique when the server renumbers the mailbox.
   * On the first call return no messages, just the current position, so old mail isn't imported.
   */
  fetchSince(state: ChannelState | null): Promise<{ messages: { uid: string; raw: Uint8Array; receivedAt?: Date }[]; state: ChannelState }>;
};

export type SmtpChannelOptions = {
  id: string;
  /** The address customers write to and replies come from, such as "support@acme.com". */
  address: string;
  replyAddress?: string;
  smtp: SmtpTransport;
  /** Reads the inbox. Leave out when inbound mail arrives some other way (a forwarding webhook). */
  imap?: ImapPoller;
};

/**
 * Any mailbox reachable over SMTP and IMAP (Fastmail, Zoho, cPanel hosting, a Gmail or Microsoft 365
 * mailbox with an app password). The adapter builds and parses MIME; you inject the two network
 * functions, so it runs on Node, Bun and Cloudflare Workers alike. `runScheduled()` polls IMAP.
 *
 * Node, with nodemailer and imapflow (`pnpm add nodemailer imapflow`):
 *
 * ```ts
 * import nodemailer from "nodemailer";
 * import { ImapFlow } from "imapflow";
 *
 * const transporter = nodemailer.createTransport({ host: "smtp.example.com", port: 587, requireTLS: true, auth: { user, pass } });
 * const smtp = { send: (raw, envelope) => transporter.sendMail({ raw: Buffer.from(raw), envelope }).then(() => {}) };
 *
 * const imap = {
 *   async fetchSince(state) {
 *     const client = new ImapFlow({ host: "imap.example.com", port: 993, secure: true, auth: { user, pass }, logger: false });
 *     await client.connect();
 *     const lock = await client.getMailboxLock("INBOX");
 *     try {
 *       const box = client.mailbox; // { uidValidity, uidNext, … }
 *       const validity = String(box.uidValidity);
 *       // First run, or the server renumbered the mailbox: start from now.
 *       if (!state || state.uidValidity !== validity) return { messages: [], state: { uidValidity: validity, nextUid: box.uidNext } };
 *       const messages = [];
 *       let nextUid = state.nextUid;
 *       if (box.uidNext > nextUid) {
 *         for await (const m of client.fetch(`${nextUid}:*`, { uid: true, source: true, internalDate: true }, { uid: true })) {
 *           if (m.uid < nextUid) continue; // "n:*" always returns the last message
 *           messages.push({ uid: String(m.uid), raw: m.source, receivedAt: m.internalDate });
 *           nextUid = m.uid + 1;
 *           if (messages.length >= 50) break; // keep each run short; the rest come next time
 *         }
 *       }
 *       return { messages, state: { uidValidity: validity, nextUid } };
 *     } finally {
 *       lock.release();
 *       await client.logout();
 *     }
 *   },
 * };
 *
 * smtpChannel({ id: "email", address: "support@example.com", smtp, imap });
 * ```
 *
 * Cloudflare Workers (`nodejs_compat`; outbound port 25 is blocked, use 587 or 465):
 * - SMTP: nodemailer works over STARTTLS on 587 as above. Or `worker-mailer`, which uses
 *   `cloudflare:sockets` directly: `const m = await WorkerMailer.connect({ host, port: 587, secure: false,
 *   startTls: true, credentials: { username, password }, authType: "plain" })`, then send the
 *   envelope and raw message (it has no XOAUTH2, so Gmail and Microsoft 365 need app passwords).
 * - IMAP: imapflow on implicit TLS (993) as above; for STARTTLS pass
 *   `createSocketsTransport(connect)` from imapflow with `connect` from "cloudflare:sockets".
 *   Open sockets inside the scheduled handler, never at module scope, and keep runs short.
 */
export function smtpChannel(options: SmtpChannelOptions): Channel {
  const { imap } = options;
  return {
    id: options.id,
    kind: "email",
    identityKind: "email",
    address: options.address,
    replyAddress: options.replyAddress,
    capabilities: {
      subject: true,
      attachments: { maxBytes: 20 * 1024 * 1024, maxCount: 20 },
      maxTextLength: null,
      conversation: "thread",
      replyWindowHours: null,
      deliveryReceipts: false,
      canStartConversation: true,
    },

    ...(imap && {
      async sync(state: ChannelState | null) {
        const result = await imap.fetchSince(state);
        const validity = result.state.uidValidity;
        const events: ChannelEvent[] = [];
        for (const m of result.messages) {
          const providerMessageId = validity == null ? m.uid : `${String(validity)}:${m.uid}`;
          const message = await parseRawEmail(m.raw, { providerMessageId, receivedAt: m.receivedAt });
          const own = message.from.address.toLowerCase() === options.address.toLowerCase();
          // A copy of mail sent from the mailbox itself (a Sent folder, or Bcc to self) is the team's reply.
          events.push({ type: "message", message: own ? { ...message, direction: "outbound" } : message });
        }
        return { events, state: result.state };
      },
    }),

    async send(message) {
      const { raw, messageId } = buildRawEmail({
        from: { address: options.address, name: message.fromName },
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
      const to = [...message.to, ...(message.cc ?? [])].map((a) => a.address);
      await options.smtp.send(utf8(raw), { from: options.address, to });
      // SMTP has no message id of its own; the Message-ID we set is both.
      return { providerMessageId: messageId, rfcMessageId: messageId, status: "sent" };
    },
  };
}
