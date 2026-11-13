import { useMemo } from "react";
import { TrafficCard } from "@/components/charts/TrafficCard";
import { SplitBar } from "@/components/data/Bars";
import { DeviceLink, KindPill } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { DataTable, type Column } from "@/components/data/DataTable";
import { FlowsTable } from "@/components/data/FlowsTable";
import { StatStrip } from "@/components/data/Stat";
import type { DomainResp, TargetDevice } from "@/lib/api";
import { ago, bytes, count, fullTime, ts } from "@/lib/format";
import { rangeLabel, rangeStore } from "@/lib/store";
import { useApi } from "@/lib/useApi";

export function Domain({ target }: { target: string }) {
  const range = rangeStore.use();
  const { data, error } = useApi<DomainResp>(`api/domain?target=${encodeURIComponent(target)}&range=${range}`, 30000);
  const devs = data?.target === target ? (data.devices ?? []) : [];
  const max = Math.max(0, ...devs.map((d) => d.up + d.down));
  const columns = useMemo<Column<TargetDevice>[]>(
    () => [
      {
        key: "name",
        title: "Device",
        sort: (d) => d.name.toLowerCase(),
        render: (d) => (
          <>
            <DeviceLink k={d.key} name={d.name} />
            <KindPill kind={d.kind} />
          </>
        ),
        className: "max-w-56 truncate",
      },
      { key: "total", title: "Share", sort: (d) => d.up + d.down, render: (d) => <SplitBar down={d.down} up={d.up} max={max} />, className: "w-[18%] min-w-20" },
      { key: "down", title: "Down", num: true, sort: (d) => d.down, render: (d) => bytes(d.down) },
      { key: "up", title: "Up", num: true, sort: (d) => d.up, render: (d) => bytes(d.up) },
      { key: "conns", title: "Flows", num: true, sort: (d) => d.conns, render: (d) => count(d.conns) },
      { key: "first", title: "First contact", num: true, sort: (d) => d.target_first_seen, render: (d) => <span title={fullTime(d.target_first_seen)}>{ts(d.target_first_seen)}</span> },
      { key: "last", title: "Last contact", num: true, sort: (d) => d.target_last_seen, render: (d) => <span className="text-ink-2">{ago(d.target_last_seen)}</span> },
    ],
    [max],
  );

  if (!data || data.target !== target) return error ? <ErrorNote error={error} /> : null;
  const tot = devs.reduce((a, d) => ({ up: a.up + d.up, down: a.down + d.down, c: a.c + d.conns }), { up: 0, down: 0, c: 0 });

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <div className="flex min-h-9 flex-wrap items-baseline gap-x-3">
        <h1 className="min-w-0 text-[18px] font-semibold tracking-[-0.02em] break-all text-ink">{target}</h1>
        <span className="text-[12px] text-ink-2">who contacted this destination in the last {rangeLabel(range)}</span>
      </div>
      <StatStrip
        items={[
          { label: "Devices", value: count(devs.length) },
          { label: "Downloaded", swatch: "down", value: bytes(tot.down) },
          { label: "Uploaded", swatch: "up", value: bytes(tot.up) },
          { label: "Flows", value: count(tot.c) },
        ]}
      />
      <div className="grid grid-cols-12 gap-3">
        <TrafficCard series={data.series} bucket={data.bucket} className="col-span-12 xl:col-span-6" />
        <Card title="Devices" meta={`${devs.length}`} flush className="col-span-12 xl:col-span-6">
          <DataTable columns={columns} rows={devs} rowKey={(d) => d.key} maxHeight="15.5rem" defaultSort={{ key: "total", dir: -1 }} />
        </Card>
      </div>
      <Card title="Recent flows" meta={`latest ${(data.recent_flows ?? []).length}`} flush>
        <FlowsTable flows={data.recent_flows} target={false} />
      </Card>
    </div>
  );
}
