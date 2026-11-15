import { useMemo, type ReactNode } from "react";
import { DeviceLink, Fig, isIp, isMac, Mono, TargetLink } from "@/components/data/Bits";
import { CardLink } from "@/components/data/Card";
import { DataTable, type Column } from "@/components/data/DataTable";
import { useFlowDetail } from "@/components/data/FlowDetail";
import { Dot } from "@/components/data/Motion";
import type { Flow } from "@/lib/api";
import { bytes, dur, fullTime, rate, ts } from "@/lib/format";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

export const dest = (f: Flow) => (f.dst_ip.includes(":") ? `[${f.dst_ip}]:${f.dst_port}` : `${f.dst_ip}:${f.dst_port}`);
export const proto = (f: Flow) => [f.network, f.protocol].filter(Boolean).join("/");
export const routeOf = (f: Flow) => f.chain || f.outbound || (f.source === "conntrack" ? `bypass ${f.inbound}` : "");

/** A flow standing for a run of look-alikes (see collapseRuns). */
export type FlowRow = Flow & { repeats?: number };

/**
 * The route a flow took: the sing-box outbound chain, or "bypass" plus the
 * conntrack class for traffic sing-box never saw. The same wording as the
 * routing split on the Overview.
 */
export function Route({ flow }: { flow: Flow }) {
  const chain = flow.chain || flow.outbound;
  if (!chain) {
    if (flow.source !== "conntrack") return null;
    return (
      <span className="text-ink-2" title="Seen by router conntrack only: this traffic never passed through sing-box">
        bypass<span className="px-1 text-ink-3">·</span>
        {flow.inbound.replace(/^ct:/, "")}
      </span>
    );
  }
  const hops = chain.split(/\s*>\s*/);
  return (
    <span className="text-ink-2" title={`sing-box outbound chain: ${chain}`}>
      {hops.map((h, i) => (
        <span key={i}>
          {i > 0 && <span className="px-1 text-ink-3">›</span>}
          {h}
        </span>
      ))}
    </span>
  );
}

const Repeats = ({ n }: { n?: number }) =>
  n && n > 1 ? (
    <span
      className="num ml-1.5 rounded-[5px] bg-field px-1 py-px text-[10.5px] text-ink-2 shadow-hairline"
      title={`${n} consecutive connections to the same destination over the same route; the latest is shown`}
    >
      ×{n}
    </span>
  ) : null;

type Opts = { device?: boolean; target?: boolean; live?: boolean; now: number };

/** Columns shared by the recent-flows tables and the live table. */
export function flowColumns(opts: Opts): Column<FlowRow>[] {
  const cols: Column<FlowRow>[] = [];
  if (!opts.live) {
    cols.push({
      key: "created_at",
      title: "Started",
      sort: (f) => f.created_at,
      render: (f) => <span title={fullTime(f.created_at)}>{ts(f.created_at)}</span>,
      className: "text-ink-2 tabular-nums",
    });
  }
  if (opts.device !== false) {
    cols.push({
      key: "device",
      title: "Device",
      sort: (f) => f.device_name.toLowerCase(),
      render: (f) => <DeviceLink k={f.device_key} name={f.device_name} />,
      className: "dock-narrow max-w-44 truncate",
    });
  }
  if (opts.target !== false) {
    cols.push({
      key: "target",
      title: "Domain / IP",
      sort: (f) => f.target,
      render: (f) => (
        <>
          <TargetLink target={f.target} />
          <Repeats n={f.repeats} />
        </>
      ),
      className: "dock-narrow max-w-64 truncate",
    });
  }
  cols.push(
    {
      key: "dst",
      title: "Destination",
      sort: dest,
      render: (f) => (
        <span title={dest(f)}>
          {f.target === f.dst_ip ? (
            <Mono className="text-ink-3">
              <span aria-hidden>same</span> :{f.dst_port}
            </Mono>
          ) : (
            <Mono>{dest(f)}</Mono>
          )}
          {opts.target === false && <Repeats n={f.repeats} />}
        </span>
      ),
      className: "max-w-52 truncate",
      // the live table carries four more figures; the address is in the row's details
      hide: opts.live ? "2xl" : "lg",
      dockHide: true,
    },
    { key: "proto", title: "Proto", sort: proto, render: (f) => <Mono>{proto(f)}</Mono>, hide: "md", dockHide: true },
    {
      key: "route",
      title: "Route",
      sort: routeOf,
      render: (f) => <Route flow={f} />,
      className: "max-w-48 truncate",
    },
  );
  if (opts.live) {
    cols.push(
      { key: "rate_down", title: "↓ rate", num: true, sort: (f) => f.rate_down ?? 0, render: (f) => <Fig>{rate(f.rate_down)}</Fig> },
      { key: "rate_up", title: "↑ rate", num: true, sort: (f) => f.rate_up ?? 0, render: (f) => <Fig>{rate(f.rate_up)}</Fig> },
    );
  }
  cols.push(
    { key: "down", title: "Down", num: true, sort: (f) => f.down, render: (f) => <Fig>{bytes(f.down)}</Fig> },
    { key: "up", title: "Up", num: true, sort: (f) => f.up, render: (f) => <Fig>{bytes(f.up)}</Fig> },
    {
      key: "dur",
      title: opts.live ? "Age" : "Duration",
      num: true,
      sort: (f) => (f.closed_at ?? opts.now) - f.created_at,
      render: (f) =>
        f.closed_at ? (
          // the same slot an open flow's dot takes, so the figures line up
          <span className={opts.live ? undefined : "pr-3"}>{dur(f.closed_at - f.created_at)}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5" title={opts.live ? undefined : "still open"}>
            {dur(opts.now - f.created_at)}
            {!opts.live && <Dot />}
          </span>
        ),
    },
  );
  return cols;
}

const Sep = () => <span aria-hidden>·</span>;

/** A connection on a phone: who and where on the first line, how on the second. */
export function flowCompact(opts: Opts): (f: FlowRow) => ReactNode {
  return (f) => {
    const open = !f.closed_at;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <div className={cn("min-w-0 flex-1 truncate text-[13px] text-ink", isIp(f.target) && "num text-[12px]")}>
            {opts.target === false ? dest(f) : f.target}
            <Repeats n={f.repeats} />
          </div>
          <span className="num flex shrink-0 items-center text-[11.5px]">
            <span className={cn("flex items-center justify-between", opts.live ? "w-[5.3rem]" : "w-[4.1rem]")}>
              <span className="text-down">↓</span>
              <Fig>{opts.live ? rate(f.rate_down) : bytes(f.down)}</Fig>
            </span>
            <span className={cn("ml-2 flex items-center justify-between", opts.live ? "w-[5.3rem]" : "w-[4.1rem]")}>
              <span className="text-up">↑</span>
              <Fig>{opts.live ? rate(f.rate_up) : bytes(f.up)}</Fig>
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
            {opts.device !== false && (
              <>
                <span className={cn("max-w-[9.5rem] shrink-0 truncate font-medium text-ink-2", isMac(f.device_name || f.device_key) && "num text-[11px] font-normal")}>
                  {f.device_name || f.device_key}
                </span>
                <Sep />
              </>
            )}
            <span className="shrink-0 max-[380px]:hidden">{proto(f)}</span>
            <span className="max-[380px]:hidden">
              <Sep />
            </span>
            <span className="min-w-0 truncate">
              <Route flow={f} />
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 tabular-nums" title={fullTime(f.created_at)}>
            {opts.live ? dur(opts.now - f.created_at) : `${dur(Math.max(0, opts.now - f.created_at))} ago`}
            {!opts.live && (open ? <Dot /> : <span aria-hidden className="size-1.5" />)}
          </span>
        </div>
      </div>
    );
  };
}

/**
 * Folds a run of consecutive connections that differ only in their source port
 * and timing (a client retrying a dead address, a torrent peer) into its latest
 * member, so one chatty destination does not push everything else off the list.
 */
export function collapseRuns(flows: Flow[]): FlowRow[] {
  const out: FlowRow[] = [];
  const key = (f: Flow) => [f.device_key, f.target, f.dst_ip, f.dst_port, f.network, f.protocol, routeOf(f)].join("\n");
  let last = "";
  for (const f of flows) {
    const k = key(f);
    const prev = out[out.length - 1];
    if (prev && k === last) prev.repeats = (prev.repeats ?? 1) + 1;
    else out.push({ ...f });
    last = k;
  }
  return out;
}

export function FlowsTable({
  flows,
  device,
  target,
  maxHeight = "428px", // header + 12 rows
}: {
  flows: Flow[] | null;
  device?: boolean;
  target?: boolean;
  maxHeight?: string;
}) {
  const now = useMemo(() => Date.now(), [flows]);
  const opts = useMemo(() => ({ device, target, now }), [device, target, now]);
  const columns = useMemo(() => flowColumns(opts), [opts]);
  const compact = useMemo(() => flowCompact(opts), [opts]);
  const rows = useMemo(() => collapseRuns(flows ?? []), [flows]);
  const detail = useFlowDetail(flows ?? [], now);
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(f) => f.id}
        empty="No flows recorded."
        maxHeight={maxHeight}
        onRowClick={detail.select}
        selectedKey={detail.selectedKey}
        compact={compact}
      />
      {detail.panel}
    </>
  );
}

/** Card action that opens the Connections view with a search filled in. */
export function AllFlowsLink({ query }: { query: string }) {
  return <CardLink href={href.connections(query)}>All connections</CardLink>;
}
