/** The demo's screen props, shared between /demo (the controls) and /demo-frame (the app). */
export type DemoSettings = { responseTargetMinutes: number; accountPanel: boolean };
export const DEFAULT_SETTINGS: DemoSettings = { responseTargetMinutes: 240, accountPanel: false };
export const RESPONSE_TARGETS = [
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "1 day" },
] as const;

export type Screen = "inbox" | "ticket" | "portal";

/** Messages between the demo page and its frame. */
export type ToFrame = { source: "tendkit-demo"; screen?: Screen; settings?: DemoSettings };
export type FromFrame = { source: "tendkit-frame"; screen?: Screen; ready?: boolean };
