import { useMemo } from "react";
import { DeviceLink, Mono, SourcePill, TargetLink } from "@/components/data/Bits";
import { DataTable, type Column } from "@/components/data/DataTable";
import type { Flow } from "@/lib/api";
import { bytes, dur, fullTime, rate, ts } from "@/lib/format";

export const dest = (f: Flow) => (f.dst_ip.includes(":") ? `[${f.dst_ip}]:${f.dst_port}` : `${f.dst_ip}:${f.dst_port}`);
export const proto = (f: Flow) => [f.network, f.protocol].filter(Boolean).join("/");
export const routeOf = (f: Flow) => f.chain || f.outbound || (f.source === "conntrack" ? "direct · bypasses sing-box" : "");

/** Columns shared by the recent-flows tables and the live table. */
export function flowColumns(opts: { device?: boolean; target?: boolean; live?: boolean; now: number }): Column<Flow>[] {
  const cols: Column<Flow>[] = [];
  if (!opts.live) {
    cols.push({
      key: "created_at",
      title: "Started",
      sort: (f) => f.created_at,
      render: (f) => <span title={fullTime(f.created_at)}>{ts(f.created_at)}</span>,
      className: "text-ink-2",
    });
  }
  if (opts.device !== false) {
    cols.push({
      key: "device",
      title: "Device",
      sort: (f) => f.device_name.toLowerCase(),
      render: (f) => <DeviceLink k={f.device_key} name={f.device_name} />,
      className: "max-w-44 truncate",
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
          <SourcePill flow={f} />
        </>
      ),
      className: "max-w-72 truncate",
    });
  }
  cols.push(
    { key: "dst", title: "Destination", sort: dest, render: (f) => <Mono>{dest(f)}</Mono> },
    { key: "proto", title: "Proto", sort: proto, render: (f) => <span className="text-ink-2">{proto(f)}</span> },
    {
      key: "route",
      title: "Route",
      sort: routeOf,
      render: (f) => <span className="text-ink-2">{routeOf(f)}</span>,
      className: "max-w-48 truncate",
    },
  );
  if (opts.live) {
    cols.push(
      {
        key: "rate_down",
        title: "↓ rate",
        num: true,
        sort: (f) => f.rate_down ?? 0,
        render: (f) => (f.rate_down ? rate(f.rate_down) : <span className="text-ink-3">–</span>),
      },
      {
        key: "rate_up",
        title: "↑ rate",
        num: true,
        sort: (f) => f.rate_up ?? 0,
        render: (f) => (f.rate_up ? rate(f.rate_up) : <span className="text-ink-3">–</span>),
      },
    );
  }
  cols.push(
    { key: "down", title: "Down", num: true, sort: (f) => f.down, render: (f) => bytes(f.down) },
    { key: "up", title: "Up", num: true, sort: (f) => f.up, render: (f) => bytes(f.up) },
    {
      key: "dur",
      title: opts.live ? "Age" : "Duration",
      num: true,
      sort: (f) => (f.closed_at ?? opts.now) - f.created_at,
      render: (f) =>
        f.closed_at ? (
          dur(f.closed_at - f.created_at)
        ) : (
          <span className="inline-flex items-center gap-1.5" title={opts.live ? undefined : "still open"}>
            {dur(opts.now - f.created_at)}
            {!opts.live && <span aria-hidden className="size-1.5 rounded-full bg-green" />}
          </span>
        ),
    },
  );
  return cols;
}

export function FlowsTable({
  flows,
  device,
  target,
  maxHeight = "26rem",
}: {
  flows: Flow[] | null;
  device?: boolean;
  target?: boolean;
  maxHeight?: string;
}) {
  const columns = useMemo(() => flowColumns({ device, target, now: Date.now() }), [device, target, flows]);
  return (
    <DataTable
      columns={columns}
      rows={flows ?? []}
      rowKey={(f) => f.id}
      empty="No flows recorded."
      maxHeight={maxHeight}
    />
  );
}
