import { Pause, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { RateChart } from "@/components/charts/RateChart";
import { SplitBar } from "@/components/data/Bars";
import { Chips, DeviceLink, FilterInput, type Chip } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { DataTable, type Column } from "@/components/data/DataTable";
import { flowColumns } from "@/components/data/FlowsTable";
import { StatStrip } from "@/components/data/Stat";
import type { Flow, LiveResp } from "@/lib/api";
import { count, rate } from "@/lib/format";
import { usePulse } from "@/lib/store";
import { useApi } from "@/lib/useApi";

type Source = "all" | "singbox" | "conntrack";
type Talker = { key: string; name: string; flows: number; down: number; up: number };

export function Live() {
  const [paused, setPaused] = useState(false);
  const { data, error } = useApi<LiveResp>("api/live", paused ? 0 : 3000);
  const { history } = usePulse();
  const [query, setQuery] = useState(() => sessionStorage.getItem("nw.lf") ?? "");
  const [source, setSource] = useState<Source>("all");

  const flows = data?.flows ?? [];
  const rows = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return flows.filter(
      (f) =>
        (source === "all" || f.source === source) &&
        words.every((w) =>
          [f.device_name, f.target, f.dst_ip, f.src_ip, f.device_key].some((s) => s?.toLowerCase().includes(w)),
        ),
    );
  }, [flows, query, source]);

  const talkers = useMemo(() => {
    const by = new Map<string, Talker>();
    for (const f of flows) {
      let t = by.get(f.device_key);
      if (!t) by.set(f.device_key, (t = { key: f.device_key, name: f.device_name, flows: 0, down: 0, up: 0 }));
      t.flows++;
      t.down += f.rate_down ?? 0;
      t.up += f.rate_up ?? 0;
    }
    return [...by.values()].sort((a, b) => b.down + b.up - (a.down + a.up) || b.flows - a.flows);
  }, [flows]);
  const talkMax = Math.max(0, ...talkers.map((t) => t.down + t.up));

  const columns = useMemo(() => flowColumns({ live: true, now: data?.now ?? Date.now() }), [data?.now]);
  const talkerCols = useMemo<Column<Talker>[]>(
    () => [
      { key: "name", title: "Device", render: (t) => <DeviceLink k={t.key} name={t.name} />, className: "max-w-40 truncate" },
      { key: "bar", title: "", render: (t) => <SplitBar down={t.down} up={t.up} max={talkMax} />, className: "w-[22%]" },
      { key: "down", title: "↓", num: true, render: (t) => (t.down ? rate(t.down) : <span className="text-ink-3">–</span>) },
      { key: "up", title: "↑", num: true, render: (t) => (t.up ? rate(t.up) : <span className="text-ink-3">–</span>) },
      { key: "flows", title: "Open", num: true, render: (t) => count(t.flows) },
    ],
    [talkMax],
  );

  if (!data) return error ? <ErrorNote error={error} /> : null;

  const sum = (fs: Flow[], k: "rate_down" | "rate_up") => fs.reduce((a, f) => a + (f[k] ?? 0), 0);
  const chips: Chip<Source>[] = [
    { key: "all", label: "All", count: flows.length },
    { key: "singbox", label: "sing-box", count: flows.filter((f) => f.source === "singbox").length },
    { key: "conntrack", label: "conntrack", count: flows.filter((f) => f.source === "conntrack").length },
  ];
  const filtered = rows.length !== flows.length;

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <StatStrip
        items={[
          { label: "Open connections", value: count(flows.length), hint: paused ? "paused" : "refreshed every 3 s" },
          { label: "Download rate", swatch: "down", value: rate(sum(flows, "rate_down")) },
          { label: "Upload rate", swatch: "up", value: rate(sum(flows, "rate_up")) },
          { label: "Devices online", value: count(talkers.length), hint: "with an open connection" },
        ]}
      />
      <div className="grid grid-cols-12 gap-3">
        <Card title="Throughput" meta="all open connections · sampled while this page is open" className="col-span-12 xl:col-span-7">
          <div className="h-52">
            <RateChart history={history} />
          </div>
        </Card>
        <Card title="Talkers" meta="by current rate" flush className="col-span-12 xl:col-span-5">
          <DataTable columns={talkerCols} rows={talkers} rowKey={(t) => t.key} maxHeight="14.5rem" empty="No open connections." />
        </Card>
      </div>
      <Card
        flush
        title="Open connections"
        meta={
          filtered
            ? `${rows.length} of ${flows.length} · ↓ ${rate(sum(rows, "rate_down"))} · ↑ ${rate(sum(rows, "rate_up"))}`
            : `${flows.length}`
        }
        actions={
          <>
            <Chips chips={chips} value={source} onChange={setSource} label="Flow source" />
            <FilterInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                sessionStorage.setItem("nw.lf", v);
              }}
              placeholder="Filter device, domain, IP"
              className="ml-2"
            />
            <Button variant="secondary" size="xs" className="ml-1" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
              {paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
              {paused ? "Resume" : "Pause"}
            </Button>
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(f) => f.id}
          defaultSort={{ key: "rate_down", dir: -1 }}
          empty={flows.length ? "No connection matches the filter." : "No open connections."}
        />
      </Card>
    </div>
  );
}
