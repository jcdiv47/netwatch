import { Activity, ArrowLeftRight, Globe, LayoutDashboard, MonitorSmartphone, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { motion } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { Fig, isMac } from "@/components/data/Bits";
import { Dot } from "@/components/data/Motion";
import GlideMenu from "@/components/primitives/GlideMenu";
import { BrandMark } from "@/components/shell/Brand";
import type { DevicesResp, Status } from "@/lib/api";
import { bytes, dur } from "@/lib/format";
import { href, useRoute, type Route, type View } from "@/lib/router";
import { rangeStore, sidebarStore, usePulse } from "@/lib/store";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";

type NavItem = { view: View; also?: View; label: string; short: string; href: string; icon: ReactNode; key: string };

const NAV: NavItem[] = [
  { view: "overview", label: "Overview", short: "Overview", href: href.overview, icon: <LayoutDashboard size={15} />, key: "1" },
  { view: "devices", also: "device", label: "Devices", short: "Devices", href: href.devices, icon: <MonitorSmartphone size={15} />, key: "2" },
  { view: "domains", also: "domain", label: "Domains", short: "Domains", href: href.domains, icon: <Globe size={15} />, key: "3" },
  { view: "live", label: "Live", short: "Live", href: href.live, icon: <Activity size={15} />, key: "4" },
  { view: "connections", label: "Connections", short: "Flows", href: href.connections(), icon: <ArrowLeftRight size={15} />, key: "5" },
];
export const NAV_KEYS = Object.fromEntries(NAV.map((n) => [n.key, n.href]));
export const NAV_ITEMS = NAV;

const isActive = (route: Route, n: NavItem) => route.view === n.view || route.view === n.also;

// Between these widths the rail stays collapsed, whatever the saved preference;
// below the smaller one the rail gives way to the bottom tab bar.
const wide = matchMedia("(min-width: 1100px)");
const subscribeWide = (l: () => void) => {
  wide.addEventListener("change", l);
  return () => wide.removeEventListener("change", l);
};

const pillSpring = { type: "spring", stiffness: 480, damping: 38, mass: 0.8 } as const;

const rowCls =
  "relative z-10 flex h-8 items-center gap-2.5 rounded-control px-2.5 text-[13px] outline-offset-[-2px] transition-colors duration-100";

type Health = { ok: boolean; label: string; parts: { name: string; ok: boolean; note: string }[] };

function health(status: Status | null, error: string | null): Health {
  if (error) return { ok: false, label: "netwatch unreachable", parts: [] };
  if (!status) return { ok: false, label: "Connecting…", parts: [] };
  const parts = [
    {
      name: "stream",
      ok: status.stream.connected,
      note: status.stream.connected ? "sing-box stream connected" : (status.stream.last_error ?? "sing-box stream down"),
    },
    ...(status.conntrack
      ? [
          {
            name: "conntrack",
            ok: !status.conntrack.LastErr,
            note: status.conntrack.LastErr || `${status.conntrack.Open} open of ${status.conntrack.Entries} entries`,
          },
        ]
      : []),
    {
      name: "resolver",
      ok: !status.resolver.error,
      note: status.resolver.error || `${status.resolver.known_ips} known IPs`,
    },
  ];
  const bad = parts.filter((p) => !p.ok);
  return {
    ok: bad.length === 0,
    label: bad.length === 0 ? "Collector live" : `${bad.map((p) => p.name).join(", ")} down`,
    parts,
  };
}

/**
 * Collapsible workspace rail (240px ↔ 56px), after Beautiful UI's SidebarNav:
 * one gliding hover highlight, quiet rows, and an active pill that slides to
 * the current view. Below the views it keeps the heaviest devices one click
 * away; the foot reports the collector's three inputs.
 */
export function Sidebar() {
  const route = useRoute();
  const range = rangeStore.use();
  const isWide = useSyncExternalStore(subscribeWide, () => wide.matches);
  const open = sidebarStore.use() === "open" && isWide;
  const { status, error } = usePulse();
  const devices = useApi<DevicesResp>(`api/devices?range=${range}`, 30000);
  const top = (devices.data?.devices ?? []).slice(0, 10);
  const h = health(status, error);
  const pending = !status && !error;
  const uptime = status?.started ? dur(Date.now() - Date.parse(status.started)) : "";

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-line bg-page transition-[width] duration-300 ease-out-strong max-md:hidden",
        open ? "w-60" : "w-14",
      )}
    >
      <div className={cn("flex h-12 shrink-0 items-center gap-2", open ? "px-3" : "justify-center")}>
        {open && (
          <a href={href.overview} className="flex min-w-0 items-center gap-2.5 rounded-control py-1 pr-1.5 pl-1">
            <BrandMark live={h.ok} />
            <span className="truncate text-[14px] font-semibold tracking-[-0.03em] text-ink">netwatch</span>
          </a>
        )}
        {isWide ? (
          <button
            type="button"
            onClick={() => sidebarStore.set(open ? "closed" : "open")}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
            title={open ? "Collapse sidebar  [" : "Expand sidebar  ["}
            className={cn("primitive-icon-button text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink", open && "ml-auto")}
          >
            {open ? <PanelLeftClose size={15} aria-hidden /> : <PanelLeftOpen size={15} aria-hidden />}
          </button>
        ) : (
          <a href={href.overview} aria-label="netwatch overview">
            <BrandMark live={h.ok} />
          </a>
        )}
      </div>

      <nav aria-label="Views" className="px-2 pt-1">
        <GlideMenu className="flex flex-col gap-0.5" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2/70">
          {NAV.map((n) => {
            const active = isActive(route, n);
            return (
              <a
                key={n.view}
                href={n.href}
                data-menu-row
                aria-current={active ? "page" : undefined}
                title={open ? undefined : `${n.label}  ${n.key}`}
                className={cn(rowCls, active ? "font-medium text-ink" : "text-ink-2 hover:text-ink", !open && "justify-center px-0")}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    transition={pillSpring}
                    className="absolute inset-0 rounded-control bg-hover-2/80 dark:bg-hover-2/60"
                  />
                )}
                <span className={cn("relative shrink-0 transition-colors duration-150", active && "text-accent")} aria-hidden>
                  {n.icon}
                </span>
                {open && <span className="relative truncate">{n.label}</span>}
                {open && n.view === "live" && status && (
                  <span className="num relative ml-auto flex items-center gap-1.5 text-[11px] font-normal text-ink-2">
                    <Dot live />
                    {status.open_all}
                  </span>
                )}
                {open && n.view !== "live" && (
                  <kbd className="relative ml-auto flex size-4.5 items-center justify-center rounded-[4px] font-mono text-[10px] font-normal text-ink-3 opacity-0 shadow-hairline transition-opacity group-hover/glide-menu:opacity-100">
                    {n.key}
                  </kbd>
                )}
              </a>
            );
          })}
        </GlideMenu>
      </nav>

      {open && (
        <div className="mt-5 flex min-h-0 flex-1 flex-col px-2">
          <div className="flex h-6 items-center justify-between px-2.5">
            <span className="eyebrow">Top devices</span>
            <span className="num text-[10.5px] text-ink-3">{range === "365d" ? "1y" : range}</span>
          </div>
          <GlideMenu className="flex min-h-0 flex-col gap-px overflow-y-auto pb-2" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2/70">
            {top.map((d) => {
              const active = route.view === "device" && route.arg === d.key;
              return (
                <a
                  key={d.key}
                  href={href.device(d.key)}
                  data-menu-row
                  aria-current={active ? "page" : undefined}
                  title={`${d.name} · ${d.key}`}
                  className={cn(
                    rowCls,
                    "h-7.5 shrink-0 text-[12.5px]",
                    active ? "bg-hover-2/80 font-medium text-ink dark:bg-hover-2/60" : "text-ink-2 hover:text-ink",
                  )}
                >
                  <Dot tone={d.open ? "green" : "idle"} />
                  <span className={cn("min-w-0 flex-1 truncate", isMac(d.name) && "num text-[11.5px]")}>{d.name}</span>
                  <Fig className="shrink-0 text-[11px] font-normal text-ink-2">{bytes(d.up + d.down)}</Fig>
                </a>
              );
            })}
            {devices.data && top.length === 0 && <div className="px-2.5 py-2 text-[12px] text-ink-3">No traffic in this range.</div>}
          </GlideMenu>
        </div>
      )}

      <div
        className={cn("mt-auto shrink-0 border-t border-line", open ? "px-4 py-3" : "flex justify-center py-4")}
        title={[h.label, ...h.parts.map((p) => `${p.name}: ${p.note}`)].join("\n")}
      >
        {open ? (
          <>
            <div className="flex items-center gap-2 text-[12px]">
              <Dot tone={pending ? "idle" : h.ok ? "green" : "red"} live={h.ok} className="size-2" />
              <span className="min-w-0 truncate font-medium text-ink">{h.label}</span>
              {uptime && <span className="num ml-auto shrink-0 text-[10.5px] text-ink-3">up {uptime}</span>}
            </div>
            {h.parts.length > 0 && (
              <div className="mt-2 flex items-center gap-3 text-[10.5px] text-ink-3">
                {h.parts.map((p) => (
                  <span key={p.name} className={cn("flex items-center gap-1.5", !p.ok && "text-red")}>
                    <Dot tone={p.ok ? "green" : "red"} className="size-1" />
                    {p.name}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <Dot tone={pending ? "idle" : h.ok ? "green" : "red"} live={h.ok} className="size-2" />
            <span className="sr-only">{h.label}</span>
          </>
        )}
      </div>
    </aside>
  );
}

/** Bottom tab bar: the same five views, for screens too narrow for a rail. */
export function MobileNav() {
  const route = useRoute();
  return (
    <nav
      aria-label="Views"
      className="flex shrink-0 items-stretch border-t border-line bg-page px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.map((n) => {
        const active = isActive(route, n);
        return (
          <a
            key={n.view}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-13 flex-1 flex-col items-center justify-center gap-1 text-[10.5px] transition-colors duration-150",
              active ? "font-medium text-ink" : "text-ink-3",
            )}
          >
            {active && (
              <motion.span
                layoutId="tab-pill"
                transition={pillSpring}
                className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-accent"
              />
            )}
            <span className={cn("relative", active && "text-accent")} aria-hidden>
              {n.icon}
            </span>
            <span className="relative">{n.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
