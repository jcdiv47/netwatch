import { useMemo, useState } from "react";
import { Sparkline, SplitBar } from "@/components/data/Bars";
import { Chips, DeviceLink, FilterInput, KindPill, Mono, OpenDot, type Chip } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { DataTable, type Column } from "@/components/data/DataTable";
import { StatStrip } from "@/components/data/Stat";
import type { Device, DevicesResp, Kind } from "@/lib/api";
import { ago, bytes, count, fullTime } from "@/lib/format";
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
            <DeviceLink k={d.key} name={d.name} />
            <KindPill kind={d.kind} />
          </>
        ),
        className: "max-w-56 truncate",
      },
      {
        key: "addr",
        title: "Address",
        sort: (d) => d.last_ip4 || d.last_ip6,
        render: (d) => <Mono>{d.last_ip4 || (d.kind === "lan" ? d.last_ip6 : "")}</Mono>,
        className: "max-w-40 truncate",
      },
      { key: "key", title: "MAC / key", sort: (d) => d.key, render: (d) => <Mono className="text-ink-3">{d.key}</Mono>, className: "max-w-44 truncate" },
      { key: "trend", title: "Trend", render: (d) => <Sparkline values={d.spark} />, className: "w-24" },
      { key: "down", title: "Down", num: true, sort: (d) => d.down, render: (d) => bytes(d.down) },
      { key: "up", title: "Up", num: true, sort: (d) => d.up, render: (d) => bytes(d.up) },
      {
        key: "total",
        title: "Share",
        sort: (d) => d.up + d.down,
        render: (d) => <SplitBar down={d.down} up={d.up} max={max} />,
        className: "w-[14%] min-w-24",
      },
      { key: "conns", title: "Flows", num: true, sort: (d) => d.conns, render: (d) => count(d.conns) },
      { key: "targets", title: "Domains", num: true, sort: (d) => d.targets ?? 0, render: (d) => count(d.targets) },
      { key: "open", title: "Open", num: true, sort: (d) => d.open ?? 0, render: (d) => <OpenDot n={d.open} /> },
      {
        key: "last_seen",
        title: "Last seen",
        num: true,
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

  if (!data) return error ? <ErrorNote error={error} /> : null;
  const active = all.filter((d) => d.up + d.down > 0);
  const tot = all.reduce((a, d) => ({ up: a.up + d.up, down: a.down + d.down, open: a.open + (d.open ?? 0) }), { up: 0, down: 0, open: 0 });

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <StatStrip
        items={[
          { label: "Active devices", value: count(active.length), hint: `last ${rangeLabel(range)}` },
          { label: "Downloaded", swatch: "down", value: bytes(tot.down) },
          { label: "Uploaded", swatch: "up", value: bytes(tot.up) },
          { label: "Open connections", value: count(tot.open), hint: "across listed devices" },
        ]}
      />
      <Card
        flush
        title="Devices"
        meta={rows.length === all.length ? `${all.length}` : `${rows.length} of ${all.length}`}
        actions={
          <>
            <Chips chips={chips} value={chips.some((c) => c.key === kind) ? kind : "all"} onChange={setKind} label="Device kind" />
            <label className="ml-2 flex items-center gap-1.5 text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={showIdle}
                onChange={(e) => idleStore.set(e.target.checked ? "1" : "0")}
                className="size-3.5 accent-(--accent)"
              />
              Include idle
            </label>
            <FilterInput value={query} onChange={setQuery} placeholder="Filter name, MAC, IP" className="ml-2" />
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(d) => d.key}
          defaultSort={{ key: "total", dir: -1 }}
          empty={all.length ? "No device matches the filter." : "No device had traffic in this range."}
        />
      </Card>
    </div>
  );
}
