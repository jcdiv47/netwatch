import { useEffect, useMemo, useState } from "react";
import { SplitBar } from "@/components/data/Bars";
import { Fig, FilterInput, TargetLink } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { CompactStat } from "@/components/data/Compact";
import { DataTable, type Column } from "@/components/data/DataTable";
import { ViewSkeleton } from "@/components/data/Motion";
import { StatStrip } from "@/components/data/Stat";
import { q, type DomainsResp, type TargetStat } from "@/lib/api";
import { bytes, count, pct } from "@/lib/format";
import { href } from "@/lib/router";
import { rangeLabel, rangeStore } from "@/lib/store";
import { useApi } from "@/lib/useApi";

const LIMIT = 500;

export function Domains() {
  const range = rangeStore.use();
  const [query, setQuery] = useState(() => sessionStorage.getItem("nw.q") ?? "");
  const [applied, setApplied] = useState(query);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setApplied(query.trim());
      sessionStorage.setItem("nw.q", query.trim());
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const { data, error, loading } = useApi<DomainsResp>(`api/domains?${q({ range, limit: LIMIT, q: applied })}`, 30000);
  const rows = data?.domains ?? [];
  const max = Math.max(0, ...rows.map((t) => t.up + t.down));
  const columns = useMemo<Column<TargetStat>[]>(
    () => [
      { key: "target", title: "Domain / IP", sort: (t) => t.target, render: (t) => <TargetLink target={t.target} />, className: "max-w-[26rem] truncate" },
      { key: "total", title: "Share", sort: (t) => t.up + t.down, render: (t) => <SplitBar down={t.down} up={t.up} max={max} />, className: "w-[26%] min-w-28" },
      { key: "down", title: "Down", num: true, sort: (t) => t.down, render: (t) => <Fig>{bytes(t.down)}</Fig> },
      { key: "up", title: "Up", num: true, sort: (t) => t.up, render: (t) => <Fig>{bytes(t.up)}</Fig> },
      { key: "devices", title: "Devices", num: true, sort: (t) => t.devices ?? 0, render: (t) => count(t.devices) },
      { key: "conns", title: "Flows", num: true, sort: (t) => t.conns, render: (t) => count(t.conns) },
    ],
    [max],
  );

  if (!data) return error ? <ErrorNote error={error} /> : <ViewSkeleton kind="list" />;
  const tot = rows.reduce((a, t) => ({ up: a.up + t.up, down: a.down + t.down }), { up: 0, down: 0 });
  const top = rows.reduce<TargetStat | null>((m, t) => (!m || t.up + t.down > m.up + m.down ? t : m), null);
  const scope = applied ? "matching the filter" : rows.length === LIMIT ? `top ${LIMIT} by traffic` : `last ${rangeLabel(range)}`;
  return (
    <div className="view flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <StatStrip
        items={[
          { label: "Destinations", num: rows.length, format: (n) => count(Math.round(n)), hint: scope },
          { label: "Downloaded", swatch: "down", num: tot.down, format: bytes, hint: "from the listed destinations" },
          { label: "Uploaded", swatch: "up", num: tot.up, format: bytes, hint: "to the listed destinations" },
          {
            label: "Busiest",
            value: top ? pct(top.up + top.down, tot.up + tot.down) : "–",
            hint: top ? top.target : "no traffic",
          },
        ]}
      />
      <Card
        flush
        wrapActions
        title="Destinations"
        meta={`${rows.length === LIMIT ? `top ${LIMIT}` : rows.length} by traffic · last ${rangeLabel(range)}`}
        actions={
          <>
            <span className="mr-2.5 text-[11.5px] text-ink-3 max-lg:hidden">Flows without a sniffed domain are listed by IP</span>
            <FilterInput value={query} onChange={setQuery} placeholder="Filter domains and IPs" className="w-64" />
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.target}
          rowHref={(t) => href.domain(t.target)}
          className={loading ? "opacity-60" : undefined}
          compact={(t) => (
            <CompactStat
              lead={<TargetLink target={t.target} />}
              sub={`${count(t.devices)} device${t.devices === 1 ? "" : "s"} · ${count(t.conns)} flows`}
              down={t.down}
              up={t.up}
              max={max}
            />
          )}
          defaultSort={{ key: "total", dir: -1 }}
          empty={applied ? "No destination matches the filter." : "Nothing in this range."}
        />
      </Card>
    </div>
  );
}
