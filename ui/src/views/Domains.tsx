import { useEffect, useMemo, useState } from "react";
import { SplitBar } from "@/components/data/Bars";
import { FilterInput, TargetLink } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { DataTable, type Column } from "@/components/data/DataTable";
import { q, type DomainsResp, type TargetStat } from "@/lib/api";
import { bytes, count } from "@/lib/format";
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

  const { data, error } = useApi<DomainsResp>(`api/domains?${q({ range, limit: LIMIT, q: applied })}`, 30000);
  const rows = data?.domains ?? [];
  const max = Math.max(0, ...rows.map((t) => t.up + t.down));
  const columns = useMemo<Column<TargetStat>[]>(
    () => [
      { key: "target", title: "Domain / IP", sort: (t) => t.target, render: (t) => <TargetLink target={t.target} />, className: "max-w-[32rem] truncate" },
      { key: "devices", title: "Devices", num: true, sort: (t) => t.devices ?? 0, render: (t) => count(t.devices) },
      { key: "down", title: "Down", num: true, sort: (t) => t.down, render: (t) => bytes(t.down) },
      { key: "up", title: "Up", num: true, sort: (t) => t.up, render: (t) => bytes(t.up) },
      { key: "total", title: "Share", sort: (t) => t.up + t.down, render: (t) => <SplitBar down={t.down} up={t.up} max={max} />, className: "w-[22%] min-w-28" },
      { key: "conns", title: "Flows", num: true, sort: (t) => t.conns, render: (t) => count(t.conns) },
    ],
    [max],
  );

  if (!data) return error ? <ErrorNote error={error} /> : null;
  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <Card
        flush
        title="Destinations"
        meta={`${rows.length === LIMIT ? `top ${LIMIT}` : rows.length} by traffic · last ${rangeLabel(range)} · flows without a sniffed domain are listed by IP`}
        actions={<FilterInput value={query} onChange={setQuery} placeholder="Filter (substring)" />}
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.target}
          defaultSort={{ key: "total", dir: -1 }}
          empty={applied ? "No destination matches the filter." : "Nothing in this range."}
        />
      </Card>
    </div>
  );
}
