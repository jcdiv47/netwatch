import { Activity, ArrowLeftRight, Globe, LayoutDashboard, MonitorSmartphone, PanelLeftClose, PanelLeftOpen, Radar } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import GlideMenu from "@/components/primitives/GlideMenu";
import type { DevicesResp } from "@/lib/api";
import { bytes } from "@/lib/format";
import { href, useRoute, type View } from "@/lib/router";
import { rangeStore, sidebarStore, usePulse } from "@/lib/store";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";

const NAV: { view: View; also?: View; label: string; href: string; icon: ReactNode; key: string }[] = [
  { view: "overview", label: "Overview", href: href.overview, icon: <LayoutDashboard size={15} />, key: "1" },
  { view: "devices", also: "device", label: "Devices", href: href.devices, icon: <MonitorSmartphone size={15} />, key: "2" },
  { view: "domains", also: "domain", label: "Domains", href: href.domains, icon: <Globe size={15} />, key: "3" },
  { view: "live", label: "Live", href: href.live, icon: <Activity size={15} />, key: "4" },
  { view: "connections", label: "Connections", href: href.connections(), icon: <ArrowLeftRight size={15} />, key: "5" },
];
export const NAV_KEYS = Object.fromEntries(NAV.map((n) => [n.key, n.href]));

// Below this width the rail stays collapsed, whatever the saved preference.
const wide = matchMedia("(min-width: 900px)");
const subscribeWide = (l: () => void) => {
  wide.addEventListener("change", l);
  return () => wide.removeEventListener("change", l);
};

const rowCls =
  "relative z-10 flex h-8 items-center gap-2.5 rounded-control px-2.5 text-[13px] outline-offset-[-2px] transition-colors duration-100";

/**
 * Collapsible workspace rail (224px ↔ 52px), after Beautiful UI's SidebarNav:
 * one gliding hover highlight, quiet rows, the active row lifted onto a
 * surface. Below the views it keeps the heaviest devices one click away.
 */
export function Sidebar() {
  const route = useRoute();
  const range = rangeStore.use();
  const isWide = useSyncExternalStore(subscribeWide, () => wide.matches);
  const open = sidebarStore.use() === "open" && isWide;
  const { status, error } = usePulse();
  const devices = useApi<DevicesResp>(`api/devices?range=${range}`, 30000);
  const top = (devices.data?.devices ?? []).slice(0, 9);

  const ok = !error && status?.stream.connected;
  const health = error
    ? "netwatch unreachable"
    : !status
      ? "connecting…"
      : ok
        ? "Stream connected"
        : "Stream down";

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-line bg-page transition-[width] duration-200 ease-out-strong",
        open ? "w-56" : "w-13",
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-2.5">
        {open && (
          <a href={href.overview} className="flex min-w-0 items-center gap-2 rounded-control px-1.5 py-1">
            <span className="flex size-5 items-center justify-center rounded-[6px] bg-ink text-canvas">
              <Radar size={13} aria-hidden />
            </span>
            <span className="truncate text-[13.5px] font-semibold tracking-[-0.02em] text-ink">netwatch</span>
          </a>
        )}
        <button
          type="button"
          disabled={!isWide}
          onClick={() => sidebarStore.set(open ? "closed" : "open")}
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
          title={open ? "Collapse sidebar  [" : "Expand sidebar  ["}
          className={cn("primitive-icon-button text-ink-2 hover:bg-hover-2 hover:text-ink", open ? "ml-auto" : "mx-auto")}
        >
          {open ? <PanelLeftClose size={15} aria-hidden /> : <PanelLeftOpen size={15} aria-hidden />}
        </button>
      </div>

      <nav aria-label="Views" className="px-2">
        <GlideMenu className="flex flex-col gap-px" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
          {NAV.map((n) => {
            const active = route.view === n.view || route.view === n.also;
            return (
              <a
                key={n.view}
                href={n.href}
                data-menu-row
                aria-current={active ? "page" : undefined}
                title={open ? undefined : n.label}
                className={cn(
                  rowCls,
                  active ? "bg-surface font-medium text-ink shadow-btn" : "text-ink-2 hover:text-ink",
                  !open && "justify-center px-0",
                )}
              >
                <span className="shrink-0" aria-hidden>
                  {n.icon}
                </span>
                {open && <span className="truncate">{n.label}</span>}
                {open && n.view === "live" && status && (
                  <span className="tnum ml-auto text-[11px] font-normal text-ink-3">{status.open_all}</span>
                )}
                {open && n.view !== "live" && (
                  <kbd className="ml-auto font-sans text-[10.5px] font-normal text-ink-3 opacity-0 transition-opacity group-hover/glide-menu:opacity-100">
                    {n.key}
                  </kbd>
                )}
              </a>
            );
          })}
        </GlideMenu>
      </nav>

      {open && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col px-2">
          <div className="flex h-6 items-center justify-between px-2.5 text-[11px] font-medium text-ink-3">
            <span>Top devices</span>
            <span className="font-normal">{range === "365d" ? "1y" : range}</span>
          </div>
          <GlideMenu className="flex min-h-0 flex-col gap-px overflow-y-auto" highlightClassName="inset-x-0 rounded-[8px] bg-hover-2">
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
                    "h-7 shrink-0 text-[12.5px]",
                    active ? "bg-surface font-medium text-ink shadow-btn" : "text-ink-2 hover:text-ink",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", d.open ? "bg-green" : "bg-line-strong")}
                  />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className="tnum shrink-0 text-[11px] font-normal text-ink-3">{bytes(d.up + d.down)}</span>
                </a>
              );
            })}
            {devices.data && top.length === 0 && (
              <div className="px-2.5 py-2 text-[12px] text-ink-3">No traffic in this range.</div>
            )}
          </GlideMenu>
        </div>
      )}

      <div
        className={cn("mt-auto flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5 text-[11.5px] text-ink-2", !open && "justify-center px-0")}
        title={
          status
            ? [
                health,
                status.stream.last_error,
                status.conntrack && `conntrack: ${status.conntrack.Open} open${status.conntrack.LastErr ? ` (${status.conntrack.LastErr})` : ""}`,
                `resolver: ${status.resolver.known_ips} known IPs${status.resolver.error ? ` (${status.resolver.error})` : ""}`,
              ]
                .filter(Boolean)
                .join("\n")
            : (error ?? "")
        }
      >
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", ok ? "bg-green" : status || error ? "bg-red" : "bg-line-strong")} />
        {open && (
          <span className="min-w-0 truncate">{health}</span>
        )}
        {!open && <span className="sr-only">{health}</span>}
      </div>
    </aside>
  );
}
