import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { RateChart } from "@/components/charts/RateChart";
import { SplitBar } from "@/components/data/Bars";
import { Chips, DeviceLink, Fig, FilterInput, Toggle, type Chip } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { CompactStat } from "@/components/data/Compact";
import { DataTable, type Column } from "@/components/data/DataTable";
import { useFlowDetail } from "@/components/data/FlowDetail";
import { flowColumns, flowCompact } from "@/components/data/FlowsTable";
import { ViewSkeleton } from "@/components/data/Motion";
import { StatStrip } from "@/components/data/Stat";
import type { Flow, LiveResp } from "@/lib/api";
import { flowMatcher, SEARCH_HELP } from "@/lib/flowSearch";
import { count, rate } from "@/lib/format";
import { href } from "@/lib/router";
import { feedPulse, usePulse } from "@/lib/store";
import { useApi } from "@/lib/useApi";

type Source = "all" | "singbox" | "conntrack";
type Talker = { key: string; name: string; flows: number; down: number; up: number };

const sum = (fs: Flow[], k: "rate_down" | "rate_up") => fs.reduce((a, f) => a + (f[k] ?? 0), 0);
const whole = (n: number) => count(Math.round(n));

export function Live({ initialQuery = "" }: { initialQuery?: string }) {
  const [paused, setPaused] = useState(false);
  const { data, error } = useApi<LiveResp>("api/live", paused ? 0 : 3000);
  const { history } = usePulse();
  const [query, setQuery] = useState(() => initialQuery || (sessionStorage.getItem("nw.lf") ?? ""));
  const [source, setSource] = useState<Source>("all");
  const [activeOnly, setActiveOnly] = useState(() => sessionStorage.getItem("nw.la") === "1");

  const flows = data?.flows ?? [];
  const now = data?.now ?? Date.now();

  // One sample for the whole app: these are the figures the top bar and the
  // sidebar show while this view is open.
  useEffect(() => {
    if (data && !paused) feedPulse(data.now, sum(data.flows ?? [], "rate_down"), sum(data.flows ?? [], "rate_up"), (data.flows ?? []).length);
  }, [data, paused]);

  const rows = useMemo(() => {
    const match = flowMatcher(query);
    return flows.filter(
      (f) => (source === "all" || f.source === source) && (!activeOnly || (f.rate_down ?? 0) + (f.rate_up ?? 0) > 0) && match(f),
    );
  }, [flows, query, source, activeOnly]);

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

  const opts = useMemo(() => ({ live: true, now }), [now]);
  const columns = useMemo(() => flowColumns(opts), [opts]);
  const compact = useMemo(() => flowCompact(opts), [opts]);
  const talkerCols = useMemo<Column<Talker>[]>(
    () => [
      { key: "name", title: "Device", render: (t) => <DeviceLink k={t.key} name={t.name} glyph />, className: "max-w-44 truncate" },
      { key: "bar", title: "", render: (t) => <SplitBar down={t.down} up={t.up} max={talkMax} />, className: "w-[22%]" },
      { key: "down", title: "↓ rate", num: true, render: (t) => <Fig>{rate(t.down)}</Fig> },
      { key: "up", title: "↑ rate", num: true, render: (t) => <Fig>{rate(t.up)}</Fig> },
      { key: "flows", title: "Open", num: true, render: (t) => count(t.flows) },
    ],
    [talkMax],
  );

  const detail = useFlowDetail(flows, now, true);

  if (!data) return error ? <ErrorNote error={error} /> : <ViewSkeleton kind="dashboard" />;

  const chips: Chip<Source>[] = [
    { key: "all", label: "All", count: flows.length },
    { key: "singbox", label: "sing-box", count: flows.filter((f) => f.source === "singbox").length },
    { key: "conntrack", label: "conntrack", count: flows.filter((f) => f.source === "conntrack").length },
  ];
  const filtered = rows.length !== flows.length;

  return (
    <div className="view flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <StatStrip
        items={[
          { label: "Open connections", live: !paused, num: flows.length, format: whole, hint: paused ? "paused" : "refreshed every 3 s" },
          {
            label: "Download rate",
            swatch: "down",
            num: sum(flows, "rate_down"),
            format: rate,
            hint: `peak ${rate(Math.max(0, ...history.map((s) => s.down)))}`,
            spark: history.map((s) => s.down),
          },
          {
            label: "Upload rate",
            swatch: "up",
            num: sum(flows, "rate_up"),
            format: rate,
            hint: `peak ${rate(Math.max(0, ...history.map((s) => s.up)))}`,
            spark: history.map((s) => s.up),
          },
          { label: "Devices online", num: talkers.length, format: whole, hint: "with an open connection" },
        ]}
      />
      <div className="grid grid-cols-12 gap-3">
        <Card title="Throughput" meta="all open connections · last 6 minutes" className="col-span-12 xl:col-span-7">
          <div className="h-56">
            <RateChart history={history} />
          </div>
        </Card>
        <Card title="Talkers" meta="by current rate" flush className="col-span-12 xl:col-span-5">
          <DataTable
            columns={talkerCols}
            rows={talkers}
            rowKey={(t) => t.key}
            rowHref={(t) => href.device(t.key)}
            maxHeight="263px"
            empty="No open connections."
            compact={(t) => (
              <CompactStat
                lead={<DeviceLink k={t.key} name={t.name} glyph />}
                sub={`${count(t.flows)} open`}
                down={t.down}
                up={t.up}
                max={talkMax}
                format={rate}
              />
            )}
          />
        </Card>
      </div>
      <Card
        flush
        wrapActions
        title="Open connections"
        meta={
          filtered
            ? `${rows.length} of ${flows.length} · ↓ ${rate(sum(rows, "rate_down"))} · ↑ ${rate(sum(rows, "rate_up"))}`
            : `${flows.length}`
        }
        actions={
          <>
            <div className="no-scrollbar max-md:-mx-1 max-md:w-[calc(100%+0.5rem)] max-md:overflow-x-auto max-md:px-1 max-md:py-0.5">
            <Chips chips={chips} value={source} onChange={setSource} label="Flow source" />
            </div>
            <span className="max-sm:hidden">
            <Toggle
              checked={activeOnly}
              onChange={(v) => {
                setActiveOnly(v);
                sessionStorage.setItem("nw.la", v ? "1" : "0");
              }}
              label="Moving data"
            />
            </span>
            <FilterInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                sessionStorage.setItem("nw.lf", v);
              }}
              placeholder="Filter · device: outbound: network: …"
              title={SEARCH_HELP}
              className="w-64"
            />
            <Button variant="secondary" size="xs" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
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
          onRowClick={detail.select}
          selectedKey={detail.selectedKey}
          compact={compact}
          compactExtra={
            <Toggle
              checked={activeOnly}
              onChange={(v) => {
                setActiveOnly(v);
                sessionStorage.setItem("nw.la", v ? "1" : "0");
              }}
              label="Moving data"
            />
          }
          empty={flows.length ? "No connection matches the filter." : "No open connections."}
        />
      </Card>
      {detail.panel}
    </div>
  );
}
