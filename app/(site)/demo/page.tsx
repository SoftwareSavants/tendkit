"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Monitor, RotateCw, Smartphone, Tablet, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { DEFAULT_SETTINGS, RESPONSE_TARGETS, type DemoSettings, type FromFrame, type Screen, type ToFrame } from "@/site/demo/settings";
import { COLORS, DEFAULT_THEME, FONTS, MODES, RADII, themeCss } from "@/site/theme-config";
import { setTheme, useTheme } from "@/site/theme";

const SCREENS: { id: Screen; label: string; description: string }[] = [
  { id: "inbox", label: "Inbox", description: "The shared inbox: what needs an answer, longest wait first." },
  { id: "ticket", label: "Ticket", description: "A conversation with the customer's account beside it. Reply and they write back." },
  { id: "insights", label: "Insights", description: "How support is going and what customers struggle with. Today's payout spike is at the top." },
  { id: "portal", label: "Portal", description: "What your customers see. Open a request here and it lands in the inbox." },
];

const VIEWPORTS = [
  { id: "desktop", label: "Desktop", icon: Monitor, width: "100%" },
  { id: "tablet", label: "Tablet", icon: Tablet, width: "820px" },
  { id: "mobile", label: "Phone", icon: Smartphone, width: "390px" },
] as const;

export default function DemoPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [screen, setScreen] = useState<Screen>("inbox");
  const [viewport, setViewport] = useState<(typeof VIEWPORTS)[number]["id"]>("desktop");
  const [frameKey, setFrameKey] = useState(0);
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_SETTINGS);
  const [codeOpen, setCodeOpen] = useState(false);

  const send = (message: Omit<ToFrame, "source">) =>
    frame.current?.contentWindow?.postMessage({ source: "tendkit-demo", ...message } satisfies ToFrame, window.location.origin);

  // The frame reports which screen it's on (its own links can change it) and when it's ready.
  useEffect(() => {
    const onMessage = (e: MessageEvent<FromFrame>) => {
      if (e.origin !== window.location.origin || e.data?.source !== "tendkit-frame") return;
      if (e.data.ready) send({ settings });
      if (e.data.screen) setScreen(e.data.screen);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settings are sent on change below
  }, [settings]);

  const updateSettings = (patch: Partial<DemoSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    send({ settings: next });
  };

  const width = VIEWPORTS.find((v) => v.id === viewport)!.width;
  const current = SCREENS.find((s) => s.id === screen)!;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-[-0.025em]">Live demo</h1>
        <p className="mt-2 text-muted-foreground">
          The real Tendkit screens inside an example app, running in your browser with sample data. Nothing is sent, and a
          reload starts over.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Screen">
              {SCREENS.map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={screen === s.id}
                  onClick={() => {
                    setScreen(s.id);
                    send({ screen: s.id });
                  }}
                  className={cn(
                    "h-7 rounded-md px-3 text-sm font-medium transition-colors",
                    screen === s.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground lg:block">{current.description}</p>
            <div className="ms-auto flex items-center gap-2">
              <div className="hidden items-center gap-0.5 rounded-lg border p-0.5 sm:flex" role="group" aria-label="Preview width">
                {VIEWPORTS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setViewport(v.id)}
                    aria-pressed={viewport === v.id}
                    aria-label={v.label}
                    title={v.label}
                    className={cn(
                      "grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground",
                      viewport === v.id && "bg-accent text-foreground"
                    )}
                  >
                    <v.icon className="size-4" />
                  </button>
                ))}
                <Separator orientation="vertical" className="mx-0.5 h-4!" />
                <button
                  onClick={() => {
                    setFrameKey((k) => k + 1);
                    setScreen("inbox");
                  }}
                  aria-label="Start over"
                  title="Start over"
                  className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  <RotateCw className="size-4" />
                </button>
              </div>
              <InstallChip />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-muted/40">
            <iframe
              key={frameKey}
              ref={frame}
              src="/demo-frame"
              title="Tendkit demo app"
              style={{ width }}
              className={cn(
                "mx-auto block h-[min(820px,80svh)] min-h-[560px] max-w-full bg-background transition-[width] duration-300 ease-out",
                viewport !== "desktop" && "border-x"
              )}
            />
          </div>
        </div>

        <Customize settings={settings} onSettings={updateSettings} onCode={() => setCodeOpen(true)} />
      </div>

      <CodeDialog open={codeOpen} onOpenChange={setCodeOpen} settings={settings} />
    </div>
  );
}

/** The right sidebar, like shadcn/create: every knob a Tendkit integration has. */
function Customize({
  settings,
  onSettings,
  onCode,
}: {
  settings: DemoSettings;
  onSettings: (s: Partial<DemoSettings>) => void;
  onCode: () => void;
}) {
  const theme = useTheme();
  return (
    <aside className="h-fit space-y-5 rounded-xl border bg-card p-4 xl:sticky xl:top-20">
      <div>
        <p className="font-semibold">Customize</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Your theme and the screens&apos; props.</p>
      </div>

      <Field label="Color">
        <div className="grid grid-cols-2 gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c.id}
              onClick={() => setTheme({ color: c.id })}
              aria-pressed={theme.color === c.id}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md border px-2 text-sm",
                theme.color === c.id ? "border-foreground/60 bg-accent font-medium" : "hover:bg-accent"
              )}
            >
              <span className="size-3.5 rounded-full" style={{ background: c.swatch }} />
              {c.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Radius">
        <Segmented
          value={theme.radius}
          options={RADII.map((r) => ({ id: r, label: r }))}
          onChange={(radius) => setTheme({ radius: radius as typeof theme.radius })}
        />
      </Field>

      <Field label="Font">
        <Segmented
          value={theme.font}
          options={FONTS.map((f) => ({ id: f.id, label: f.label }))}
          onChange={(font) => setTheme({ font: font as typeof theme.font })}
        />
      </Field>

      <Field label="Mode">
        <Segmented
          value={theme.mode}
          options={MODES.map((m) => ({ id: m, label: m[0]!.toUpperCase() + m.slice(1) }))}
          onChange={(mode) => setTheme({ mode: mode as typeof theme.mode })}
        />
      </Field>

      <Separator />

      <Field label="Response target" hint="responseTargetMinutes: when a customer's wait turns red.">
        <Segmented
          value={String(settings.responseTargetMinutes)}
          options={RESPONSE_TARGETS.map((r) => ({ id: String(r.minutes), label: r.label }))}
          onChange={(v) => onSettings({ responseTargetMinutes: Number(v) })}
        />
      </Field>

      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="account-panel">Account panel</Label>
          <p className="mt-1 text-xs text-muted-foreground">customerPanel: your own component next to each ticket.</p>
        </div>
        <Switch id="account-panel" checked={settings.accountPanel} onCheckedChange={(v) => onSettings({ accountPanel: v })} />
      </div>

      <div className="grid gap-2 pt-1">
        <Button onClick={onCode}>Get the code</Button>
        <Button
          variant="ghost"
          onClick={() => {
            setTheme(DEFAULT_THEME);
            onSettings(DEFAULT_SETTINGS);
          }}
        >
          Reset
        </Button>
      </div>
    </aside>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  return (
    <div className="flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cn(
            "h-7 min-w-0 flex-1 truncate rounded-md px-1.5 text-xs font-medium",
            value === o.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function InstallChip() {
  const command = "npx shadcn@latest add @tendkit/support-ui";
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(command);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className="hidden h-8 items-center gap-2 rounded-lg border px-2.5 font-mono text-xs hover:bg-accent md:flex"
      title="Copy install command"
    >
      {copied ? <Check className="size-3.5" /> : <Terminal className="size-3.5" />}
      {copied ? "Copied" : "npx shadcn add @tendkit/support-ui"}
    </button>
  );
}

/** The CSS and provider props for what the visitor picked. */
function CodeDialog({ open, onOpenChange, settings }: { open: boolean; onOpenChange: (open: boolean) => void; settings: DemoSettings }) {
  const theme = useTheme();
  const props = `<SupportProvider
  client={supportClient}
  viewerId={user.id}
  inboxHref="/admin/support"
  ticketHref={(id) => \`/admin/support/\${id}\`}${settings.responseTargetMinutes !== 240 ? `\n  responseTargetMinutes={${settings.responseTargetMinutes}}` : ""}${
    settings.accountPanel ? "\n  customerPanel={(detail) => <AccountPanel id={detail.customer?.id} />}" : ""
  }
>
  <SupportInbox />
</SupportProvider>`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Your setup</DialogTitle>
          <DialogDescription>
            Your theme in CSS, and the provider props you picked. See{" "}
            <Link href="/docs/theming" className="underline">
              Theming
            </Link>{" "}
            and{" "}
            <Link href="/docs/screens" className="underline">
              Inbox and tickets
            </Link>
            .
          </DialogDescription>
        </DialogHeader>
        <Snippet title="app/globals.css" code={themeCss(theme)} />
        <Snippet title="app/admin/support/page.tsx" code={props} />
      </DialogContent>
    </Dialog>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{title}</span>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre dir="ltr" className="max-h-64 overflow-auto p-3 font-mono text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  );
}
