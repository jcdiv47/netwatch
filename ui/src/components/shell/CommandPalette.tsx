import { Globe, MonitorSmartphone, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DevicesResp, DomainsResp } from "@/lib/api";
import { bytes } from "@/lib/format";
import { go, href } from "@/lib/router";
import { rangeStore } from "@/lib/store";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";

type Item = { id: string; kind: "device" | "domain"; label: string; sub: string; hay: string; href: string; total: number };

const LIMIT = 12;

/**
 * ⌘K jump list over every device and the range's destinations, after Beautiful
 * UI's Search primitive: field on top, one highlighted row that follows the
 * keyboard and the pointer alike.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const range = rangeStore.use();
  const devices = useApi<DevicesResp>(`api/devices?range=${range}&all=1`);
  const domains = useApi<DomainsResp>(`api/domains?range=${range}&limit=1000`);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const d = (devices.data?.devices ?? []).map<Item>((x) => ({
      id: "d:" + x.key,
      kind: "device",
      label: x.name,
      sub: [x.last_ip4, x.key !== x.name ? x.key : ""].filter(Boolean).join(" · "),
      hay: [x.name, x.key, x.hostname, x.last_ip4, x.last_ip6].join(" ").toLowerCase(),
      href: href.device(x.key),
      total: x.up + x.down,
    }));
    const t = (domains.data?.domains ?? []).map<Item>((x) => ({
      id: "t:" + x.target,
      kind: "domain",
      label: x.target,
      sub: `${x.devices ?? 0} device${x.devices === 1 ? "" : "s"}`,
      hay: x.target.toLowerCase(),
      href: href.domain(x.target),
      total: x.up + x.down,
    }));
    return [...d, ...t];
  }, [devices.data, domains.data]);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? items.filter((i) => words.every((w) => i.hay.includes(w))) : items;
    // Devices first when idle; otherwise by traffic, which is what people look for.
    return (words.length ? [...hits].sort((a, b) => b.total - a.total) : hits).slice(0, LIMIT);
  }, [items, query]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    go(item.href);
    onClose();
  };

  const loading = devices.loading || domains.loading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[oklch(0_0_0/0.28)] px-4 pt-[14vh]"
      style={{ animation: "fade-in 120ms ease-out both" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find device or domain"
        className="w-full max-w-xl overflow-hidden rounded-window bg-surface shadow-overlay"
        style={{ animation: "pop-in 160ms var(--ease-out-strong) both" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(results.length - 1, c + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[cursor]);
          }
        }}
      >
        <div className="flex h-11 items-center gap-2 border-b border-line px-3.5">
          <Search size={15} className="shrink-0 text-ink-3" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Device name, MAC, IP or domain…"
            aria-label="Find device or domain"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[cursor] ? `palette-${cursor}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded-[4px] bg-field px-1.5 font-sans text-[10.5px] text-ink-2 shadow-hairline">esc</kbd>
        </div>
        <div ref={listRef} id="palette-results" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-8">
              <span className="text-[13px] font-medium text-ink">{loading ? "Loading…" : "No results found"}</span>
              {!loading && <span className="text-[12px] text-ink-3">Try a MAC, an IP or part of a domain.</span>}
            </div>
          ) : (
            <div className="flex flex-col gap-px">
              {results.map((item, i) => (
                <button
                  key={item.id}
                  id={`palette-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  data-index={i}
                  onClick={() => pick(item)}
                  onMouseMove={() => setCursor(i)}
                  className={cn(
                    "relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px]",
                    i === cursor && "bg-hover",
                  )}
                >
                  <span className="shrink-0 text-ink-3" aria-hidden>
                    {item.kind === "device" ? <MonitorSmartphone size={14} /> : <Globe size={14} />}
                  </span>
                  <span className="min-w-0 truncate text-ink">{item.label}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">{item.sub}</span>
                  <span className="tnum shrink-0 text-[11.5px] text-ink-2">{item.total ? bytes(item.total) : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex h-8 items-center gap-3 border-t border-line bg-inset px-3.5 text-[11px] text-ink-3">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span className="ml-auto">traffic in the last {range === "365d" ? "year" : range}</span>
        </div>
      </div>
    </div>
  );
}
