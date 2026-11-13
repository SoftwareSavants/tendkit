"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  Building2,
  ChevronsUpDown,
  CircleCheck,
  Clock,
  Coffee,
  CreditCard,
  Home,
  Inbox,
  LifeBuoy,
  Package,
  PanelLeft,
  Plus,
  Settings,
  ShieldAlert,
  Sparkles,
  User,
  UserX,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSupport } from "@/registry/support-ui/provider";
import { cn } from "@/lib/utils";

/*
 * Stand-ins for "your app" around the Tendkit screens: an admin app for agents (shaped like
 * shadcn's dashboard block) and a customer-facing app for the portal.
 */

type NavItem = { label: string; href: string; icon: typeof Inbox; count?: number; active: boolean };

function Sidebar({ brand, brandIcon: BrandIcon, sub, primary, groups, user }: {
  brand: string;
  brandIcon: typeof Inbox;
  sub: string;
  primary?: React.ReactNode;
  groups: { title?: string; items: NavItem[] }[];
  user: { name: string; email: string };
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-4 border-e bg-muted/30 p-3 md:flex">
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <BrandIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{brand}</p>
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        </div>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </div>
      {primary}
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {groups.map((g, i) => (
          <div key={i}>
            {g.title && <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">{g.title}</p>}
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent",
                      item.active ? "bg-accent font-medium text-foreground" : "text-foreground/80"
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.count !== undefined && item.count > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">{item.count}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
        <Avatar className="size-8 rounded-lg">
          <AvatarFallback className="rounded-lg text-xs">
            {user.name
              .split(" ")
              .map((p) => p[0])
              .join("")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>
    </aside>
  );
}

function Header({ trail }: { trail: string[] }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <PanelLeft className="size-4 text-muted-foreground" />
      <Separator orientation="vertical" className="mx-1.5 h-4!" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        {trail.map((t, i) => (
          <span key={i} className={cn("truncate", i === trail.length - 1 ? "font-medium" : "text-muted-foreground")}>
            {i > 0 && <span className="me-1.5 text-muted-foreground">/</span>}
            {t}
          </span>
        ))}
      </nav>
    </header>
  );
}

/** The agent side: your admin app with Support in its sidebar. */
export function AgentShell({ children, title }: { children: React.ReactNode; title: string }) {
  const { client } = useSupport();
  const params = useSearchParams();
  const counts = useQuery({ queryKey: ["support", "counts"], queryFn: () => client.counts() });
  const status = params.get("status") ?? "open";
  const assignee = params.get("assignee");
  const onAi = params.get("screen") === "ai";
  const onInsights = params.get("screen") === "insights";
  const onTicket = params.has("ticket") || onAi || onInsights;
  const view = (s: string, a?: string) => !onTicket && status === s && (a ? assignee === a : !assignee);
  const c = counts.data;

  return (
    <div className="flex h-svh bg-background">
      <Sidebar
        brand="Acme Inc."
        brandIcon={Building2}
        sub="Admin"
        primary={
          <Button size="sm" className="w-full justify-start gap-2">
            <Plus />
            New ticket
          </Button>
        }
        groups={[
          {
            title: "Support",
            items: [
              { label: "Inbox", href: "/demo-frame", icon: Inbox, count: c?.open, active: view("open") },
              { label: "Assigned to me", href: "/demo-frame?assignee=me", icon: User, count: c?.mine, active: view("open", "me") },
              { label: "Unassigned", href: "/demo-frame?assignee=none", icon: UserX, count: c?.unassigned, active: view("open", "none") },
              { label: "Waiting on customer", href: "/demo-frame?status=waiting", icon: Clock, count: c?.waiting, active: view("waiting") },
              { label: "Solved", href: "/demo-frame?status=solved", icon: CircleCheck, active: view("solved") },
              { label: "Spam", href: "/demo-frame?status=spam", icon: ShieldAlert, active: view("spam") },
              { label: "Insights", href: "/demo-frame?screen=insights", icon: BarChart3, active: onInsights },
              { label: "AI", href: "/demo-frame?screen=ai", icon: Sparkles, active: onAi },
            ],
          },
          {
            title: "Workspace",
            items: [
              { label: "Customers", href: "#", icon: Users, active: false },
              { label: "Settings", href: "#", icon: Settings, active: false },
            ],
          },
        ]}
        user={{ name: "Alex Chen", email: "alex@acme.com" }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header trail={["Support", title]} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

/** The customer side: the product your customers use, with Support in its sidebar. */
export function CustomerShell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="flex h-svh bg-background">
      <Sidebar
        brand="Acme"
        brandIcon={Coffee}
        sub="Northwind Coffee"
        groups={[
          {
            items: [
              { label: "Home", href: "#", icon: Home, active: false },
              { label: "Orders", href: "#", icon: Package, active: false },
              { label: "Billing", href: "#", icon: CreditCard, active: false },
              { label: "Support", href: "/demo-frame?screen=portal", icon: LifeBuoy, active: true },
            ],
          },
        ]}
        user={{ name: "Emma Clarke", email: "emma@northwind.coffee" }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header trail={title ? ["Support", title] : ["Support"]} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
