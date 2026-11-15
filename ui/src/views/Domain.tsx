import { Globe } from "lucide-react";
import { useMemo } from "react";
import { TrafficCard } from "@/components/charts/TrafficCard";
import { SplitBar } from "@/components/data/Bars";
import { DeviceLink, Fig, isIp, KindPill } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { CompactStat } from "@/components/data/Compact";
import { DataTable, type Column } from "@/components/data/DataTable";
import { AllFlowsLink, FlowsTable } from "@/components/data/FlowsTable";
import { ViewSkeleton } from "@/components/data/Motion";
import { StatStrip } from "@/components/data/Stat";
import type { DomainResp, TargetDevice } from "@/lib/api";
import { ago, bytes, count, fullTime, ts } from "@/lib/format";
import { href } from "@/lib/router";
import { rangeLabel, rangeStore } from "@/lib/store";
import { cn } from "@/lib/utils";
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
            <DeviceLink k={d.key} name={d.name} kind={d.kind} glyph />
            <KindPill kind={d.kind} />
          </>
        ),
        className: "max-w-52 truncate",
      },
      { key: "total", title: "Share", sort: (d) => d.up + d.down, render: (d) => <SplitBar down={d.down} up={d.up} max={max} />, className: "w-[16%] min-w-16" },
      { key: "down", title: "Down", num: true, sort: (d) => d.down, render: (d) => <Fig>{bytes(d.down)}</Fig> },
      { key: "up", title: "Up", num: true, sort: (d) => d.up, render: (d) => <Fig>{bytes(d.up)}</Fig> },
      { key: "conns", title: "Flows", num: true, sort: (d) => d.conns, render: (d) => count(d.conns) },
      { key: "first", title: "First contact", hide: "lg", right: true, sort: (d) => d.target_first_seen, render: (d) => <span title={fullTime(d.target_first_seen)}>{ts(d.target_first_seen)}</span> },
      { key: "last", title: "Last contact", right: true, sort: (d) => d.target_last_seen, render: (d) => <span className="text-ink-2">{ago(d.target_last_seen)}</span> },
    ],
    [max],
  );

  if (!data || data.target !== target) return error ? <ErrorNote error={error} /> : <ViewSkeleton kind="detail" />;
  const whole = (n: number) => count(Math.round(n));
  const tot = devs.reduce((a, d) => ({ up: a.up + d.up, down: a.down + d.down, c: a.c + d.conns }), { up: 0, down: 0, c: 0 });

  return (
    <div className="view flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <div className="flex min-h-12 items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-field text-ink-2 shadow-hairline">
          <Globe size={19} strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <h1 className={cn("text-[19px] leading-6 font-semibold tracking-[-0.025em] break-all text-ink", isIp(target) && "num text-[17px] font-medium")}>
            {target}
          </h1>
          <p className="text-[12px] text-ink-3">
            {isIp(target) ? "Address with no sniffed domain" : "Destination"} · who contacted it in the last {rangeLabel(range)}
          </p>
        </div>
      </div>
      <StatStrip
        items={[
          { label: "Devices", num: devs.length, format: whole, hint: "contacted this destination" },
          { label: "Downloaded", swatch: "down", num: tot.down, format: bytes, hint: `last ${rangeLabel(range)}`, spark: (data.series ?? []).map((p) => p.down) },
          { label: "Uploaded", swatch: "up", num: tot.up, format: bytes, hint: `last ${rangeLabel(range)}`, spark: (data.series ?? []).map((p) => p.up) },
          { label: "Flows", num: tot.c, format: whole, hint: "started in range" },
        ]}
      />
      <div className="grid grid-cols-12 gap-3">
        <TrafficCard series={data.series} bucket={data.bucket} className="col-span-12 xl:col-span-5" />
        <Card title="Devices" meta={`${devs.length}`} flush className="col-span-12 xl:col-span-7">
          <DataTable columns={columns} rows={devs} rowKey={(d) => d.key} rowHref={(d) => href.device(d.key)}
            maxHeight="263px"
            defaultSort={{ key: "total", dir: -1 }}
            compact={(d) => (
              <CompactStat
                lead={<DeviceLink k={d.key} name={d.name} kind={d.kind} glyph />}
                sub={`${count(d.conns)} flows · seen ${ago(d.target_last_seen)}`}
                down={d.down}
                up={d.up}
                max={max}
              />
            )}
          />
        </Card>
      </div>
      <Card
        title="Recent flows"
        meta={`latest ${(data.recent_flows ?? []).length}`}
        actions={<AllFlowsLink query={target} />}
        flush
      >
        <FlowsTable flows={data.recent_flows} target={false} />
      </Card>
    </div>
  );
}
