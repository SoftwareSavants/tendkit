import { describe, expect, it } from "vitest";
import { htmlToText, quotedMessage, signatureFromHtml, visibleReply, withoutSignature } from "../registry/support/text";

/** What Outlook on the web sends for a reply: body, signature div, then the quoted message. */
const outlookWebHtml = `<html><head><style>p{margin:0}</style></head><body dir="ltr">
<div class="elementToProof" style="font-family: Aptos, sans-serif;">Got it, thanks! This answer should land back in the same ticket.</div>
<div class="elementToProof"><br></div>
<div id="Signature" class="elementToProof"><div><p>Daniel Kim</p><p>Support lead, <b>Acme</b></p></div></div>
<div id="appendonsend"></div>
<hr style="display:inline-block;width:98%" tabindex="-1">
<div id="divRplyFwdMsg" dir="ltr"><b>From:</b> Acme Support &lt;support@acme.test&gt;<br><b>Sent:</b> Sunday, November 8, 2026 4:33 PM<br><b>To:</b> Daniel Kim<br><b>Subject:</b> Re: Test</div>
<div>Confirmed, the support inbox works.</div></body></html>`;

/** The plain-text part Outlook sends alongside it. */
const outlookWebText = `Got it, thanks! This answer should land back in the same ticket.

Daniel Kim

Support lead, Acme

________________________________
From: Acme Support <support@acme.test>
Sent: Sunday, November 8, 2026 4:33 PM
To: Daniel Kim
Subject: Re: Test

Confirmed, the support inbox works.`;

describe("visibleReply", () => {
  it("drops the separator line Outlook puts above the quoted header", () => {
    expect(visibleReply(outlookWebText)).toBe("Got it, thanks! This answer should land back in the same ticket.\n\nDaniel Kim\n\nSupport lead, Acme");
  });

  it("keeps separator lines that are part of what the person wrote", () => {
    expect(visibleReply("Totals\n-----\n$12")).toBe("Totals\n-----\n$12");
  });
});

describe("signatures", () => {
  it("finds the Outlook signature and removes it from the reply", () => {
    const signature = signatureFromHtml(outlookWebHtml);
    expect(signature).toBe("Daniel Kim\nSupport lead, Acme");
    expect(withoutSignature(visibleReply(outlookWebText), signature)).toBe(
      "Got it, thanks! This answer should land back in the same ticket."
    );
  });

  it("finds Gmail and Outlook mobile signatures", () => {
    expect(
      signatureFromHtml(
        `<div dir="ltr">Merci</div><br><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><div>Emma Clarke</div><div>Northwind Coffee</div></div>`
      )
    ).toBe("Emma Clarke\nNorthwind Coffee");
    expect(signatureFromHtml(`<div>شكرا</div><div id="ms-outlook-mobile-signature"><div>Get Outlook for iOS</div></div>`)).toBe(
      "Get Outlook for iOS"
    );
  });

  it("only removes the signature from the end, ignoring spacing differences", () => {
    expect(withoutSignature("Call me back\n\n  Emma   Clarke\n\nNorthwind Coffee  ", "Emma Clarke\nNorthwind Coffee")).toBe("Call me back");
    expect(withoutSignature("Emma Clarke here. Northwind Coffee needs help.", "Emma Clarke\nNorthwind Coffee")).toBe(
      "Emma Clarke here. Northwind Coffee needs help."
    );
  });

  it("keeps the message when it is nothing but the signature", () => {
    expect(withoutSignature("Emma Clarke\nNorthwind Coffee", "Emma Clarke\nNorthwind Coffee")).toBe("Emma Clarke\nNorthwind Coffee");
  });

  it("ignores a signature nested inside the quoted message", () => {
    expect(signatureFromHtml(`<div>New text</div><blockquote><div id="Signature">Old signature</div></blockquote>`)).toBeNull();
  });

  it("returns null without a marked signature", () => {
    expect(signatureFromHtml("<p>Hello</p>")).toBeNull();
    expect(signatureFromHtml(null)).toBeNull();
  });
});

describe("htmlToText", () => {
  it("keeps the signature text so the trimmed reply can be compared against it", () => {
    expect(htmlToText(outlookWebHtml)).toContain("Support lead, Acme");
  });
});

describe("quotedMessage", () => {
  it("reads Outlook's header block, in French too", () => {
    const quote = quotedMessage(
      ["Je transmets à l'équipe.", "", "De : Emma Clarke <emma@northwind.test>", "Envoyé : lundi 2 novembre 2026 16:23", "À : Daniel Kim <daniel@acme.test>", "Objet : Virement", "", "Bonjour,", "", "Le virement n'est pas arrivé."].join("\n")
    );
    expect(quote).toMatchObject({
      from: { address: "emma@northwind.test", name: "Emma Clarke" },
      text: "Bonjour,\n\nLe virement n'est pas arrivé.",
      before: "Je transmets à l'équipe.",
    });
  });

  it("reads Gmail's attribution, wrapped onto two lines, and unquotes the body", () => {
    const quote = quotedMessage(
      ["Looping in support.", "", "On Mon, Nov 2, 2026 at 4:23 PM Emma Clarke <emma@northwind.test>", "wrote:", "", "> Where is my payout?", ">", "> Emma"].join("\n")
    );
    expect(quote).toMatchObject({ from: { address: "emma@northwind.test", name: "Emma Clarke" }, text: "Where is my payout?\n\nEmma" });
    expect(quote!.sentAt?.toISOString()).toBe(new Date("Mon, Nov 2, 2026 4:23 PM").toISOString());
  });

  it("reads Apple Mail's forward and keeps only the newest quoted email", () => {
    const quote = quotedMessage(
      [
        "Begin forwarded message:",
        "",
        "From: Lucas Martin <lucas@lumen.test>",
        "Subject: Invoice",
        "Date: 2 November 2026 at 10:15:00 GMT",
        "To: Priya <priya@acme.test>",
        "",
        "Still waiting on this.",
        "",
        "On Fri, Oct 30, 2026 at 9:00 AM Priya <priya@acme.test> wrote:",
        "> We'll send it Monday.",
      ].join("\n")
    );
    expect(quote).toMatchObject({ from: { address: "lucas@lumen.test" }, text: "Still waiting on this.", before: "" });
  });

  it("returns null without a quote, or when the quoted sender has no address", () => {
    expect(quotedMessage("Just a question about payouts.")).toBeNull();
    expect(quotedMessage(outlookWebText)).toMatchObject({ from: { address: "support@acme.test" } });
    expect(quotedMessage("Hi\n\nFrom: Daniel Kim\nSent: Monday\nTo: Emma\nSubject: Hi\n\nBody")).toBeNull();
  });
});
