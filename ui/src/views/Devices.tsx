import { useMemo, useState } from "react";
import { Sparkline, SplitBar } from "@/components/data/Bars";
import { Chips, DeviceLink, Fig, FilterInput, KindPill, Mono, OpenDot, Toggle, type Chip } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { CompactStat } from "@/components/data/Compact";
import { DataTable, type Column } from "@/components/data/DataTable";
import { ViewSkeleton } from "@/components/data/Motion";
import { StatStrip } from "@/components/data/Stat";
import type { Device, DevicesResp, Kind } from "@/lib/api";
import { ago, bytes, count, fullTime } from "@/lib/format";
import { href } from "@/lib/router";
import { idleStore, rangeLabel, rangeStore } from "@/lib/store";
import { useApi } from "@/lib/useApi";

type KindFilter = "all" | Kind;
const KIND_LABEL: Record<KindFilter, string> = { all: "All", lan: "LAN", remote: "Remote", router: "Router", unknown: "Unknown" };

export function Devices() {
  const range = rangeStore.use();
  const showIdle = idleStore.use() === "1";
  const { data, error } = useApi<DevicesResp>(`api/devices?range=${range}${showIdle ? "&all=1" : ""}`, 30000);
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");

  const all = data?.devices ?? [];
  const chips = useMemo<Chip<KindFilter>[]>(() => {
    const n = (k: Kind) => all.filter((d) => d.kind === k).length;
    return (["all", "lan", "remote", "router", "unknown"] as KindFilter[])
      .map((k) => ({ key: k, label: KIND_LABEL[k], count: k === "all" ? all.length : n(k) }))
      .filter((c) => c.key === "all" || c.count > 0);
  }, [all]);

  const rows = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(
      (d) =>
        (kind === "all" || d.kind === kind) &&
        words.every((w) => [d.name, d.key, d.hostname, d.last_ip4, d.last_ip6].some((s) => s?.toLowerCase().includes(w))),
    );
  }, [all, kind, query]);

  const max = Math.max(0, ...all.map((d) => d.up + d.down));
  const columns = useMemo<Column<Device>[]>(
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
        className: "max-w-60 truncate",
      },
      {
        key: "addr",
        title: "Address",
        sort: (d) => d.last_ip4 || d.last_ip6,
        render: (d) => <Mono>{d.last_ip4 || (d.kind === "lan" ? d.last_ip6 : "")}</Mono>,
        className: "max-w-40 truncate",
      },
      { key: "key", title: "MAC", hide: "lg", sort: (d) => d.key, render: (d) => (d.key === d.name ? <span className="text-ink-3">–</span> : <Mono className="text-ink-3">{d.key}</Mono>), className: "max-w-44 truncate" },
      { key: "trend", title: "Trend", hide: "md", render: (d) => (
          <span title="This device's traffic over the range, scaled to its own peak">
            <Sparkline values={d.spark} stroke="var(--ink-3)" area={false} />
          </span>
        ),
        className: "w-24",
      },
      {
        key: "total",
        title: "Share",
        sort: (d) => d.up + d.down,
        render: (d) => <SplitBar down={d.down} up={d.up} max={max} />,
        className: "w-[14%] min-w-24",
      },
      { key: "down", title: "Down", num: true, sort: (d) => d.down, render: (d) => <Fig>{bytes(d.down)}</Fig> },
      { key: "up", title: "Up", num: true, sort: (d) => d.up, render: (d) => <Fig>{bytes(d.up)}</Fig> },
      { key: "conns", title: "Flows", hide: "md", num: true, sort: (d) => d.conns, render: (d) => count(d.conns) },
      { key: "targets", title: "Domains", hide: "md", num: true, sort: (d) => d.targets ?? 0, render: (d) => count(d.targets) },
      { key: "open", title: "Open", num: true, sort: (d) => d.open ?? 0, render: (d) => <OpenDot n={d.open} /> },
      {
        key: "last_seen",
        title: "Last seen",
        right: true,
        sort: (d) => d.last_seen,
        render: (d) => (
          <span className="text-ink-2" title={fullTime(d.last_seen)}>
            {ago(d.last_seen)}
          </span>
        ),
      },
    ],
    [max],
  );

  if (!data) return error ? <ErrorNote error={error} /> : <ViewSkeleton kind="list" />;
  const active = all.filter((d) => d.up + d.down > 0);
  const online = all.filter((d) => d.open).length;
  const whole = (n: number) => count(Math.round(n));
  const tot = all.reduce((a, d) => ({ up: a.up + d.up, down: a.down + d.down, open: a.open + (d.open ?? 0) }), { up: 0, down: 0, open: 0 });

  const idleToggle = <Toggle checked={showIdle} onChange={(v) => idleStore.set(v ? "1" : "0")} label="Include idle" />;

  return (
    <div className="view flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <StatStrip
        items={[
          { label: "Active devices", num: active.length, format: whole, hint: `with traffic in the last ${rangeLabel(range)}` },
          { label: "Downloaded", swatch: "down", num: tot.down, format: bytes, hint: `across ${count(all.length)} listed` },
          { label: "Uploaded", swatch: "up", num: tot.up, format: bytes, hint: `across ${count(all.length)} listed` },
          { label: "Open connections", live: true, num: tot.open, format: whole, hint: `on ${count(online)} device${online === 1 ? "" : "s"}` },
        ]}
      />
      <Card
        flush
        wrapActions
        title="Devices"
        meta={rows.length === all.length ? `${all.length}` : `${rows.length} of ${all.length}`}
        actions={
          <>
            <div className="no-scrollbar edge-fade max-md:-mx-1 max-md:w-[calc(100%+0.5rem)] max-md:overflow-x-auto max-md:px-1 max-md:py-0.5">
              <Chips chips={chips} value={chips.some((c) => c.key === kind) ? kind : "all"} onChange={setKind} label="Device kind" />
            </div>
            <span className="max-sm:hidden">{idleToggle}</span>
            <FilterInput value={query} onChange={setQuery} placeholder="Filter name, MAC, IP" />
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(d) => d.key}
          rowHref={(d) => href.device(d.key)}
          defaultSort={{ key: "total", dir: -1 }}
          compactExtra={idleToggle}
          compact={(d) => (
            <CompactStat
              lead={
                <>
                  <DeviceLink k={d.key} name={d.name} kind={d.kind} glyph />
                  <KindPill kind={d.kind} />
                </>
              }
              sub={
                <>
                  <span>{d.open ? `${count(d.open)} open` : "idle"}</span>
                  <span aria-hidden>·</span>
                  <span className="num truncate text-[11px]">{d.last_ip4 || ago(d.last_seen)}</span>
                </>
              }
              down={d.down}
              up={d.up}
              max={max}
            />
          )}
          empty={all.length ? "No device matches the filter." : "No device had traffic in this range."}
        />
      </Card>
    </div>
  );
}
