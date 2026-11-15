import { ArrowDown, ArrowUp, ArrowUpRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { ValuePill } from "@/components/atoms/ValuePill";
import { DeviceLink, Fig, isIp, TargetLink } from "@/components/data/Bits";
import { Dot } from "@/components/data/Motion";
import { ScrollFade } from "@/components/data/ScrollFade";
import type { Flow } from "@/lib/api";
import { bytes, dur, fullTime, rate } from "@/lib/format";
import { href } from "@/lib/router";
import { useNarrow } from "@/lib/media";
import { cn } from "@/lib/utils";

/** Lets a long address wrap after a colon instead of in the middle of a group. */
const soft = (s: string) =>
  s.split(":").map((part, i, all) => (
    <span key={i}>
      {part}
      {i < all.length - 1 && (
        <>
          :<wbr />
        </>
      )}
    </span>
  ));

const addr = (ip: string, port: number) => (!ip ? "" : ip.includes(":") ? `[${ip}]:${port}` : `${ip}:${port}`);

function Line({ label, children }: { label: string; children: ReactNode }) {
  if (children === "" || children === null || children === undefined || children === false) return null;
  return (
    <div className="flex gap-3 border-b border-line-soft py-[7px] last:border-b-0">
      <dt className="w-24 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-4 pt-4">
      <h3 className="eyebrow pb-1">{title}</h3>
      <dl className="text-[12.5px]">{children}</dl>
    </section>
  );
}

const mono = "font-mono text-[11.5px] tracking-[-0.02em]";

function Total({ dir, total, now }: { dir: "down" | "up"; total: number; now?: number }) {
  const Icon = dir === "down" ? ArrowDown : ArrowUp;
  return (
    <div className="min-w-0 flex-1 bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1 text-[11.5px] text-ink-2">
        <Icon size={12} className={dir === "down" ? "text-down" : "text-up"} aria-hidden />
        {dir === "down" ? "Down" : "Up"}
      </div>
      <div className="mt-0.5 text-[17px] leading-6 font-semibold tracking-[-0.03em] text-ink tabular-nums">{bytes(total)}</div>
      {now !== undefined && (
        <div className="text-[11px] text-ink-3">
          <Fig>{rate(now)}</Fig>
        </div>
      )}
    </div>
  );
}

/**
 * Everything recorded about one connection, in a panel docked to the right
 * edge. It has no backdrop, so other rows stay clickable while it is open.
 */
export function FlowDetail({ flow, now, ended, onClose }: { flow: Flow; now: number; ended?: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const narrow = useNarrow();
  // a side panel on a desk, a bottom sheet in the hand
  const off = narrow ? { y: 60, opacity: 0 } : { x: 40, opacity: 0 };
  const ct = flow.source === "conntrack";
  const open = !flow.closed_at && !ended;
  return (
    <motion.aside
      role="dialog"
      aria-label="Connection details"
      initial={off}
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={off}
      transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
      className="fixed top-[61px] right-3 bottom-3 z-30 flex w-[404px] lg:top-[69px] lg:right-5 lg:bottom-5 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-window bg-surface shadow-overlay max-sm:inset-x-0 max-sm:top-[12dvh] max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-md:z-40 sm:max-md:top-2 sm:max-md:bottom-16"
    >
      <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" />
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-line px-4 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Connection</div>
          <h2 className={cn("truncate text-[13.5px] font-semibold text-ink", isIp(flow.target) && "num text-[12.5px] font-medium")} title={flow.target}>
            {flow.target}
          </h2>
        </div>
        <ValuePill tone={open ? "green" : "neutral"} className="gap-1.5">
          {open && <Dot live />}
          {open ? "Open" : flow.closed_at ? "Closed" : "Ended"}
        </ValuePill>
        <button
          type="button"
          aria-label="Close details"
          title="Close  esc"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink max-md:size-9"
        >
          <X size={14} aria-hidden />
        </button>
      </header>
      {/* keyed on the flow so a new selection cross-fades instead of mutating in place */}
      <ScrollFade className="min-h-0 flex-1">
      <motion.div
        key={flow.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        className="pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-4 mt-4 flex gap-px overflow-hidden rounded-[10px] bg-line shadow-hairline">
          <Total dir="down" total={flow.down} now={open ? (flow.rate_down ?? 0) : undefined} />
          <Total dir="up" total={flow.up} now={open ? (flow.rate_up ?? 0) : undefined} />
          <div className="min-w-0 flex-1 bg-surface px-3 py-2.5">
            <div className="text-[11.5px] text-ink-2">{flow.closed_at ? "Duration" : "Age"}</div>
            <div className="mt-0.5 text-[17px] leading-6 font-semibold tracking-[-0.03em] text-ink tabular-nums">
              {dur((flow.closed_at ?? now) - flow.created_at)}
            </div>
            {open && <div className="text-[11px] text-ink-3">and counting</div>}
          </div>
        </div>

        <Section title="Timing">
          <Line label="Started">{fullTime(flow.created_at)}</Line>
          <Line label="Closed">{flow.closed_at ? fullTime(flow.closed_at) : ""}</Line>
        </Section>

        <Section title="Endpoints">
          <Line label="Device">
            <DeviceLink k={flow.device_key} name={flow.device_name} />
          </Line>
          <Line label="Source">{<span className={mono}>{soft(addr(flow.src_ip, flow.src_port))}</span>}</Line>
          <Line label="Destination">{<span className={mono}>{soft(addr(flow.dst_ip, flow.dst_port))}</span>}</Line>
          <Line label="Domain">{flow.domain && <TargetLink target={flow.domain} className="break-all" />}</Line>
          <Line label="Network">{flow.network.toUpperCase()}</Line>
          <Line label="Protocol">{flow.protocol}</Line>
          <Line label="IP version">{flow.ip_version > 0 ? `IPv${flow.ip_version}` : ""}</Line>
        </Section>

        <Section title="Routing">
          <Line label="Seen by">{ct ? "router conntrack (bypasses sing-box)" : "sing-box"}</Line>
          <Line label={ct ? "Class" : "Inbound"}>{flow.inbound && <span className={mono}>{flow.inbound}</span>}</Line>
          <Line label="Inbound type">{flow.inbound_type && <span className={mono}>{flow.inbound_type}</span>}</Line>
          <Line label="User">{flow.user}</Line>
          <Line label="Match rule">{flow.rule && <span className={`${mono} break-all`}>{flow.rule}</span>}</Line>
          <Line label="Outbound">{flow.outbound}</Line>
          <Line label="Chain">{flow.chain && flow.chain !== flow.outbound ? flow.chain.replace(/\s*>\s*/g, " › ") : ""}</Line>
        </Section>

        <Section title="Flow id">
          <p className={`pt-1 break-all text-ink-3 select-all ${mono}`}>{flow.id}</p>
        </Section>

        <div className="flex flex-col gap-1.5 px-4 pt-5 text-[12.5px]">
          {[
            [href.connections(`device:${flow.device_key}`), "All connections from this device"],
            [href.connections(`target:${flow.target}`), `All connections to ${flow.domain ? "this domain" : "this address"}`],
          ].map(([to, label]) => (
            <a
              key={to}
              href={to}
              className="group/go flex h-8.5 items-center justify-between rounded-control bg-field px-3 text-ink shadow-hairline transition-colors duration-100 hover:bg-hover-2"
            >
              {label}
              <ArrowUpRight size={13} aria-hidden className="text-ink-3 transition-transform duration-200 ease-out-strong group-hover/go:translate-x-0.5 group-hover/go:-translate-y-0.5 group-hover/go:text-ink" />
            </a>
          ))}
        </div>
      </motion.div>
      </ScrollFade>
    </motion.aside>
  );
}

/**
 * Selection state for a flow table: pass `select`/`selectedKey` to the table
 * and render `panel`. The selected row follows refreshed data; once it drops
 * out of a live list the last known values stay, marked as ended.
 */
export function useFlowDetail(rows: Flow[], now: number, live = false) {
  const [picked, setPicked] = useState<Flow | null>(null);
  const fresh = picked && rows.find((r) => r.id === picked.id);
  const flow = fresh || picked;
  // The page reserves the panel's width while it is open (see index.css), so
  // the table's right-hand columns are not hidden behind it.
  const isOpen = !!flow;
  useEffect(() => {
    if (!isOpen) return;
    document.documentElement.dataset.detail = "open";
    return () => {
      delete document.documentElement.dataset.detail;
    };
  }, [isOpen]);
  return {
    select: (f: Flow) => setPicked((p) => (p?.id === f.id ? null : f)),
    selectedKey: flow?.id ?? null,
    panel: (
      <AnimatePresence>
        {flow && <FlowDetail key="flow-detail" flow={flow} now={now} ended={live && !fresh} onClose={() => setPicked(null)} />}
      </AnimatePresence>
    ),
  };
}
