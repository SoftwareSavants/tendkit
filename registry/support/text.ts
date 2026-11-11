/**
 * Plain-text helpers that run anywhere (Workers, Node, the browser): no DOM.
 *
 * Patterns follow Discourse's email_reply_trimmer, talon and Zammad. Arabic patterns are
 * best-effort: add real samples to tests/fixtures when you see a reply that isn't trimmed.
 */

const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

/** Lines where quoted history starts. Everything from the match down is dropped. */
const QUOTE_HEADERS: RegExp[] = [
  /^[\s>]*(?:On|At)\s.{1,300}?\b(?:wrote|writes|said)\s*:?\s*$/i,
  /^[\s>]*.{1,250}\s(?:wrote|schrieb|a écrit|escribió)\s*:\s*$/i,
  /^[\s>]*Le\s.{1,300}?\ba\s+écrit\s*:?\s*$/i,
  /^[\s>]*(?:في|بتاريخ|يوم)\s.{1,300}?(?:تمت\s+كتابة\s+ما\s+يلي\s+بواسطة|كتب|كتبت)\s.{0,250}:\s*$/,
  /^[\s>]*.{1,250}\s(?:كتب|كتبت)\s*:\s*$/,
  /^[\s>]*.{0,40}\d{4}.{1,80}<[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+>:?\s*$/,
  /^[\s>*]*-{2,}\s*(?:Original Message|Forwarded message|Reply Message|Message d'origine|Message transféré|Ursprüngliche Nachricht|Mensaje original|الرسالة الأصلية|رسالة معاد توجيهها)\s*-{2,}/i,
  /^[\s>]*(?:Begin forwarded message|Début du message (?:réexpédié|transféré))\s*:/i,
];

/** An Outlook-style "From: / Sent: / To: / Subject:" block. */
const HEADER_LABEL =
  /^[\s>*]*(?:From|Sent|Date|To|Cc|Subject|De|Envoyé|À|A|Objet|Von|Gesendet|An|Betreff|من|المرسل|تم الإرسال|التاريخ|إلى|نسخة|الموضوع)\s*:\s*\S/i;

/** Mobile signatures: only these lines are removed. */
const SIGNATURE_LINES: RegExp[] = [
  /^\s*[(<]*Sent (?:from|via|with|by) .+/i,
  /^\s*Get Outlook for /i,
  /^\s*Envoyé (?:depuis|de) (?:mon|Yahoo Mail)/i,
  /^\s*Obtenir Outlook pour /i,
  /^\s*(?:أرسلت|تم الإرسال|مرسل(?:ة)?) من (?:جهاز )?(?:الـ)?(?:iPhone|آيفون|هاتف|Android)/i,
];

/**
 * What the person wrote this time: drops quoted history, the "-- " signature and mobile
 * signatures. Falls back to the full text when trimming would leave nothing.
 */
export function visibleReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(BIDI_CONTROLS, "").replace(/[  ]/g, " ").split("\n");
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (QUOTE_HEADERS.some((re) => re.test(line)) || isHeaderBlock(lines, i) || /^-- ?$/.test(line)) {
      end = i;
      break;
    }
    // A run of "> " lines at the end is quoted history even without a header.
    if (/^\s*>/.test(line) && lines.slice(i).every((l) => /^\s*(>|$)/.test(l))) {
      end = i;
      break;
    }
  }
  // The rule Outlook draws above its "From:" block ("________") belongs to the quote.
  if (end < lines.length) {
    while (end > 0 && /^\s*(?:[_\-=–—]\s*){5,}$|^\s*$/.test(lines[end - 1]!)) end--;
  }
  const kept = lines
    .slice(0, end)
    .filter((line) => !SIGNATURE_LINES.some((re) => re.test(line)))
    .join("\n")
    .trim();
  return kept || text.trim();
}

/** Where mail clients put the quoted message in HTML; a signature after this belongs to the quote. */
const HTML_QUOTE_START = /<blockquote|<div[^>]+(?:gmail_quote|yahoo_quoted|divRplyFwdMsg|appendonsend|moz-cite-prefix|protonmail_quote)/i;

/** Elements mail clients wrap the sender's signature in. */
const HTML_SIGNATURE =
  /<(div|table|p|span)\b[^>]*(?:\bid\s*=\s*["']?(?:Signature|ms-outlook-mobile-signature)\b|\bclass\s*=\s*["'][^"']*\b(?:gmail_signature|moz-signature)\b)[^>]*>/i;

/**
 * The sender's signature as plain text, when their mail client marked it in the HTML (Outlook,
 * Gmail, Thunderbird). Use it with `withoutSignature` to show only what they wrote.
 */
export function signatureFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const quote = html.search(HTML_QUOTE_START);
  const own = quote === -1 ? html : html.slice(0, quote);
  const open = HTML_SIGNATURE.exec(own);
  if (!open) return null;
  const tag = open[1]!.toLowerCase();
  // Walk to the matching close tag so nested elements of the same kind stay inside.
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  tags.lastIndex = open.index + open[0].length;
  let depth = 1;
  let close = own.length;
  for (let m = tags.exec(own); m; m = tags.exec(own)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      close = m.index;
      break;
    }
  }
  const text = htmlToText(own.slice(open.index + open[0].length, close))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
  return text || null;
}

/** Removes `signature` from the end of `text`, comparing line by line and ignoring spacing. */
export function withoutSignature(text: string, signature: string | null | undefined): string {
  if (!signature) return text;
  const norm = (l: string) => l.replace(/\s+/g, " ").trim();
  const sig = signature.split("\n").map(norm).filter(Boolean);
  const lines = text.split("\n");
  // Indexes of non-empty lines, so blank lines between signature lines don't matter.
  const filled = lines.flatMap((l, i) => (norm(l) ? [i] : []));
  if (!sig.length || filled.length <= sig.length) return text;
  const tail = filled.slice(-sig.length);
  if (!tail.every((i, k) => norm(lines[i]!) === sig[k])) return text;
  return lines.slice(0, tail[0]).join("\n").trim();
}

/** The quoted or forwarded email inside a message: who wrote it, when, and what they wrote. */
export type QuotedMessage = {
  from: { address: string; name: string | null };
  /** When the quoted email was sent, if its header gave a date we could read. */
  sentAt: Date | null;
  /** What the quoted email said, without its own quoted history. */
  text: string;
  /** What the sender wrote above the quote. */
  before: string;
};

const FROM_LABEL = /^[\s>*]*(?:From|De|Von|Da|Van|من|المرسل)\s*\*?\s*:\s*\*?\s*(.+)$/i;
const DATE_LABEL = /^[\s>*]*(?:Sent|Date|Envoyé|Gesendet|Datum|Fecha|Enviado|Data|تم الإرسال|التاريخ)\s*\*?\s*:\s*\*?\s*(.+)$/i;
const WROTE = /^\s*(?:wrote|a écrit|escribió|schrieb|schreef|ha scritto)\s*:?\s*$/i;
/** Gmail, Apple Mail and Thunderbird: "On Mon, Nov 9, 2026 at 4:23 PM Emma <emma@acme.test> wrote:". */
const ATTRIBUTION =
  /^[\s>]*(?:On|Le|El|Am|Op|Il)\s(.+?\d{1,2}[:.h]\d{2}(?::\d{2})?(?:\s*[AP]\.?M\.?)?|.+?),?\s+([^,<>]*?)\s*<([^<>\s]+@[^<>\s]+)>\s*(?:wrote|a écrit|escribió|schrieb|schreef|ha scritto)\s*:?\s*$/i;
const FORWARD_SEPARATOR =
  /^[\s>*]*(?:-{2,}\s*(?:Original Message|Forwarded message|Message d'origine|Message transféré|Ursprüngliche Nachricht|Mensaje original|الرسالة الأصلية|رسالة معاد توجيهها)\s*-{2,}|(?:Begin forwarded message|Début du message (?:réexpédié|transféré))\s*:)/i;
const RULE = /^\s*(?:[_\-=–—]\s*){5,}$/;

/**
 * The email quoted below a reply or inside a forward, read from the header mail clients put
 * above it: Outlook's "From: / Sent:" block, Gmail's "On … wrote:", Apple Mail's "Begin
 * forwarded message:". Pass the HTML too, for messages whose plain text leaves the quote out.
 * Returns null when there's no quote, or its sender has no email address.
 */
export function quotedMessage(text: string | null | undefined, html?: string | null): QuotedMessage | null {
  return (text ? findQuoted(text) : null) ?? (html ? findQuoted(htmlToText(html, { keepQuotes: true })) : null);
}

function findQuoted(source: string): QuotedMessage | null {
  const lines = source.replace(/\r\n?/g, "\n").replace(BIDI_CONTROLS, "").replace(/[  ]/g, " ").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let from: QuotedMessage["from"] | null = null;
    let date: string | null = null;
    let bodyStart = -1;
    let quoted = false;

    if (FROM_LABEL.test(line) && isHeaderBlock(lines, i)) {
      from = parseAddressText(FROM_LABEL.exec(line)![1]!);
      // The block ends at a blank line or the first line that isn't a header (a wrapped To: list may continue).
      let j = i;
      const isLabel = (k: number) => k < lines.length && HEADER_LABEL.test(lines[k]!);
      while (j < lines.length && lines[j]!.trim() !== "" && (isLabel(j) || isLabel(j + 1))) {
        const d = DATE_LABEL.exec(lines[j]!);
        if (d) date = d[1]!;
        j++;
      }
      bodyStart = j;
    } else {
      // Gmail wraps a long attribution onto two lines.
      const wrapped = lines[i + 1] !== undefined && WROTE.test(lines[i + 1]!);
      const m = ATTRIBUTION.exec(wrapped ? `${line} ${lines[i + 1]}` : line);
      if (m) {
        from = { address: m[3]!.toLowerCase(), name: unquote(m[2]!) };
        date = m[1]!.replace(/\s+(?:at|à)\s+/i, " ");
        bodyStart = wrapped ? i + 2 : i + 1;
        quoted = true;
      }
    }
    if (bodyStart === -1) continue;
    if (!from) return null;

    let end = i;
    while (end > 0 && (RULE.test(lines[end - 1]!) || FORWARD_SEPARATOR.test(lines[end - 1]!) || !lines[end - 1]!.trim())) end--;
    let body = lines.slice(bodyStart);
    if (quoted || body.filter((l) => l.trim()).every((l) => /^\s*>/.test(l))) body = body.map((l) => l.replace(/^\s*> ?/, ""));
    const quotedText = body.join("\n").trim();
    if (!quotedText) return null;
    return { from, sentAt: parseMailDate(date), text: visibleReply(quotedText), before: lines.slice(0, end).join("\n").trim() };
  }
  return null;
}

const unquote = (s: string) => s.replace(/^["']|["']$/g, "").trim() || null;

/** "Emma Clarke <emma@acme.test>", "Emma [mailto:emma@acme.test]" or "emma@acme.test". */
function parseAddressText(value: string): QuotedMessage["from"] | null {
  const clean = value.replace(/\*/g, "").trim();
  const m = /^(.*?)\s*[<[](?:mailto:)?([^<>[\]\s]+@[^<>[\]\s]+)[>\]]\s*$/i.exec(clean);
  if (m) return { address: m[2]!.toLowerCase(), name: unquote(m[1]!) };
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(clean)) return { address: clean.toLowerCase(), name: null };
  return null;
}

function parseMailDate(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function isHeaderBlock(lines: string[], i: number): boolean {
  if (!HEADER_LABEL.test(lines[i]!)) return false;
  const following = lines.slice(i + 1, i + 5).filter((l) => HEADER_LABEL.test(l));
  return following.length >= 2;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Readable text from HTML email, without a DOM. Quotes become "> " lines so trimming still works. */
export function htmlToText(html: string, options: { keepQuotes?: boolean } = {}): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Known quote containers: everything inside becomes quoted.
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner: string) =>
      `\n${htmlToText(inner).split("\n").map((l) => `> ${l}`).join("\n")}\n`
    );
  if (!options.keepQuotes) {
    s = s.replace(/<div[^>]+(?:gmail_quote|yahoo_quoted|divRplyFwdMsg|appendonsend|moz-cite-prefix|protonmail_quote)[\s\S]*$/i, "\n> \n");
  }
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|section|article)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href && /^https?:/i.test(href) ? `${text} (${href})` : text || href;
    })
    .replace(/<[^>]+>/g, "");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function snippet(text: string, length = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}

/**
 * Why a message was sent by a machine (out-of-office, bounce, mailing list), or null when a
 * person wrote it. Automated mail never reopens a ticket, notifies anyone or gets an acknowledgement.
 */
export function automatedReason(headers: Record<string, string> | undefined, from: string): string | null {
  const h = (name: string) => headers?.[name];
  const v = (name: string) => (h(name) ?? "").trim().toLowerCase();
  const autoSubmitted = v("auto-submitted");
  if (autoSubmitted && !/^no\b/.test(autoSubmitted)) return "auto-submitted";
  if (["x-autoreply", "x-autorespond", "x-autoresponder", "x-autoreply-from", "x-mail-autoreply"].some((n) => v(n)))
    return "auto-reply";
  if (/\b(bulk|list|junk|auto_reply)\b/.test(v("precedence") || v("x-precedence"))) return "precedence";
  if (["list-id", "list-unsubscribe", "list-post"].some((n) => h(n) !== undefined)) return "mailing-list";
  if (/\ball\b|\boof\b|autoreply/.test(v("x-auto-response-suppress"))) return "auto-reply";
  if (v("return-path") === "<>") return "null-return-path";
  if (h("x-failed-recipients") !== undefined) return "bounce";
  if (/multipart\/report/.test(v("content-type"))) return "report";
  if (/^(mailer-daemon|postmaster|bounces?|listserv|majordomo)@|^owner-|-request@/i.test(from)) return "system-sender";
  return null;
}

/** Plain text to the minimal HTML we send: escaped, paragraphs, links, direction per paragraph. */
export function textToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((p) =>
      `<p dir="auto" style="margin:0 0 1em">${escape(p)
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
        .replace(/\n/g, "<br>")}</p>`
    );
  return `<div dir="auto" style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${paragraphs.join("")}</div>`;
}

/**
 * True when the receiving server recorded that the sender failed authentication: DMARC failed,
 * or neither SPF nor DKIM passed. Such mail still becomes a ticket, but it isn't linked to the
 * customer it claims to come from and gets no automatic reply.
 */
export function senderFailedAuthentication(headers: Record<string, string> | undefined): boolean {
  const results = headers?.["authentication-results"]?.toLowerCase();
  if (!results) return false;
  if (/\bdmarc=fail\b/.test(results)) return true;
  const spfFailed = /\bspf=(fail|softfail)\b/.test(results);
  const dkimFailed = /\bdkim=(fail|none)\b/.test(results) && !/\bdkim=pass\b/.test(results);
  return spfFailed && dkimFailed;
}
