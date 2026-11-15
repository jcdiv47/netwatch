import { AnimatePresence } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { MobileNav, NAV_KEYS, Sidebar } from "@/components/shell/Sidebar";
import { TopBar, type Crumb } from "@/components/shell/TopBar";
import { go, href, useRoute } from "@/lib/router";
import { sidebarStore } from "@/lib/store";
import { Connections } from "@/views/Connections";
import { Device } from "@/views/Device";
import { Devices } from "@/views/Devices";
import { Domain } from "@/views/Domain";
import { Domains } from "@/views/Domains";
import { Live } from "@/views/Live";
import { Overview } from "@/views/Overview";

function subscribeDark(l: () => void) {
  const o = new MutationObserver(l);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => o.disconnect();
}
const isDark = () => document.documentElement.classList.contains("dark");

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

export function App() {
  const route = useRoute();
  const dark = useSyncExternalStore(subscribeDark, isDark);
  const [palette, setPalette] = useState(false);
  const [deviceName, setDeviceName] = useState<{ key: string; name: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
      } else if (e.key === "[") {
        sidebarStore.set(sidebarStore.get() === "open" ? "closed" : "open");
      } else if (NAV_KEYS[e.key]) {
        go(NAV_KEYS[e.key]);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // A new page starts at the top.
  useEffect(() => {
    document.getElementById("main")?.scrollTo(0, 0);
  }, [route.view, route.arg]);

  const crumbs: Crumb[] =
    route.view === "device"
      ? [
          { label: "Devices", href: href.devices },
          { label: deviceName?.key === route.arg ? deviceName.name : route.arg },
        ]
      : route.view === "domain"
        ? [{ label: "Domains", href: href.domains }, { label: route.arg }]
        : [{ label: { overview: "Overview", devices: "Devices", domains: "Domains", live: "Live", connections: "Connections" }[route.view] }];

  useEffect(() => {
    document.title = `${crumbs[crumbs.length - 1].label} · netwatch`;
  });

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar crumbs={crumbs} showRange={route.view !== "live"} onSearch={() => setPalette(true)} />
        <main id="main" className="page-glow min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1680px] p-3 lg:p-5">
            {route.view === "overview" && <Overview dark={dark} />}
            {route.view === "devices" && <Devices />}
            {route.view === "device" && (
              <Device key={route.arg} deviceKey={route.arg} onName={(name) => setDeviceName({ key: route.arg, name })} />
            )}
            {route.view === "domains" && <Domains />}
            {route.view === "domain" && <Domain key={route.arg} target={route.arg} />}
            {route.view === "live" && <Live key={route.arg} initialQuery={route.arg} />}
            {route.view === "connections" && <Connections key={route.arg} initialQuery={route.arg} />}
          </div>
        </main>
        <MobileNav />
      </div>
      <AnimatePresence>{palette && <CommandPalette key="palette" onClose={() => setPalette(false)} />}</AnimatePresence>
    </div>
  );
}
