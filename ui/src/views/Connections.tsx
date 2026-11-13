import { useEffect, useMemo, useState } from "react";
import { Chips, FilterInput, Segmented, type Chip } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { useFlowDetail } from "@/components/data/FlowDetail";
import { DataTable } from "@/components/data/DataTable";
import { flowColumns } from "@/components/data/FlowsTable";
import { q, type FlowsResp } from "@/lib/api";
import { SEARCH_HELP, SEARCH_KEYS } from "@/lib/flowSearch";
import { bytes, count } from "@/lib/format";
import { rangeLabel, rangeStore } from "@/lib/store";
import { useApi } from "@/lib/useApi";

type State = "all" | "open" | "closed";
type Sort = "date" | "bytes";

const STATES: Chip<State>[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
];
const SORTS = [
  { id: "date", label: "Newest", title: "Most recently started first" },
  { id: "bytes", label: "Largest", title: "Most bytes first" },
] as const;

const saved = <T extends string>(key: string, valid: readonly T[], fallback: T): T => {
  const v = sessionStorage.getItem(key) as T | null;
  return v && valid.includes(v) ? v : fallback;
};

/**
 * Every recorded connection in the range, open or closed, searched on the
 * server so a match is found however far back it is.
 */
export function Connections({ initialQuery }: { initialQuery: string }) {
  const range = rangeStore.use();
  const [state, setState] = useState<State>(() => saved("nw.cs", ["all", "open", "closed"], "all"));
  const [sort, setSort] = useState<Sort>(() => saved("nw.co", ["date", "bytes"], "date"));
  const [query, setQuery] = useState(() => initialQuery || (sessionStorage.getItem("nw.cq") ?? ""));
  const [applied, setApplied] = useState(query.trim());
  useEffect(() => {
    const id = window.setTimeout(() => {
      setApplied(query.trim());
      sessionStorage.setItem("nw.cq", query.trim());
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const { data, error, loading } = useApi<FlowsResp>(`api/flows?${q({ range, state, sort, q: applied })}`, 15000);
  const rows = data?.flows ?? [];
  const now = data?.now ?? Date.now();
  const columns = useMemo(() => flowColumns({ now }), [now]);
  const detail = useFlowDetail(rows, now);

  if (!data) return error ? <ErrorNote error={error} /> : null;

  const down = rows.reduce((a, f) => a + f.down, 0);
  const up = rows.reduce((a, f) => a + f.up, 0);
  const shown = data.more
    ? `${sort === "bytes" ? "largest" : "newest"} ${count(data.limit)} · narrow the search to see the rest`
    : `${count(rows.length)}`;

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <Card
        flush
        title="Connections"
        meta={`${shown} · last ${rangeLabel(range)} · ↓ ${bytes(down)} · ↑ ${bytes(up)}`}
        actions={
          <>
            <Chips
              chips={STATES}
              value={state}
              onChange={(s) => {
                setState(s);
                sessionStorage.setItem("nw.cs", s);
              }}
              label="Connection state"
            />
            <Segmented
              options={SORTS}
              value={sort}
              onChange={(s) => {
                setSort(s);
                sessionStorage.setItem("nw.co", s);
              }}
              label="Order"
              className="ml-1"
            />
            <FilterInput
              value={query}
              onChange={setQuery}
              placeholder="Search · device: outbound: network: …"
              title={SEARCH_HELP}
              className="ml-1 w-72 max-md:w-56"
            />
          </>
        }
      >
        <p className="border-b border-line-soft px-3 py-1.5 text-[11.5px] text-ink-3">
          Click a row for its details. Search words are combined; a plain word matches the device, domain, addresses or
          outbound, and these keys test one field:{" "}
          {SEARCH_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setQuery((v) => (v && !v.endsWith(" ") ? `${v} ${k}` : `${v}${k}`))}
              className="mr-1.5 rounded-[3px] font-mono text-[11px] text-ink-2 hover:text-accent-ink hover:underline"
            >
              {k}
            </button>
          ))}
        </p>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(f) => f.id}
          className={loading ? "opacity-60" : undefined}
          empty={applied || state !== "all" ? "No connection matches." : "No connections recorded in this range."}
          onRowClick={detail.select}
          selectedKey={detail.selectedKey}
        />
      </Card>
      {detail.panel}
    </div>
  );
}
