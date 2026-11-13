import type { DateLike, Identity } from "./client";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Latin digits in Arabic: that's what most Arabic-speaking product UIs show for times and amounts.
const intlLocale = (locale: string) => (locale.startsWith("ar") ? `${locale}-u-nu-latn` : locale);

const toDate = (value: DateLike) => (value instanceof Date ? value : new Date(value));

/** "12 min", "3 h", "2 days": how long someone has been waiting. */
export function formatDuration(from: DateLike, locale: string, now = Date.now()) {
  const ms = Math.max(0, now - toDate(from).getTime());
  const format = (value: number, unit: "minute" | "hour" | "day") =>
    new Intl.NumberFormat(intlLocale(locale), { style: "unit", unit, unitDisplay: "short" }).format(value);
  if (ms < HOUR) return format(Math.max(1, Math.floor(ms / MINUTE)), "minute");
  if (ms < DAY) return format(Math.floor(ms / HOUR), "hour");
  return format(Math.floor(ms / DAY), "day");
}

/** "09:31" today, "Oct 18" this year, "Oct 18, 2025" before. */
export function formatWhen(value: DateLike, locale: string, now = new Date()) {
  const date = toDate(value);
  const l = intlLocale(locale);
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(l, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString(l, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** "Oct 18, 09:31": the full timestamp on a message. */
export function formatTimestamp(value: DateLike, locale: string) {
  return toDate(value).toLocaleString(intlLocale(locale), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** How urgent a wait is against the response target: amber from 75%, red past it. */
export function waitLevel(since: DateLike, targetMinutes: number, now = Date.now()): "normal" | "soon" | "late" {
  const ratio = (now - toDate(since).getTime()) / (targetMinutes * MINUTE);
  return ratio >= 1 ? "late" : ratio >= 0.75 ? "soon" : "normal";
}

export function formatBytes(bytes: number, locale: string) {
  const units = ["byte", "kilobyte", "megabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit ? 1 : 0,
  }).format(value);
}

/** The best way to show who a contact is: their name, else their email or number. */
export function contactLabel(contact: { name: string | null; identities: Identity[] }) {
  return contact.name || contact.identities[0]?.value || "";
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

/**
 * An approved answer, ready for this ticket: {name}, {company} and {agent} become the customer's
 * first name, their company and the agent's first name. A placeholder with nothing to fill it is
 * taken out with the space before it, so "Hi {name}," becomes "Hi,".
 */
export function fillPlaceholders(text: string, values: { name?: string | null; company?: string | null; agent?: string | null }) {
  return text.replace(/([ \t]*)\{(name|company|agent)\}/g, (_, space: string, key: "name" | "company" | "agent") => {
    const value = values[key]?.trim();
    return value ? `${space}${value}` : "";
  });
}

/** A Markdown article as the plain text a reply is written in: headings, emphasis and link syntax removed. */
export function markdownToText(markdown: string) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^[ \t]*[*+]\s+/gm, "- ")
    .replace(/^>\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
