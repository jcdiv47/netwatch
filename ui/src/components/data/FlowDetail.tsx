import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ValuePill } from "@/components/atoms/ValuePill";
import { DeviceLink, TargetLink } from "@/components/data/Bits";
import type { Flow } from "@/lib/api";
import { bytes, dur, fullTime, rate } from "@/lib/format";
import { href } from "@/lib/router";

const addr = (ip: string, port: number) => (!ip ? "" : ip.includes(":") ? `[${ip}]:${port}` : `${ip}:${port}`);

function Line({ label, children }: { label: string; children: ReactNode }) {
  if (children === "" || children === null || children === undefined || children === false) return null;
  return (
    <div className="flex gap-3 border-b border-line-soft py-1.5 last:border-b-0">
      <dt className="w-24 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-3.5 pt-3">
      <h3 className="pb-1 text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{title}</h3>
      <dl className="text-[12.5px]">{children}</dl>
    </section>
  );
}

const mono = "font-mono text-[11.5px]";

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

  const ct = flow.source === "conntrack";
  const open = !flow.closed_at && !ended;
  return (
    <aside
      role="dialog"
      aria-label="Connection details"
      className="fixed inset-y-0 right-0 z-40 flex w-[400px] max-w-full flex-col border-l border-line bg-surface shadow-overlay"
    >
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-line px-3.5 py-1.5">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" title={flow.target}>
          {flow.target}
        </h2>
        <ValuePill tone={open ? "green" : "neutral"}>{open ? "Open" : flow.closed_at ? "Closed" : "Ended"}</ValuePill>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-control text-ink-2 hover:bg-hover-2 hover:text-ink"
        >
          <X size={14} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <p className={`px-3.5 pt-2.5 break-all text-ink-3 select-all ${mono}`}>{flow.id}</p>

        <Section title="Traffic">
          <Line label="Started">{fullTime(flow.created_at)}</Line>
          <Line label="Closed">{flow.closed_at ? fullTime(flow.closed_at) : ""}</Line>
          <Line label={flow.closed_at ? "Duration" : "Age"}>{dur((flow.closed_at ?? now) - flow.created_at)}</Line>
          <Line label="Down">
            <span className="tnum">{bytes(flow.down)}</span>
            {open && flow.rate_down ? <span className="tnum text-ink-3"> · {rate(flow.rate_down)}</span> : null}
          </Line>
          <Line label="Up">
            <span className="tnum">{bytes(flow.up)}</span>
            {open && flow.rate_up ? <span className="tnum text-ink-3"> · {rate(flow.rate_up)}</span> : null}
          </Line>
        </Section>

        <Section title="Endpoints">
          <Line label="Device">
            <DeviceLink k={flow.device_key} name={flow.device_name} />
          </Line>
          <Line label="Source">{<span className={mono}>{addr(flow.src_ip, flow.src_port)}</span>}</Line>
          <Line label="Destination">{<span className={mono}>{addr(flow.dst_ip, flow.dst_port)}</span>}</Line>
          <Line label="Domain">{flow.domain && <TargetLink target={flow.domain} className="break-all" />}</Line>
          <Line label="Network">{flow.network.toUpperCase()}</Line>
          <Line label="Protocol">{flow.protocol}</Line>
          <Line label="IP version">{flow.ip_version > 0 ? `IPv${flow.ip_version}` : ""}</Line>
        </Section>

        <Section title="Routing">
          <Line label="Seen by">{ct ? "router conntrack (bypasses sing-box)" : "sing-box"}</Line>
          <Line label={ct ? "Class" : "Inbound"}>{flow.inbound && <span className={mono}>{flow.inbound}</span>}</Line>
          <Line label="Inbound type">{flow.inbound_type}</Line>
          <Line label="User">{flow.user}</Line>
          <Line label="Match rule">{flow.rule && <span className={`${mono} break-all`}>{flow.rule}</span>}</Line>
          <Line label="Outbound">{flow.outbound}</Line>
          <Line label="Chain">{flow.chain && flow.chain !== flow.outbound ? flow.chain : ""}</Line>
        </Section>

        <div className="flex flex-col gap-1 px-3.5 pt-4 text-[12px]">
          <a href={href.connections(`device:${flow.device_key}`)} className="text-accent-ink hover:underline">
            All connections from this device
          </a>
          <a href={href.connections(`target:${flow.target}`)} className="text-accent-ink hover:underline">
            All connections to {flow.domain ? "this domain" : "this address"}
          </a>
        </div>
      </div>
    </aside>
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
  return {
    select: (f: Flow) => setPicked((p) => (p?.id === f.id ? null : f)),
    selectedKey: flow?.id ?? null,
    panel: flow && <FlowDetail flow={flow} now={now} ended={live && !fresh} onClose={() => setPicked(null)} />,
  };
}
