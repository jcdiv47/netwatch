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

async function tick() {
  try {
    const status = await api<Status>("api/status");
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
