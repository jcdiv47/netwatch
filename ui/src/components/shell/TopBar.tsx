import { ArrowDown, ArrowUp, ChevronRight, Monitor, Moon, Search, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { Sparkline } from "@/components/data/Bars";
import { Segmented } from "@/components/data/Bits";
import { rate } from "@/lib/format";
import { href } from "@/lib/router";
import { RANGES, rangeStore, themeStore, usePulse, type Theme } from "@/lib/store";

export type Crumb = { label: string; href?: string };

const THEMES: { id: Theme; icon: ReactNode; label: string }[] = [
  { id: "system", icon: <Monitor size={14} aria-hidden />, label: "Theme: system" },
  { id: "light", icon: <Sun size={14} aria-hidden />, label: "Theme: light" },
  { id: "dark", icon: <Moon size={14} aria-hidden />, label: "Theme: dark" },
];

export function TopBar({
  crumbs,
  showRange,
  onSearch,
}: {
  crumbs: Crumb[];
  showRange: boolean;
  onSearch: () => void;
}) {
  const range = rangeStore.use();
  const theme = themeStore.use();
  const { status, history } = usePulse();
  const next = THEMES[(THEMES.findIndex((t) => t.id === theme) + 1) % THEMES.length];
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-page px-4 max-md:gap-2 max-md:px-3">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-ink-3" aria-hidden />}
              {c.href && !last ? (
                <a href={c.href} className="shrink-0 rounded-[4px] text-ink-2 hover:text-ink">
                  {c.label}
                </a>
              ) : (
                <span className="truncate font-semibold text-ink" aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={onSearch}
        className="ml-auto flex h-7 w-52 shrink items-center gap-1.5 rounded-control bg-field px-2 text-[12.5px] text-ink-3 shadow-hairline hover:text-ink-2 max-md:w-auto"
      >
        <Search size={13} aria-hidden />
        <span className="flex-1 text-left max-md:hidden">Find device or domain</span>
        <kbd className="rounded-[4px] bg-surface px-1 font-sans text-[10.5px] text-ink-2 shadow-hairline max-md:hidden">⌘K</kbd>
      </button>

      <a
        href={href.live}
        title="Live throughput across all open connections"
        className="tnum flex h-7 shrink-0 items-center gap-2 rounded-control px-2 text-[12px] text-ink-2 hover:bg-hover-2 max-lg:hidden"
      >
        <Sparkline values={history.map((s) => s.down + s.up)} width={56} height={16} stroke="var(--ink-3)" />
        <span className="flex items-center gap-0.5">
          <ArrowDown size={12} className="text-down" aria-label="Download" />
          <span className="min-w-16 text-ink">{status ? rate(status.rate_down) : "–"}</span>
        </span>
        <span className="flex items-center gap-0.5">
          <ArrowUp size={12} className="text-up" aria-label="Upload" />
          <span className="min-w-16 text-ink">{status ? rate(status.rate_up) : "–"}</span>
        </span>
      </a>

      {showRange && (
        <Segmented options={RANGES} value={range} onChange={rangeStore.set} label="Time range" className="shrink-0" />
      )}

      <button
        type="button"
        onClick={() => themeStore.set(next.id)}
        aria-label={`${current.label}. Switch to ${next.id}.`}
        title={current.label}
        className="primitive-icon-button shrink-0 text-ink-2 hover:bg-hover-2 hover:text-ink"
      >
        {current.icon}
      </button>
    </header>
  );
}
