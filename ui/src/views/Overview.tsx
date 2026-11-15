import { useMemo } from "react";
import { FlowSankey } from "@/components/charts/FlowSankey";
import { RouteSplit } from "@/components/charts/RouteSplit";
import { TrafficCard } from "@/components/charts/TrafficCard";
import { fillSeries } from "@/components/charts/TrafficChart";
import { SplitBar } from "@/components/data/Bars";
import { DeviceLink, Fig, KindPill, OpenDot, TargetLink } from "@/components/data/Bits";
import { Card, CardLink, Empty, ErrorNote } from "@/components/data/Card";
import { AnimatedNumber, ViewSkeleton } from "@/components/data/Motion";
import { CompactStat } from "@/components/data/Compact";
import { DataTable, type Column } from "@/components/data/DataTable";
import { ScrollFade } from "@/components/data/ScrollFade";
import { StatStrip } from "@/components/data/Stat";
import type { Device, Overview as OverviewData, TargetStat } from "@/lib/api";
import { ago, bytes, count, rate, ts } from "@/lib/format";
import { useNarrow } from "@/lib/media";
import { href } from "@/lib/router";
import { rangeLabel, rangeSeconds, rangeStore, usePulse } from "@/lib/store";
import { useApi } from "@/lib/useApi";

export function Overview({ dark }: { dark: boolean }) {
  const range = rangeStore.use();
  const { data, error } = useApi<OverviewData>(`api/overview?range=${range}`, 30000);
  const { status } = usePulse();

  const narrow = useNarrow();
  const allDevices = data?.top_devices ?? [];
  const allTargets = data?.top_targets ?? [];
  // a phone gets the top five of each; the full lists are one tap away
  const devices = narrow ? allDevices.slice(0, 5) : allDevices;
  const targets = narrow ? allTargets.slice(0, 5) : allTargets;
  const devMax = Math.max(0, ...devices.map((d) => d.up + d.down));
  const tgtMax = Math.max(0, ...targets.map((t) => t.up + t.down));

  const deviceCols = useMemo<Column<Device>[]>(
    () => [
      {
        key: "name",
        title: "Device",
        render: (d) => (
          <>
            <DeviceLink k={d.key} name={d.name} kind={d.kind} glyph />
            <KindPill kind={d.kind} />
          </>
        ),
        className: "max-w-52 truncate",
      },
      { key: "share", title: "", render: (d) => <SplitBar down={d.down} up={d.up} max={devMax} />, className: "w-[30%]" },
      { key: "down", title: "Down", num: true, render: (d) => <Fig>{bytes(d.down)}</Fig> },
      { key: "up", title: "Up", num: true, render: (d) => <Fig>{bytes(d.up)}</Fig> },
      { key: "open", title: "Open", num: true, render: (d) => <OpenDot n={d.open} /> },
    ],
    [devMax],
  );
  const targetCols = useMemo<Column<TargetStat>[]>(
    () => [
      { key: "target", title: "Domain / IP", render: (t) => <TargetLink target={t.target} />, className: "max-w-64 truncate" },
      { key: "share", title: "", render: (t) => <SplitBar down={t.down} up={t.up} max={tgtMax} />, className: "w-[26%]" },
      { key: "down", title: "Down", num: true, render: (t) => <Fig>{bytes(t.down)}</Fig> },
      { key: "up", title: "Up", num: true, render: (t) => <Fig>{bytes(t.up)}</Fig> },
      { key: "devices", title: "Devices", num: true, render: (t) => count(t.devices) },
    ],
    [tgtMax],
  );

  const filled = useMemo(() => fillSeries(data?.series ?? null, data?.bucket ?? 3600), [data?.series, data?.bucket]);

  if (!data) return error ? <ErrorNote error={error} /> : <ViewSkeleton kind="dashboard" />;
  const t = data.totals;
  const period = `last ${rangeLabel(range)}`;
  const secs = rangeSeconds(range);
  const whole = (n: number) => count(Math.round(n));

  return (
    <div className="view flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <StatStrip
        items={[
          {
            label: "Downloaded",
            swatch: "down",
            num: t.down,
            format: bytes,
            hint: `avg ${rate(t.down / secs)}`,
            spark: filled.map((p) => p.down),
          },
          {
            label: "Uploaded",
            swatch: "up",
            num: t.up,
            format: bytes,
            hint: `avg ${rate(t.up / secs)}`,
            spark: filled.map((p) => p.up),
          },
          {
            label: "Open now",
            live: true,
            num: status?.open_all ?? data.open,
            format: whole,
            hint: status ? (
              <>
                ↓ <AnimatedNumber value={status.rate_down} format={rate} /> · ↑ <AnimatedNumber value={status.rate_up} format={rate} />
              </>
            ) : (
              " "
            ),
          },
          { label: "Active devices", num: t.devices, format: whole, hint: "with traffic in range" },
          { label: "Destinations", num: t.targets, format: whole, hint: "domains and bare IPs" },
          { label: "Flows", num: t.conns, format: whole, hint: "started in range" },
        ]}
      />

      <div className="grid grid-cols-12 gap-3">
        <TrafficCard series={data.series} bucket={data.bucket} meta={period} className="col-span-12 xl:col-span-8" />
        <Card
          title="Routing"
          meta="share of bytes · flows started in range"
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
          <div className="sm:h-[19.5rem]">
            <FlowSankey links={data.links} devices={allDevices} targets={allTargets} />
          </div>
        </Card>
        <Card
          title="New destinations"
          meta="first contact"
          flush
          className="col-span-12 xl:col-span-4"
          bodyClassName="relative sm:max-xl:min-h-[297px]"
        >
          {(data.new_targets ?? []).length === 0 ? (
            <Empty>No new destinations in this range.</Empty>
          ) : (
            <ScrollFade className="sm:absolute sm:inset-0">
            <ul className="text-[12.5px]">
              {(narrow ? (data.new_targets ?? []).slice(0, 5) : (data.new_targets ?? [])).map((n) => (
                <li
                  key={n.device_key + "\n" + n.target}
                  className="flex h-[33px] items-center gap-2.5 border-b border-line-soft px-3.5 transition-colors duration-75 last:border-b-0 hover:bg-hover"
                >
                  <TargetLink target={n.target} className="min-w-0 flex-1" keepSuffix />
                  <DeviceLink k={n.device_key} name={n.device_name} className="max-w-32 shrink-0 truncate text-[11.5px] font-normal text-ink-2" />
                  <span className="w-12 shrink-0 text-right text-[11.5px] text-ink-3" title={ts(n.first_seen)}>
                    {ago(n.first_seen)}
                  </span>
                </li>
              ))}
            </ul>
            </ScrollFade>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Card
          title="Top devices"
          flush
          className="col-span-12 xl:col-span-6"
          actions={
<CardLink href={href.devices}>All devices</CardLink>
          }
        >
          <DataTable
            columns={deviceCols}
            rows={devices}
            rowKey={(d) => d.key}
            rowHref={(d) => href.device(d.key)}
            compact={(d) => (
              <CompactStat
                lead={<DeviceLink k={d.key} name={d.name} kind={d.kind} glyph />}
                sub={d.open ? `${count(d.open)} open` : "idle"}
                down={d.down}
                up={d.up}
                max={devMax}
              />
            )}
          />
        </Card>
        <Card
          title="Top destinations"
          flush
          className="col-span-12 xl:col-span-6"
          actions={
<CardLink href={href.domains}>All domains</CardLink>
          }
        >
          <DataTable
            columns={targetCols}
            rows={targets}
            rowKey={(x) => x.target}
            rowHref={(x) => href.domain(x.target)}
            compact={(x) => (
              <CompactStat
                lead={<TargetLink target={x.target} />}
                sub={`${count(x.devices)} device${x.devices === 1 ? "" : "s"}`}
                down={x.down}
                up={x.up}
                max={tgtMax}
              />
            )}
          />
        </Card>
      </div>
    </div>
  );
}
