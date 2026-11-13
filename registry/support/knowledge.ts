/**
 * Where Copilot's knowledge comes from: your docs, a help center, an llms-full.txt. A source only
 * has to return articles; Tendkit syncs them into `support_knowledge` once a day and on demand.
 */

export type KnowledgeArticle = {
  /** Stable within the source, such as the file path. */
  id: string;
  title: string;
  /** Where a person reads it. Shown to agents as the draft's source. */
  url?: string | null;
  text: string;
};

export interface KnowledgeSource {
  id: string;
  load(): Promise<KnowledgeArticle[]>;
}

/**
 * Markdown or MDX files you already have, as `{ path: contents }`: read them with `fs`, or import
 * them as strings at build time where there's no file system. Titles come from frontmatter, else
 * the first heading, else the file name.
 */
export function docsFromFiles(
  files: Record<string, string>,
  options: { id?: string; /** The public URL of a file, when it has one. */ url?: (path: string) => string | null | undefined } = {}
): KnowledgeSource {
  return {
    id: options.id ?? "docs",
    async load() {
      return Object.entries(files)
        .map(([path, raw]) => {
          const { title, text } = parseMarkdown(raw);
          return { id: path, title: title ?? titleFromPath(path), url: options.url?.(path) ?? null, text };
        })
        .filter((article) => article.text);
    },
  };
}

/**
 * One text file holding all your docs, in the llms-full.txt style: every top-level `# ` heading
 * starts an article. A `Source:` or `URL:` line right under a heading becomes the article's link.
 */
export function docsFromUrl(url: string, options: { id?: string; fetch?: typeof fetch } = {}): KnowledgeSource {
  return {
    id: options.id ?? new URL(url).hostname,
    async load() {
      const response = await (options.fetch ?? fetch)(url, { headers: { accept: "text/plain, text/markdown, */*" } });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return splitOnHeadings(await response.text(), url);
    },
  };
}

/** A label in your docs' language → the same label as the customer sees it in theirs. */
export type InterfaceLabels = Record<string, string>;

/**
 * Pairs your app's translation files into the labels a customer sees, for `interfaceLabels`:
 * `labelsFromMessages(en, fr)` gives `{ "Get Verified": "Se faire vérifier", ... }`. Keys are
 * matched by path. Only short labels are kept (screens, tabs, buttons, fields): sentences,
 * placeholders like `{name}` and markup are left out, and so are strings the translation left alike.
 */
export function labelsFromMessages(
  source: unknown,
  translated: unknown,
  options: { /** Top-level namespaces to leave out, such as the marketing site or the admin. */ exclude?: string[]; maxLength?: number } = {}
): InterfaceLabels {
  const maxLength = options.maxLength ?? 48;
  const exclude = new Set(options.exclude ?? []);
  const labels: InterfaceLabels = {};
  const walk = (a: unknown, b: unknown, depth: number) => {
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return;
    for (const [key, value] of Object.entries(a as Record<string, unknown>)) {
      if (depth === 0 && exclude.has(key)) continue;
      const other = (b as Record<string, unknown>)[key];
      if (value && typeof value === "object") walk(value, other, depth + 1);
      else if (typeof value === "string" && typeof other === "string" && isLabel(value, maxLength) && isLabel(other, maxLength * 2)) {
        const from = value.trim();
        const to = other.trim();
        // The first translation wins: the same label names the same thing across screens.
        if (from.toLowerCase() !== to.toLowerCase() && !(from in labels)) labels[from] = to;
      }
    }
  };
  walk(source, translated, 0);
  return labels;
}

const isLabel = (text: string, maxLength: number) => {
  const value = text.trim();
  return value.length >= 2 && value.length <= maxLength && !/[{}<>\n]/.test(value) && !/[.!?:;…]$/.test(value) && /\p{L}/u.test(value);
};

/** Splits an llms-full.txt-style document on its top-level headings. */
export function splitOnHeadings(document: string, fallbackUrl: string | null = null): KnowledgeArticle[] {
  const sections: { title: string; lines: string[] }[] = [];
  let fenced = false;
  for (const line of document.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced ? /^# +(.+?)\s*#*$/.exec(line) : null;
    if (heading) sections.push({ title: heading[1]!.trim(), lines: [] });
    else if (sections.length) sections.at(-1)!.lines.push(line);
    else if (line.trim()) sections.push({ title: "", lines: [line] });
  }
  const seen = new Map<string, number>();
  const articles: KnowledgeArticle[] = [];
  for (const section of sections) {
    let articleUrl = fallbackUrl;
    const body = [...section.lines];
    // The link, when the file gives one in the first lines under the heading.
    for (let i = 0; i < Math.min(body.length, 4); i++) {
      const link = /^(?:source|url|link)\s*:\s*(https?:\/\/\S+)\s*$/i.exec(body[i]!.trim());
      if (link) {
        articleUrl = link[1]!;
        body.splice(i, 1);
        break;
      }
    }
    const text = tidy(body.join("\n"));
    if (!text) continue;
    const title = section.title || "Overview";
    const slug = slugify(title) || "article";
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    articles.push({ id: n > 1 ? `${slug}-${n}` : slug, title, url: articleUrl, text });
  }
  return articles;
}

/** A Markdown or MDX file as plain reading text: frontmatter, imports, exports and JSX tags removed. */
export function parseMarkdown(raw: string): { title: string | null; text: string } {
  let source = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  let title: string | null = null;
  const frontmatter = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (frontmatter) {
    source = source.slice(frontmatter[0].length);
    const line = /^title\s*:\s*(.+)$/m.exec(frontmatter[1]!);
    if (line) title = line[1]!.trim().replace(/^(["'])(.*)\1$/, "$2") || null;
  }

  const out: string[] = [];
  let fenced = false;
  let skippingStatement = false;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      out.push(line);
      continue;
    }
    if (fenced) {
      out.push(line);
      continue;
    }
    // MDX `import` and `export` statements, which may span lines until a blank one.
    if (skippingStatement) {
      if (!line.trim()) skippingStatement = false;
      continue;
    }
    if (/^(import|export)\s/.test(line)) {
      skippingStatement = !/;\s*$|from\s+["'][^"']+["']\s*$/.test(line) && !/^import\s+["']/.test(line);
      continue;
    }
    out.push(
      line
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        // JSX and HTML tags go; what they wrap stays.
        .replace(/<\/?[A-Za-z][\w.:-]*(?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|\{[^{}]*\}))?)*\s*\/?>/g, "")
    );
  }
  let text = tidy(out.join("\n"));
  // The title is stored on its own: a heading that only repeats it doesn't open the text too.
  const heading = /^# +(.+?)\s*#*(?:\n|$)/.exec(text);
  if (heading && (!title || heading[1]!.trim() === title)) {
    title = heading[1]!.trim();
    text = tidy(text.slice(heading[0].length));
  }
  return { title, text };
}

const tidy = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

function titleFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  let name = (parts.pop() ?? path).replace(/\.[a-z0-9]+$/i, "");
  if (/^(index|page|readme)$/i.test(name) && parts.length) name = parts.pop()!;
  const words = name.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : path;
}
