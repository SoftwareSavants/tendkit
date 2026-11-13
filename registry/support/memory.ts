/**
 * The parts of Copilot's memory that need no model and no database: finding the words of a
 * question, measuring how much an agent changed a draft, and keeping customer details out of
 * what one customer's ticket teaches the drafts of another.
 */

const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The distinct words a question is found by: four letters or more, which leaves most filler out in most languages. */
export function searchTerms(text: string, max = 40): string[] {
  const terms = new Set<string>();
  for (const word of wordsOf(text)) {
    if (word.length < 4 || word.length > 40 || /^\d+$/.test(word)) continue;
    terms.add(word);
    if (terms.size >= max) break;
  }
  return [...terms];
}

/** How many of `terms` a text holds. */
export function sharedTerms(terms: string[], text: string) {
  const held = new Set(wordsOf(text));
  return terms.reduce((n, term) => n + (held.has(term) ? 1 : 0), 0);
}

/** 0 when the agent sent the draft as it was, 1 when nothing of it was left: the share of words that changed. */
export function changeRatio(draft: string, sent: string) {
  const a = wordsOf(draft).slice(0, 600);
  const b = wordsOf(sent).slice(0, 600);
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  // Longest common subsequence, one row at a time.
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) row[j] = word === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, row[j - 1]!);
    previous = row;
  }
  return Math.round((1 - previous[b.length]! / longest) * 100) / 100;
}

/**
 * A lesson drawn from one customer's ticket may shape another customer's draft, so it must say
 * nothing about the first one. The model is asked for that; this checks it. A lesson is dropped
 * (returned as "") when it holds a digit, an address or a link, one of the names on the ticket,
 * or five words in a row from the conversation it came from. Losing a lesson is cheap; leaking
 * one customer's details into another's reply is not.
 */
export function safeLesson(lesson: string, from: { texts: string[]; names: string[] }): string {
  const text = lesson.replace(/\s+/g, " ").trim();
  if (!text || text.length > 240 || /^none\b/i.test(text)) return "";
  if (/\d|@|https?:|www\./i.test(text)) return "";
  const said = wordsOf(text);
  const held = new Set(said);
  for (const name of from.names) {
    for (const part of wordsOf(name)) if (part.length >= 3 && held.has(part)) return "";
  }
  const runs = new Set<string>();
  for (let i = 0; i + 5 <= said.length; i++) runs.add(said.slice(i, i + 5).join(" "));
  for (const source of from.texts) {
    const words = wordsOf(source);
    for (let i = 0; i + 5 <= words.length; i++) if (runs.has(words.slice(i, i + 5).join(" "))) return "";
  }
  return text;
}

/** Puts {name} and {company} where an approved answer still names the customer it was written for. */
export function maskNames(text: string, names: { name?: string | null; company?: string | null }) {
  let masked = text;
  for (const [value, placeholder] of [
    [names.company?.trim(), "{company}"],
    [names.name?.trim().split(/\s+/)[0], "{name}"],
  ] as const) {
    if (!value || value.length < 2) continue;
    const pattern = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    masked = masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"), placeholder);
  }
  return masked;
}

export function cosine(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
