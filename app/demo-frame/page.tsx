"use client";

import { Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SupportPortalProvider, SupportProvider } from "@/registry/support-ui/provider";
import { SupportInbox } from "@/registry/support-ui/support-inbox";
import { SupportInsights } from "@/registry/support-ui/support-insights";
import { SupportRequest, SupportRequests } from "@/registry/support-ui/support-requests";
import { SupportTicket } from "@/registry/support-ui/support-ticket";
import { SupportAiSettings } from "@/registry/support-ui/support-ai-settings";
import { VIEWER, createDemoClients } from "@/site/demo-client";
import { AccountPanel } from "@/site/demo/account-panel";
import { AgentShell, CustomerShell } from "@/site/demo/app-shell";
import { DEFAULT_SETTINGS, type DemoSettings, type FromFrame, type Screen, type ToFrame } from "@/site/demo/settings";
import { syncThemeFromStorage } from "@/site/theme";

export default function DemoFrame() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <App />
      </Suspense>
    </QueryClientProvider>
  );
}

function App() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const [settings, setSettings] = useState<DemoSettings>(DEFAULT_SETTINGS);
  const [clients] = useState(() =>
    createDemoClients(() => {
      void queryClient.invalidateQueries({ queryKey: ["support"] });
      void queryClient.invalidateQueries({ queryKey: ["support-portal"] });
    })
  );

  const screen: Screen = params.get("screen") === "portal" ? "portal" : params.get("screen") === "insights" ? "insights" : params.has("ticket") ? "ticket" : "inbox";

  // Theme changes made on the demo page reach this frame through storage events.
  useEffect(() => {
    const onStorage = () => syncThemeFromStorage();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // The demo page switches screens and props; tell it where we are.
  useEffect(() => {
    const onMessage = (e: MessageEvent<ToFrame>) => {
      if (e.origin !== window.location.origin || e.data?.source !== "tendkit-demo") return;
      if (e.data.settings) setSettings(e.data.settings);
      if (e.data.screen === "inbox") router.replace("/demo-frame");
      if (e.data.screen === "ticket") router.replace("/demo-frame?ticket=tkt_1");
      if (e.data.screen === "insights") router.replace("/demo-frame?screen=insights");
      if (e.data.screen === "portal") router.replace("/demo-frame?screen=portal");
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ source: "tendkit-frame", ready: true } satisfies FromFrame, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  useEffect(() => {
    window.parent.postMessage({ source: "tendkit-frame", screen } satisfies FromFrame, window.location.origin);
  }, [screen]);

  if (screen === "portal") return <Portal clients={clients} />;

  const ticketId = params.get("ticket");
  const aiSettings = params.get("screen") === "ai";
  const insights = screen === "insights";
  return (
    <SupportProvider
      client={clients.agent}
      viewerId={VIEWER.id}
      inboxHref="/demo-frame"
      aiSettingsHref="/demo-frame?screen=ai"
      ticketHref={(id) => `/demo-frame?ticket=${id}`}
      responseTargetMinutes={settings.responseTargetMinutes}
      customerPanel={settings.accountPanel ? (detail) => (detail.customer ? <AccountPanel detail={detail} /> : null) : undefined}
    >
      <AgentShell title={insights ? "Insights" : aiSettings ? "AI" : ticketId ? "Ticket" : "Inbox"}>
        {insights ? (
          <div className="space-y-5">
            <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
            <SupportInsights />
          </div>
        ) : aiSettings ? (
          <div className="space-y-5">
            <h1 className="text-2xl font-semibold tracking-tight">AI</h1>
            <SupportAiSettings />
          </div>
        ) : ticketId ? (
          <SupportTicket key={ticketId} ticketId={ticketId} />
        ) : (
          <SupportInbox />
        )}
      </AgentShell>
    </SupportProvider>
  );
}

function Portal({ clients }: { clients: ReturnType<typeof createDemoClients> }) {
  const params = useSearchParams();
  const request = params.get("request");
  const [open, setOpen] = useState(false);
  return (
    <SupportPortalProvider
      client={clients.portal}
      listHref="/demo-frame?screen=portal"
      requestHref={(id) => `/demo-frame?screen=portal&request=${id}`}
    >
      <CustomerShell title={request ? "Request" : undefined}>
        {request ? (
          <SupportRequest key={request} id={request} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.02em]">Support</h1>
                <p className="mt-1 text-sm text-muted-foreground">Your requests to Acme, and our replies.</p>
              </div>
              <Button onClick={() => setOpen(true)}>
                <Plus />
                New request
              </Button>
            </div>
            <SupportRequests newRequestOpen={open} onNewRequestOpenChange={setOpen} />
          </div>
        )}
      </CustomerShell>
    </SupportPortalProvider>
  );
}
