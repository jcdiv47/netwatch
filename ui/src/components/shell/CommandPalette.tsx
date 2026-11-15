import { Clock, CornerDownLeft, Globe, Monitor, Moon, Search, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DeviceGlyph, Fig, isIp, isMac } from "@/components/data/Bits";
import { ScrollFade } from "@/components/data/ScrollFade";
import { NAV_ITEMS } from "@/components/shell/Sidebar";
import { switchTheme } from "@/components/shell/TopBar";
import type { DevicesResp, DomainsResp } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useNarrow } from "@/lib/media";
import { go } from "@/lib/router";
import { RANGES, rangeLabel, rangeStore, type Theme } from "@/lib/store";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";

type Group = "Go to" | "Devices" | "Destinations" | "Time range" | "Theme";

type Item = {
  id: string;
  group: Group;
  label: string;
  sub?: string;
  hay: string;
  icon: ReactNode;
  /** right-hand note: a shortcut key or the item's traffic */
  hint?: string;
  key?: string;
  total: number;
  mono?: boolean;
  run: () => void;
};

const LIMIT = 14;
const iconCls = "flex size-5.5 shrink-0 items-center justify-center rounded-[6px] bg-field text-ink-2 shadow-hairline";

const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: "light", label: "Light theme", icon: <Sun size={12.5} /> },
  { id: "dark", label: "Dark theme", icon: <Moon size={12.5} /> },
  { id: "system", label: "Match system theme", icon: <Monitor size={12.5} /> },
];

/**
 * ⌘K: one field that jumps to any view, device or destination and runs the
 * few global commands (time range, theme). One highlighted row follows the
 * keyboard and the pointer alike.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const range = rangeStore.use();
  const devices = useApi<DevicesResp>(`api/devices?range=${range}&all=1`);
  const domains = useApi<DomainsResp>(`api/domains?range=${range}&limit=1000`);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();

  const items = useMemo<Item[]>(() => {
    const views = NAV_ITEMS.map<Item>((n) => ({
      id: "v:" + n.view,
      group: "Go to",
      label: n.label,
      hay: `${n.label} ${n.short} go to view`.toLowerCase(),
      icon: <span className={iconCls}>{n.icon}</span>,
      key: n.key,
      total: 0,
      run: () => go(n.href),
    }));
    const d = (devices.data?.devices ?? []).map<Item>((x) => ({
      id: "d:" + x.key,
      group: "Devices",
      label: x.name,
      sub: [x.last_ip4, !narrow && x.key !== x.name ? x.key : ""].filter(Boolean).join(" · "),
      hay: [x.name, x.key, x.hostname, x.last_ip4, x.last_ip6].join(" ").toLowerCase(),
      icon: <DeviceGlyph name={x.name} kind={x.kind} />,
      hint: x.up + x.down ? bytes(x.up + x.down) : undefined,
      total: x.up + x.down,
      mono: isMac(x.name),
      run: () => go(`#/device/${encodeURIComponent(x.key)}`),
    }));
    const t = (domains.data?.domains ?? []).map<Item>((x) => ({
      id: "t:" + x.target,
      group: "Destinations",
      label: x.target,
      sub: `${x.devices ?? 0} device${x.devices === 1 ? "" : "s"}`,
      hay: x.target.toLowerCase(),
      icon: (
        <span className={iconCls}>
          <Globe size={12.5} />
        </span>
      ),
      hint: x.up + x.down ? bytes(x.up + x.down) : undefined,
      total: x.up + x.down,
      mono: isIp(x.target),
      run: () => go(`#/domain/${encodeURIComponent(x.target)}`),
    }));
    const ranges = RANGES.map<Item>((r) => ({
      id: "r:" + r.id,
      group: "Time range",
      label: `Show the last ${rangeLabel(r.id)}`,
      hay: `range time last ${r.id} ${r.label} ${rangeLabel(r.id)}`,
      icon: (
        <span className={iconCls}>
          <Clock size={12.5} />
        </span>
      ),
      hint: r.id === range ? "current" : undefined,
      total: 0,
      run: () => rangeStore.set(r.id),
    }));
    const themes = THEMES.map<Item>((x) => ({
      id: "th:" + x.id,
      group: "Theme",
      label: x.label,
      hay: `theme appearance ${x.label}`.toLowerCase(),
      icon: <span className={iconCls}>{x.icon}</span>,
      total: 0,
      run: () => switchTheme(x.id),
    }));
    return [...views, ...d, ...t, ...ranges, ...themes];
  }, [devices.data, domains.data, range, narrow]);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      // Idle: the views, then the busiest of each kind.
      const take = (g: Group, n: number) => items.filter((i) => i.group === g).slice(0, n);
      // On a phone the top bar has no theme switch, so the theme rows are listed too.
      return [...take("Go to", 5), ...take("Devices", 5), ...take("Destinations", 4), ...(narrow ? take("Theme", 3) : [])];
    }
    const hits = items.filter((i) => words.every((w) => i.hay.includes(w)));
    // Commands first (there are few), then by traffic, which is what people look for.
    const rank = (i: Item) => (i.group === "Go to" ? 0 : i.group === "Devices" || i.group === "Destinations" ? 1 : 2);
    return hits.sort((a, b) => rank(a) - rank(b) || b.total - a.total).slice(0, LIMIT);
  }, [items, query, narrow]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  const loading = devices.loading || domains.loading;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[oklch(0.1_0.02_262/0.45)] px-4 pt-[13vh] backdrop-blur-[3px] max-md:px-2 max-md:pt-[max(0.5rem,env(safe-area-inset-top))]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="w-full max-w-[600px] overflow-hidden rounded-window bg-surface shadow-overlay max-sm:flex max-sm:h-[calc(100dvh-1rem)] max-sm:flex-col"
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: -4 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => (c + 1) % Math.max(1, results.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => (c - 1 + results.length) % Math.max(1, results.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[cursor]);
          }
        }}
      >
        <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
          <Search size={15} className="shrink-0 text-ink-3" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={narrow ? "Search devices, domains, IPs" : "Jump to a view, device, MAC, IP or domain…"}
            aria-label="Search and commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[cursor] ? `palette-${cursor}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3 max-md:text-[16px]"
          />
          <kbd className="rounded-[4px] bg-field px-1.5 py-px font-mono text-[10px] text-ink-2 shadow-hairline max-sm:hidden">esc</kbd>
          <button type="button" onClick={onClose} className="-mr-1 h-9 px-1 text-[14px] text-accent-ink sm:hidden">
            Cancel
          </button>
        </div>
        <ScrollFade className="max-h-[56vh] max-sm:max-h-none max-sm:flex-1">
        <div ref={listRef} id="palette-results" role="listbox" className="p-1.5">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-10">
              <span className="text-[13px] font-medium text-ink">{loading ? "Loading…" : "No results"}</span>
              {!loading && <span className="text-[12px] text-ink-3">Try a MAC, an IP or part of a domain.</span>}
            </div>
          ) : (
            results.map((item, i) => (
              <div key={item.id}>
                {(i === 0 || results[i - 1].group !== item.group) && (
                  <div className="eyebrow px-2.5 pt-2.5 pb-1">{item.group}</div>
                )}
                <button
                  id={`palette-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  data-index={i}
                  onClick={() => pick(item)}
                  onMouseMove={() => setCursor(i)}
                  className={cn(
                    "flex h-9.5 w-full items-center max-md:h-11 gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] transition-colors duration-75",
                    i === cursor && "bg-hover-2/70",
                  )}
                >
                  <span aria-hidden className="flex">
                    {item.icon}
                  </span>
                  <span className={cn("min-w-0 truncate text-ink", item.mono && "num text-[12px]")}>{item.label}</span>
                  <span className={cn("min-w-0 flex-1 truncate text-[11.5px] text-ink-3", item.group === "Devices" && "font-mono text-[11px] tracking-[-0.02em]")}>
                    {item.sub}
                  </span>
                  {item.key ? (
                    <kbd className="flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-surface font-mono text-[10px] text-ink-2 shadow-hairline max-sm:hidden">
                      {item.key}
                    </kbd>
                  ) : item.hint && /\d/.test(item.hint) ? (
                    <Fig className="shrink-0 text-[11.5px]">{item.hint}</Fig>
                  ) : (
                    <span className="shrink-0 text-[11px] text-ink-3">{item.hint}</span>
                  )}
                  {i === cursor && <CornerDownLeft size={12} aria-hidden className="shrink-0 text-ink-3 max-sm:hidden" />}
                </button>
              </div>
            ))
          )}
        </div>
        </ScrollFade>
        <div className="flex h-9 shrink-0 items-center gap-3.5 border-t border-line bg-inset px-4 text-[11px] text-ink-3">
          <span className="max-sm:hidden">
            <b className="font-mono font-normal text-ink-2">↑↓</b> move
          </span>
          <span className="max-sm:hidden">
            <b className="font-mono font-normal text-ink-2">↵</b> open
          </span>
          <span className="max-sm:hidden">
            <b className="font-mono font-normal text-ink-2">1–5</b> views
          </span>
          <span className="max-sm:hidden">
            <b className="font-mono font-normal text-ink-2">[</b> sidebar
          </span>
          <span className="ml-auto max-sm:ml-0">traffic in the last {rangeLabel(range)}</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
