import { describe, expect, it } from "vitest";
import { docsFromFiles, docsFromUrl, labelsFromMessages } from "../registry/support/knowledge";

describe("docsFromFiles", () => {
  it("reads titles from frontmatter and leaves imports, exports and JSX tags out", async () => {
    const source = docsFromFiles(
      {
        "content/docs/payouts.mdx": [
          "---",
          'title: "Payout timing"',
          "description: When money arrives",
          "---",
          "",
          'import { Callout } from "@/components/callout";',
          "import {",
          "  Steps,",
          '} from "@/components/steps";',
          "",
          "export const meta = { order: 2 };",
          "",
          "# Payout timing",
          "",
          '<Callout type="warning" icon={<Icon />}>',
          "  Payouts take **3 business days**.",
          "</Callout>",
          "",
          "{/* internal: check with finance */}",
          "Run this to check:",
          "",
          "```tsx",
          'import { payouts } from "acme";',
          "<Payouts />",
          "```",
        ].join("\n"),
      },
      { url: (path) => `https://acme.test/${path.replace(/^content\/|\.mdx$/g, "")}` }
    );
    const [article] = await source.load();
    expect(source.id).toBe("docs");
    expect(article).toMatchObject({ id: "content/docs/payouts.mdx", title: "Payout timing", url: "https://acme.test/docs/payouts" });
    expect(article!.text).toBe(
      ["Payouts take **3 business days**.", "", "Run this to check:", "", "```tsx", 'import { payouts } from "acme";', "<Payouts />", "```"].join("\n")
    );
  });

  it("falls back to the first heading, then the file name, and skips empty files", async () => {
    const articles = await docsFromFiles({
      "docs/refunds.md": "# How refunds work\n\nRefunds go back to the card.",
      "docs/getting-started/index.md": "Install the app, then sign in.",
      "docs/empty.md": "---\ntitle: Empty\n---\n",
    }).load();
    expect(articles.map((a) => [a.title, a.text])).toEqual([
      ["How refunds work", "Refunds go back to the card."],
      ["Getting started", "Install the app, then sign in."],
    ]);
  });
});

describe("docsFromUrl", () => {
  const file = [
    "# Payouts",
    "Source: https://acme.test/docs/payouts",
    "",
    "Payouts take 3 business days.",
    "",
    "## Weekends",
    "They don't count.",
    "",
    "```bash",
    "# not a heading",
    "acme payouts list",
    "```",
    "",
    "# Refunds",
    "",
    "Refunds go back to the card.",
    "",
    "# Refunds",
    "",
    "Partial refunds are allowed.",
    "",
    "# Empty section",
  ].join("\n");

  it("splits an llms-full.txt file on top-level headings only", async () => {
    const source = docsFromUrl("https://acme.test/llms-full.txt", {
      fetch: (async () => new Response(file)) as unknown as typeof fetch,
    });
    const articles = await source.load();
    expect(source.id).toBe("acme.test");
    expect(articles.map((a) => [a.id, a.title, a.url])).toEqual([
      ["payouts", "Payouts", "https://acme.test/docs/payouts"],
      ["refunds", "Refunds", "https://acme.test/llms-full.txt"],
      ["refunds-2", "Refunds", "https://acme.test/llms-full.txt"],
    ]);
    expect(articles[0]!.text).toContain("## Weekends");
    expect(articles[0]!.text).toContain("# not a heading");
    expect(articles[0]!.text).not.toContain("Source:");
  });

  it("fails loudly when the file can't be fetched, so the stored articles are kept", async () => {
    const source = docsFromUrl("https://acme.test/llms-full.txt", {
      fetch: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    });
    await expect(source.load()).rejects.toThrow("503");
  });
});

describe("labelsFromMessages", () => {
  it("pairs short labels by key, leaving out sentences, placeholders, untranslated strings and excluded namespaces", () => {
    const en = {
      console: { verify: "Get Verified", title: "Verification", intro: "Fill in the form below.", hello: "Hi {name}", same: "API", nested: { payout: "Payout settings" } },
      marketing: { cta: "Start now" },
    };
    const fr = {
      console: { verify: "Se faire vérifier", title: "Vérification", intro: "Remplissez le formulaire.", hello: "Bonjour {name}", same: "API", nested: { payout: "Paramètres de versement" } },
      marketing: { cta: "Commencer" },
    };
    expect(labelsFromMessages(en, fr, { exclude: ["marketing"] })).toEqual({
      "Get Verified": "Se faire vérifier",
      Verification: "Vérification",
      "Payout settings": "Paramètres de versement",
    });
  });
});
