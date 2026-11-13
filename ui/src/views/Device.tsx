import { Check, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { TrafficCard } from "@/components/charts/TrafficCard";
import { SplitBar } from "@/components/data/Bars";
import { KindPill, Mono, TargetLink } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { DataTable, type Column } from "@/components/data/DataTable";
import { AllFlowsLink, FlowsTable } from "@/components/data/FlowsTable";
import { StatStrip } from "@/components/data/Stat";
import { setDeviceName, type DeviceResp, type TargetStat } from "@/lib/api";
import { ago, bytes, count, fullTime, ts } from "@/lib/format";
import { rangeLabel, rangeStore } from "@/lib/store";
import { useApi } from "@/lib/useApi";

type IP = NonNullable<DeviceResp["ips"]>[number];

export function Device({ deviceKey, onName }: { deviceKey: string; onName: (name: string) => void }) {
  const range = rangeStore.use();
  const { data, error, reload } = useApi<DeviceResp>(
    `api/device?key=${encodeURIComponent(deviceKey)}&range=${range}`,
    30000,
  );
  const dev = data?.device.key === deviceKey ? data.device : null;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (dev) onName(dev.name);
  }, [dev?.name]);
  useEffect(() => setEditing(false), [deviceKey]);

  const top = data?.top_targets ?? [];
  const max = Math.max(0, ...top.map((t) => t.up + t.down));
  const topCols = useMemo<Column<TargetStat>[]>(
    () => [
      { key: "target", title: "Domain / IP", sort: (t) => t.target, render: (t) => <TargetLink target={t.target} />, className: "max-w-64 truncate" },
      { key: "total", title: "Share", sort: (t) => t.up + t.down, render: (t) => <SplitBar down={t.down} up={t.up} max={max} />, className: "w-[24%]" },
      { key: "down", title: "Down", num: true, sort: (t) => t.down, render: (t) => bytes(t.down) },
      { key: "up", title: "Up", num: true, sort: (t) => t.up, render: (t) => bytes(t.up) },
      { key: "conns", title: "Flows", num: true, sort: (t) => t.conns, render: (t) => count(t.conns) },
    ],
    [max],
  );
  const newCols = useMemo<Column<TargetStat>[]>(
    () => [
      { key: "target", title: "Domain / IP", sort: (t) => t.target, render: (t) => <TargetLink target={t.target} />, className: "max-w-64 truncate" },
      { key: "first", title: "First seen", num: true, sort: (t) => t.first_seen ?? 0, render: (t) => <span title={fullTime(t.first_seen ?? 0)}>{ts(t.first_seen)}</span> },
      { key: "last", title: "Last seen", num: true, sort: (t) => t.last_seen ?? 0, render: (t) => <span className="text-ink-2">{ago(t.last_seen)}</span> },
    ],
    [],
  );
  const ipCols = useMemo<Column<IP>[]>(
    () => [
      { key: "ip", title: "IP", sort: (i) => i.ip, render: (i) => <span title={i.ip}><Mono className="text-ink">{i.ip}</Mono></span>, className: "max-w-52 truncate" },
      { key: "src", title: "Source", sort: (i) => i.src, render: (i) => <span className="text-ink-2">{i.src}</span> },
      { key: "first", title: "First seen", num: true, sort: (i) => i.first_seen, render: (i) => ts(i.first_seen) },
      { key: "last", title: "Last seen", num: true, sort: (i) => i.last_seen, render: (i) => <span className="text-ink-2">{ago(i.last_seen)}</span> },
    ],
    [],
  );

  if (!data || !dev) return error ? <ErrorNote error={error} /> : null;

  const save = async () => {
    try {
      await setDeviceName(deviceKey, name);
      setSaveError(null);
      setEditing(false);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const ips = data.ips ?? [];
  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
        {editing ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              autoFocus
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              placeholder={dev.hostname || dev.key}
              aria-label="Friendly name"
              className="h-8 w-64 rounded-control bg-field px-2.5 text-[15px] font-semibold text-ink shadow-[0_0_0_1.5px_var(--accent)] outline-none placeholder:font-normal placeholder:text-ink-3"
            />
            <Button type="submit" variant="accent" size="sm">
              <Check size={13} aria-hidden /> Save
            </Button>
            <Button type="button" variant="quiet" size="sm" onClick={() => setEditing(false)} aria-label="Cancel rename">
              <X size={13} aria-hidden />
            </Button>
            {saveError && <span className="text-[12px] text-red">{saveError}</span>}
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="truncate text-[18px] font-semibold tracking-[-0.02em] text-ink">{dev.name}</h1>
            <KindPill kind={dev.kind} />
            <button
              type="button"
              onClick={() => {
                setName(dev.friendly_name);
                setSaveError(null);
                setEditing(true);
              }}
              title="Set a friendly name"
              aria-label="Set a friendly name"
              className="primitive-icon-button text-ink-3 hover:bg-hover-2 hover:text-ink"
            >
              <Pencil size={13} aria-hidden />
            </button>
          </div>
        )}
        <dl className="tnum flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-ink-2">
          <Meta label="Key" value={<Mono>{dev.key}</Mono>} />
          {dev.hostname && <Meta label="Hostname" value={dev.hostname} />}
          {dev.last_ip4 && <Meta label="IPv4" value={<Mono>{dev.last_ip4}</Mono>} />}
          <Meta label="First seen" value={ts(dev.first_seen)} />
          <Meta label="Last seen" value={ago(dev.last_seen)} />
        </dl>
      </div>

      <StatStrip
        items={[
          { label: "Downloaded", swatch: "down", value: bytes(data.totals.down), hint: `last ${rangeLabel(range)}` },
          { label: "Uploaded", swatch: "up", value: bytes(data.totals.up) },
          { label: "Flows", value: count(data.totals.conns) },
          { label: "Domains / IPs", value: count(data.totals.targets) },
          { label: "Open now", value: count(data.open) },
        ]}
      />

      <div className="grid grid-cols-12 gap-3">
        <TrafficCard series={data.series} bucket={data.bucket} className={ips.length ? "col-span-12 xl:col-span-7" : "col-span-12"} />
        {ips.length > 0 && (
          <Card title="Addresses seen" meta={`${ips.length}`} flush className="col-span-12 xl:col-span-5">
            <DataTable columns={ipCols} rows={ips} rowKey={(i) => i.ip} maxHeight="15.5rem" />
          </Card>
        )}
      </div>

      <div className="grid grid-cols-12 gap-3">
        <Card title="Top domains" meta={`${top.length}`} flush className="col-span-12 xl:col-span-7">
          <DataTable columns={topCols} rows={top} rowKey={(t) => t.target} maxHeight="22rem" defaultSort={{ key: "total", dir: -1 }} />
        </Card>
        <Card
          title="First seen in this range"
          meta="since netwatch started recording"
          flush
          className="col-span-12 xl:col-span-5"
        >
          <DataTable
            columns={newCols}
            rows={data.new_targets ?? []}
            rowKey={(t) => t.target}
            maxHeight="22rem"
            empty="No new destinations in this range."
          />
        </Card>
      </div>

      <Card
        title="Recent flows"
        meta={`latest ${(data.recent_flows ?? []).length}`}
        actions={<AllFlowsLink query={`device:${deviceKey}`} />}
        flush
      >
        <FlowsTable flows={data.recent_flows} device={false} />
      </Card>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-ink-2">{value}</dd>
    </div>
  );
}
