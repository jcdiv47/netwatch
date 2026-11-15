import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Monitor, Moon, Search, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { Sparkline } from "@/components/data/Bars";
import { isMac, Segmented } from "@/components/data/Bits";
import { AnimatedNumber, Dot } from "@/components/data/Motion";
import { BrandMark } from "@/components/shell/Brand";
import { rate } from "@/lib/format";
import { href } from "@/lib/router";
import { RANGES, rangeStore, themeStore, usePulse, type Theme } from "@/lib/store";
import { useBusy } from "@/lib/useApi";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

const THEMES: { id: Theme; icon: ReactNode; label: string }[] = [
  { id: "system", icon: <Monitor size={14} aria-hidden />, label: "Theme: system" },
  { id: "light", icon: <Sun size={14} aria-hidden />, label: "Theme: light" },
  { id: "dark", icon: <Moon size={14} aria-hidden />, label: "Theme: dark" },
];

/**
 * Switches theme; where the browser can, the new theme opens as a circle from
 * the point that was clicked instead of the whole page flipping at once.
 */
export function switchTheme(next: Theme, origin?: { x: number; y: number }) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!origin || !doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    themeStore.set(next);
    return;
  }
  const { x, y } = origin;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = doc.startViewTransition(() => flushSync(() => themeStore.set(next)));
  void transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 520, easing: "cubic-bezier(0.23, 1, 0.32, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
}

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
  const busy = useBusy();
  const { status, history, error } = usePulse();
  const next = THEMES[(THEMES.findIndex((t) => t.id === theme) + 1) % THEMES.length];
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const live = !!status && !error;

  return (
    <header className="relative z-20 flex min-h-12 pt-[env(safe-area-inset-top)] shrink-0 items-center gap-3 border-b border-line bg-page px-4 max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-0 max-md:px-3">
      <a href={href.overview} aria-label="netwatch overview" className="md:hidden">
        <BrandMark live={live} />
      </a>
      <nav aria-label="Breadcrumb" className="flex h-12 min-w-0 items-center gap-1 text-[13.5px] max-md:flex-1 max-md:text-[15px]">
        {crumbs.length > 1 && crumbs[0].href && (
          <a
            href={crumbs[0].href}
            aria-label={`Back to ${crumbs[0].label}`}
            className="-ml-1.5 flex h-9 shrink-0 items-center gap-0.5 rounded-control pr-2 font-semibold tracking-[-0.015em] text-ink md:hidden"
          >
            <ChevronLeft size={18} aria-hidden className="text-ink-2" />
            {crumbs[0].label}
          </a>
        )}
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className={cn("flex min-w-0 items-center gap-1", (!last || crumbs.length > 1) && "max-md:hidden")}>
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-ink-3 max-md:hidden" aria-hidden />}
              {c.href && !last ? (
                <a href={c.href} className="shrink-0 rounded-[4px] text-ink-2 transition-colors hover:text-ink">
                  {c.label}
                </a>
              ) : (
                <span
                  className={cn("truncate font-semibold tracking-[-0.015em] text-ink", isMac(c.label) && "num text-[12.5px] font-medium")}
                  aria-current={last ? "page" : undefined}
                >
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
        aria-label="Search devices, domains and commands"
        className="ml-auto flex h-8 w-60 shrink items-center max-md:order-2 max-md:ml-0 max-md:shrink-0 gap-2 rounded-control bg-field px-2.5 text-[12.5px] text-ink-3 shadow-hairline transition-[color,box-shadow] duration-150 hover:text-ink-2 hover:shadow-[0_0_0_1px_var(--line-strong)] max-lg:w-44 max-md:w-10 max-md:h-10 max-md:justify-center max-md:px-0"
      >
        <Search size={13} aria-hidden className="shrink-0" />
        <span className="flex-1 truncate text-left max-md:hidden">Search or jump to…</span>
        <kbd className="rounded-[4px] bg-surface px-1.5 py-px font-mono text-[10px] text-ink-2 shadow-hairline max-md:hidden">⌘K</kbd>
      </button>

      <a
        href={href.live}
        aria-label="Live throughput"
        className="num flex shrink-0 flex-col items-start text-[10.5px] leading-[1.3] text-ink-2 md:hidden"
      >
        <span>
          <span className="text-down">↓</span> {status ? <AnimatedNumber value={status.rate_down} format={rate} /> : "–"}
        </span>
        <span>
          <span className="text-up">↑</span> {status ? <AnimatedNumber value={status.rate_up} format={rate} /> : "–"}
        </span>
      </a>

      <a
        href={href.live}
        title="Live throughput across all open connections"
        className="flex h-8 shrink-0 items-center gap-2.5 rounded-control px-2.5 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-hover-2 max-xl:hidden"
      >
        <Dot live={live} tone={live ? "green" : "idle"} />
        <Sparkline values={[...Array<number>(Math.max(0, 24 - history.length)).fill(0), ...history.slice(-24).map((s) => s.down + s.up)]} width={48} height={18} stroke="var(--series-down)" area={false} />
        <span className="flex items-center gap-1">
          <ArrowDown size={12} className="text-down" aria-label="Download" />
          <span className="num min-w-[4.6rem] text-ink">
            {status ? <AnimatedNumber value={status.rate_down} format={rate} /> : "–"}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <ArrowUp size={12} className="text-up" aria-label="Upload" />
          <span className="num min-w-[4.6rem] text-ink">
            {status ? <AnimatedNumber value={status.rate_up} format={rate} /> : "–"}
          </span>
        </span>
      </a>

      {!showRange && <div aria-hidden className="h-7.5 w-[214px] shrink-0 max-md:hidden" />}
      {showRange && (
        <Segmented
          options={RANGES}
          value={range}
          onChange={rangeStore.set}
          label="Time range"
          className="shrink-0 max-md:order-last max-md:mb-2 max-md:w-full max-md:*:flex-1"
        />
      )}

      <button
        type="button"
        onClick={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          switchTheme(next.id, { x: b.left + b.width / 2, y: b.top + b.height / 2 });
        }}
        aria-label={`${current.label}. Switch to ${next.id}.`}
        title={current.label}
        className="primitive-icon-button relative shrink-0 overflow-hidden text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink max-md:hidden!"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={current.id}
            initial={{ opacity: 0, rotate: -60, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 60, scale: 0.6 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            className="flex"
          >
            {current.icon}
          </motion.span>
        </AnimatePresence>
      </button>

      <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 -bottom-px h-px overflow-hidden transition-opacity duration-300", busy ? "opacity-100" : "opacity-0")}>
        <div className="busy-bar h-full w-full" />
      </div>
    </header>
  );
}
