import { useMemo } from "react";
import { FlowSankey } from "@/components/charts/FlowSankey";
import { RouteSplit } from "@/components/charts/RouteSplit";
import { TrafficCard } from "@/components/charts/TrafficCard";
import { SplitBar } from "@/components/data/Bars";
import { DeviceLink, KindPill, OpenDot, TargetLink } from "@/components/data/Bits";
import { Card, Empty, ErrorNote } from "@/components/data/Card";
import { DataTable, type Column } from "@/components/data/DataTable";
import { StatStrip } from "@/components/data/Stat";
import type { Device, Overview as OverviewData, TargetStat } from "@/lib/api";
import { ago, bytes, count, rate, ts } from "@/lib/format";
import { href } from "@/lib/router";
import { rangeLabel, rangeStore, usePulse } from "@/lib/store";
import { useApi } from "@/lib/useApi";

const moreCls = "rounded-full px-2 py-0.5 text-[12px] text-ink-2 hover:bg-hover-2 hover:text-ink";

export function Overview({ dark }: { dark: boolean }) {
  const range = rangeStore.use();
  const { data, error } = useApi<OverviewData>(`api/overview?range=${range}`, 30000);
  const { status } = usePulse();

  const devices = data?.top_devices ?? [];
  const targets = data?.top_targets ?? [];
  const devMax = Math.max(0, ...devices.map((d) => d.up + d.down));
  const tgtMax = Math.max(0, ...targets.map((t) => t.up + t.down));

  const deviceCols = useMemo<Column<Device>[]>(
    () => [
      {
        key: "name",
        title: "Device",
        render: (d) => (
          <>
            <DeviceLink k={d.key} name={d.name} />
            <KindPill kind={d.kind} />
          </>
        ),
        className: "max-w-48 truncate",
      },
      { key: "share", title: "", render: (d) => <SplitBar down={d.down} up={d.up} max={devMax} />, className: "w-[30%]" },
      { key: "down", title: "Down", num: true, render: (d) => bytes(d.down) },
      { key: "up", title: "Up", num: true, render: (d) => bytes(d.up) },
      { key: "open", title: "Open", num: true, render: (d) => <OpenDot n={d.open} /> },
    ],
    [devMax],
  );
  const targetCols = useMemo<Column<TargetStat>[]>(
    () => [
      { key: "target", title: "Domain / IP", render: (t) => <TargetLink target={t.target} />, className: "max-w-64 truncate" },
      { key: "share", title: "", render: (t) => <SplitBar down={t.down} up={t.up} max={tgtMax} />, className: "w-[26%]" },
      { key: "down", title: "Down", num: true, render: (t) => bytes(t.down) },
      { key: "up", title: "Up", num: true, render: (t) => bytes(t.up) },
      { key: "devices", title: "Devices", num: true, render: (t) => count(t.devices) },
    ],
    [tgtMax],
  );

  if (!data) return error ? <ErrorNote error={error} /> : null;
  const t = data.totals;
  const period = `last ${rangeLabel(range)}`;

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <StatStrip
        items={[
          { label: "Downloaded", swatch: "down", value: bytes(t.down), hint: period },
          { label: "Uploaded", swatch: "up", value: bytes(t.up), hint: period },
          { label: "Active devices", value: count(t.devices), hint: "with traffic in range" },
          { label: "Destinations", value: count(t.targets), hint: "domains and bare IPs" },
          { label: "Flows", value: count(t.conns), hint: "started in range" },
          {
            label: "Open now",
            value: count(status?.open_all ?? data.open),
            hint: status ? `↓ ${rate(status.rate_down)} · ↑ ${rate(status.rate_up)}` : " ",
          },
        ]}
      />

      <div className="grid grid-cols-12 gap-3">
        <TrafficCard series={data.series} bucket={data.bucket} meta={period} className="col-span-12 xl:col-span-8" />
        <Card
          title="Routing"
          meta="flows started in range"
          className="col-span-12 xl:col-span-4"
        >
          <RouteSplit routes={data.routes} dark={dark} />
        </Card>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Card
          title="Who talks to what"
          meta="top devices → top destinations, by bytes"
          className="col-span-12 xl:col-span-8"
        >
          <div className="h-80">
            <FlowSankey links={data.links} devices={devices} targets={targets} />
          </div>
        </Card>
        <Card
          title="New destinations"
          meta="first contact"
          flush
          className="col-span-12 xl:col-span-4"
          bodyClassName="max-h-[21.5rem] overflow-y-auto"
        >
          {(data.new_targets ?? []).length === 0 ? (
            <Empty>No new destinations in this range.</Empty>
          ) : (
            <ul className="text-[12.5px]">
              {(data.new_targets ?? []).map((n) => (
                <li
                  key={n.device_key + "\n" + n.target}
                  className="flex h-[30px] items-center gap-2 border-b border-line-soft px-3 last:border-b-0 hover:bg-hover"
                >
                  <TargetLink target={n.target} className="min-w-0 flex-1 truncate" />
                  <DeviceLink k={n.device_key} name={n.device_name} className="max-w-28 shrink-0 truncate font-normal text-ink-2" />
                  <span className="tnum w-14 shrink-0 text-right text-ink-3" title={ts(n.first_seen)}>
                    {ago(n.first_seen)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Card
          title="Top devices"
          flush
          className="col-span-12 xl:col-span-6"
          actions={
            <a href={href.devices} className={moreCls}>
              All devices
            </a>
          }
        >
          <DataTable columns={deviceCols} rows={devices} rowKey={(d) => d.key} />
        </Card>
        <Card
          title="Top destinations"
          flush
          className="col-span-12 xl:col-span-6"
          actions={
            <a href={href.domains} className={moreCls}>
              All domains
            </a>
          }
        >
          <DataTable columns={targetCols} rows={targets} rowKey={(x) => x.target} />
        </Card>
      </div>
    </div>
  );
}
