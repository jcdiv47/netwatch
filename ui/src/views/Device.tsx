import { Activity, Check, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { TrafficCard } from "@/components/charts/TrafficCard";
import { SplitBar } from "@/components/data/Bars";
import { CopyChip, DeviceGlyph, Fig, isMac, KindPill, MetaChip, Mono, TargetLink } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { CompactStat } from "@/components/data/Compact";
import { DataTable, type Column } from "@/components/data/DataTable";
import { AllFlowsLink, FlowsTable } from "@/components/data/FlowsTable";
import { Dot, ViewSkeleton } from "@/components/data/Motion";
import { StatStrip } from "@/components/data/Stat";
import { setDeviceName, type DeviceResp, type TargetStat } from "@/lib/api";
import { ago, bytes, count, fullTime, ts } from "@/lib/format";
import { href } from "@/lib/router";
import { rangeLabel, rangeStore } from "@/lib/store";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";

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
      { key: "down", title: "Down", num: true, sort: (t) => t.down, render: (t) => <Fig>{bytes(t.down)}</Fig> },
      { key: "up", title: "Up", num: true, sort: (t) => t.up, render: (t) => <Fig>{bytes(t.up)}</Fig> },
      { key: "conns", title: "Flows", num: true, sort: (t) => t.conns, render: (t) => count(t.conns) },
    ],
    [max],
  );
  const newCols = useMemo<Column<TargetStat>[]>(
    () => [
      { key: "target", title: "Domain / IP", sort: (t) => t.target, render: (t) => <TargetLink target={t.target} />, className: "max-w-64 truncate" },
      { key: "first", title: "First seen", right: true, sort: (t) => t.first_seen ?? 0, render: (t) => <span title={fullTime(t.first_seen ?? 0)}>{ts(t.first_seen)}</span> },
      { key: "last", title: "Last seen", hide: "sm", right: true, sort: (t) => t.last_seen ?? 0, render: (t) => <span className="text-ink-2">{ago(t.last_seen)}</span> },
    ],
    [],
  );
  const ipCols = useMemo<Column<IP>[]>(
    () => [
      { key: "ip", title: "IP", sort: (i) => i.ip, render: (i) => <span title={i.ip}><Mono className="text-ink">{i.ip}</Mono></span>, className: "max-w-56 truncate" },
      { key: "src", title: "Source", hide: "sm", sort: (i) => i.src, render: (i) => <span className="text-ink-2">{i.src}</span> },
      { key: "first", title: "First seen", hide: "2xl", right: true, sort: (i) => i.first_seen, render: (i) => ts(i.first_seen) },
      { key: "last", title: "Last seen", right: true, sort: (i) => i.last_seen, render: (i) => <span className="text-ink-2">{ago(i.last_seen)}</span> },
    ],
    [],
  );

  if (!data || !dev) return error ? <ErrorNote error={error} /> : <ViewSkeleton kind="detail" />;
  const whole = (n: number) => count(Math.round(n));

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
    <div className="view flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2.5">
        <DeviceGlyph name={dev.name} kind={dev.kind} size="lg" />
        <div className="min-w-0">
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
                className="h-8 w-64 max-w-[52vw] rounded-control bg-field px-2.5 text-[15px] font-semibold max-md:h-9 max-md:text-[16px] text-ink shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_var(--accent-tint)] outline-none placeholder:font-normal placeholder:text-ink-3"
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
              <h1 className={cn("truncate text-[19px] leading-6 font-semibold tracking-[-0.025em] text-ink", isMac(dev.name) && "num text-[17px] font-medium")}>
                {dev.name}
              </h1>
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
                className="primitive-icon-button size-6! max-md:size-10! text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
              >
                <Pencil size={12.5} aria-hidden />
              </button>
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <Dot tone={data.open ? "green" : "idle"} live={data.open > 0} />
            {data.open ? `${count(data.open)} open connection${data.open === 1 ? "" : "s"}` : "No open connections"}
            <span aria-hidden>·</span>
            <span title={fullTime(dev.last_seen)}>seen {ago(dev.last_seen)}</span>
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 max-md:ml-0 max-sm:w-full">
          {dev.key !== dev.name && <CopyChip label={dev.kind === "lan" ? "MAC" : "Key"} value={dev.key} />}
          {dev.last_ip4 && <CopyChip label="IPv4" value={dev.last_ip4} />}
          {dev.hostname && dev.hostname !== dev.name && <CopyChip label="Host" value={dev.hostname} mono={false} />}
          <MetaChip label="First seen">{ts(dev.first_seen)}</MetaChip>
          {data.open > 0 && (
            <a
              href={href.liveFor(`device:${dev.key}`)}
              className="flex h-7 items-center justify-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-medium text-canvas max-md:h-9 max-md:px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition-opacity hover:opacity-90"
            >
              <Activity size={12} aria-hidden /> Watch live
            </a>
          )}
        </div>
      </div>

      <StatStrip
        items={[
          {
            label: "Downloaded",
            swatch: "down",
            num: data.totals.down,
            format: bytes,
            hint: `last ${rangeLabel(range)}`,
            spark: (data.series ?? []).map((p) => p.down),
          },
          {
            label: "Uploaded",
            swatch: "up",
            num: data.totals.up,
            format: bytes,
            hint: `last ${rangeLabel(range)}`,
            spark: (data.series ?? []).map((p) => p.up),
          },
          { label: "Flows", num: data.totals.conns, format: whole, hint: "started in range" },
          { label: "Domains / IPs", num: data.totals.targets, format: whole, hint: "distinct destinations" },
        ]}
      />

      <TrafficCard series={data.series} bucket={data.bucket} meta={`last ${rangeLabel(range)}`} />

      <div className="grid grid-cols-12 gap-3">
        <Card title="Top domains" meta={`${top.length}`} flush className="col-span-12 xl:col-span-7">
          <DataTable
            columns={topCols}
            rows={top}
            rowKey={(t) => t.target}
            rowHref={(t) => href.domain(t.target)}
            maxHeight={ips.length ? "428px" : "362px"}
            defaultSort={{ key: "total", dir: -1 }}
            compact={(t) => (
              <CompactStat lead={<TargetLink target={t.target} />} sub={`${count(t.conns)} flows`} down={t.down} up={t.up} max={max} />
            )}
          />
        </Card>
        <div className="col-span-12 flex flex-col gap-3 xl:col-span-5">
          <Card
            title="New destinations"
            meta="first contacted in this range"
            flush
            className="flex-1"
            bodyClassName={cn("relative", ips.length ? "xl:min-h-[197px]" : "xl:min-h-[362px]")}
          >
            <DataTable
              columns={newCols}
              rows={data.new_targets ?? []}
              rowKey={(t) => t.target}
              rowHref={(t) => href.domain(t.target)}
              className={cn("xl:absolute xl:inset-0", ips.length ? "max-xl:max-h-[197px]" : "max-xl:max-h-[362px]")}
              empty="No new destinations in this range."
              compactSort={false}
              compactCap
              compact={(t) => (
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">
                    <TargetLink target={t.target} />
                  </span>
                  <span className="shrink-0 text-[11.5px] text-ink-3" title={fullTime(t.first_seen ?? 0)}>
                    {ago(t.first_seen)}
                  </span>
                </div>
              )}
            />
          </Card>
          {ips.length > 0 && (
            <Card title="Addresses seen" meta={`${ips.length}`} flush>
              <DataTable columns={ipCols} rows={ips} rowKey={(i) => i.ip} maxHeight="164px" />
            </Card>
          )}
        </div>
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
