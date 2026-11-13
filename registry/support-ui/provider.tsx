"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DateLike, SupportClient, SupportPortalClient, TicketDetail } from "./client";
import en from "./messages/en.json";

type Values = Record<string, string | number>;
export type Translate = (key: string, values?: Values) => string;

/** English defaults, for apps without an i18n library. With next-intl, pass useTranslations("support"). */
export function createTranslator(messages: Record<string, unknown> = en): Translate {
  return (key, values) => {
    const template = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
    if (typeof template !== "string") return key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  };
}

type SupportContextValue = {
  client: SupportClient;
  t: Translate;
  locale: string;
  /**
   * The language voice listens in, when the browser does the listening. Speech recognition wants
   * a region ("fr-FR") where a UI locale is often bare ("fr"). Defaults to `locale`.
   */
  speechLocale: string;
  /** The signed-in agent. */
  viewerId: string;
  ticketHref: (id: string) => string;
  inboxHref: string;
  /** Where `SupportAiSettings` is mounted, so Insights can link a gap to the list it is in. */
  aiSettingsHref?: string;
  /** Your product's view of the customer next to a ticket: their account, orders, payments… */
  customerPanel?: (detail: TicketDetail) => ReactNode;
  /** Minutes a customer may wait before "Waiting" turns red. Amber from three quarters of it. */
  responseTargetMinutes: number;
};

const SupportContext = createContext<SupportContextValue | null>(null);

export function SupportProvider({
  children,
  t = createTranslator(),
  locale = "en",
  speechLocale = locale,
  responseTargetMinutes = 240,
  ...value
}: Omit<SupportContextValue, "t" | "locale" | "speechLocale" | "responseTargetMinutes"> & {
  t?: Translate;
  locale?: string;
  speechLocale?: string;
  responseTargetMinutes?: number;
  children: ReactNode;
}) {
  return (
    <SupportContext.Provider value={{ ...value, t, locale, speechLocale, responseTargetMinutes }}>{children}</SupportContext.Provider>
  );
}

export function useSupport() {
  const value = useContext(SupportContext);
  if (!value) throw new Error("Wrap support screens in <SupportProvider>.");
  return value;
}

type PortalContextValue = { client: SupportPortalClient; t: Translate; locale: string; requestHref: (id: string) => string; listHref: string };

const PortalContext = createContext<PortalContextValue | null>(null);

export function SupportPortalProvider({
  children,
  t = createTranslator(),
  locale = "en",
  ...value
}: Omit<PortalContextValue, "t" | "locale"> & { t?: Translate; locale?: string; children: ReactNode }) {
  return <PortalContext.Provider value={{ ...value, t, locale }}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const value = useContext(PortalContext);
  if (!value) throw new Error("Wrap customer support screens in <SupportPortalProvider>.");
  return value;
}

export const toDate = (value: DateLike) => (value instanceof Date ? value : new Date(value));
