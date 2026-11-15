import { useSyncExternalStore } from "react";
import { api, type Status } from "@/lib/api";

// ── tiny persisted stores ────────────────────────────────────────────────

function persisted<T extends string>(key: string, initial: T, valid?: readonly T[]) {
  let value = initial;
  try {
    const saved = localStorage.getItem(key) as T | null;
    if (saved !== null && (!valid || valid.includes(saved))) value = saved;
  } catch {
    /* storage disabled: keep the default */
  }
  const listeners = new Set<() => void>();
  const get = () => value;
  const set = (next: T) => {
    if (next === value) return;
    value = next;
    try {
      localStorage.setItem(key, next);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return { get, set, subscribe, use: () => useSyncExternalStore(subscribe, get) };
}

export const RANGES = [
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "365d", label: "1y" },
] as const;
export type Range = (typeof RANGES)[number]["id"];

export const rangeStore = persisted<Range>("nw.range", "24h", RANGES.map((r) => r.id));
export const rangeLabel = (r: Range) => (r === "365d" ? "year" : r);
/** Length of a range in seconds, for averages over it. */
export const rangeSeconds = (r: Range) => parseInt(r, 10) * (r.endsWith("h") ? 3600 : 86400);

export const sidebarStore = persisted<"open" | "closed">("nw.sidebar", "open", ["open", "closed"]);
export const idleStore = persisted<"0" | "1">("nw.all", "0", ["0", "1"]);

// ── theme ────────────────────────────────────────────────────────────────

export type Theme = "system" | "light" | "dark";
export const themeStore = persisted<Theme>("nw.theme", "system", ["system", "light", "dark"]);

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

export function applyTheme() {
  const t = themeStore.get();
  const dark = t === "dark" || (t === "system" && darkQuery.matches);
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.classList.toggle("dark", dark);
  // the browser chrome around the page (phone status bar) follows the shell
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f1115" : "#fbfbfd");
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}
darkQuery.addEventListener("change", applyTheme);
themeStore.subscribe(applyTheme);

// ── pulse: collector health + live throughput, sampled for the whole app ──

export type Sample = { t: number; down: number; up: number };
export type Pulse = { status: Status | null; error: string | null; history: Sample[] };

const PULSE_MS = 3000;
const HISTORY = 120; // 6 minutes

let pulse: Pulse = { status: null, error: null, history: [] };
const pulseListeners = new Set<() => void>();
let pulseTimer: number | undefined;

// While the Live view is open it samples the same figures from /api/live. It
// feeds them in here so the top bar, the sidebar and the Live tiles all show
// one sample instead of two that were taken a moment apart.
let fedAt = 0;

export function feedPulse(now: number, down: number, up: number, open: number) {
  fedAt = Date.now();
  pulse = {
    ...pulse,
    status: pulse.status && { ...pulse.status, now, rate_down: down, rate_up: up, open_all: open },
    history: [...pulse.history, { t: now, down, up }].slice(-HISTORY),
  };
  pulseListeners.forEach((l) => l());
}

async function tick() {
  try {
    const status = await api<Status>("api/status");
    const cur = pulse.status;
    if (cur && Date.now() - fedAt < 2 * PULSE_MS) {
      // health from the status call, figures from the Live view
      pulse = { ...pulse, error: null, status: { ...status, now: cur.now, rate_down: cur.rate_down, rate_up: cur.rate_up, open_all: cur.open_all } };
      pulseListeners.forEach((l) => l());
      return;
    }
    const sample = { t: status.now, down: status.rate_down || 0, up: status.rate_up || 0 };
    pulse = { status, error: null, history: [...pulse.history, sample].slice(-HISTORY) };
  } catch (e) {
    pulse = { ...pulse, error: e instanceof Error ? e.message : String(e) };
  }
  pulseListeners.forEach((l) => l());
}

function subscribePulse(l: () => void) {
  pulseListeners.add(l);
  if (pulseListeners.size === 1) {
    void tick();
    pulseTimer = window.setInterval(() => {
      if (!document.hidden) void tick();
    }, PULSE_MS);
  }
  return () => {
    pulseListeners.delete(l);
    if (pulseListeners.size === 0) window.clearInterval(pulseTimer);
  };
}

export const usePulse = () => useSyncExternalStore(subscribePulse, () => pulse);
