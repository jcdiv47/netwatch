import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilterInput, Segmented } from "@/components/data/Bits";
import { Card, ErrorNote } from "@/components/data/Card";
import { ViewSkeleton } from "@/components/data/Motion";
import { useFlowDetail } from "@/components/data/FlowDetail";
import { DataTable } from "@/components/data/DataTable";
import { collapseRuns, flowColumns, flowCompact } from "@/components/data/FlowsTable";
import { q, type FlowsResp } from "@/lib/api";
import { SEARCH_HELP, SEARCH_KEYS } from "@/lib/flowSearch";
import { bytes, count } from "@/lib/format";
import { rangeLabel, rangeStore } from "@/lib/store";
import { useApi } from "@/lib/useApi";

type State = "all" | "open" | "closed";
type Sort = "date" | "bytes";

const STATE_OPTIONS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
] as const;
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
  const [keysOpen, setKeysOpen] = useState(false);
  const keysTimer = useRef<number | undefined>(undefined);
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
  const compact = useMemo(() => flowCompact({ now }), [now]);
  const detail = useFlowDetail(rows, now);
  // newest-first lists fold a run of look-alike connections into one row
  const listed = useMemo(() => (sort === "date" ? collapseRuns(rows) : rows), [rows, sort]);

  if (!data) return error ? <ErrorNote error={error} /> : <ViewSkeleton kind="table" />;

  const down = rows.reduce((a, f) => a + f.down, 0);
  const up = rows.reduce((a, f) => a + f.up, 0);
  const shown = data.more
    ? `${sort === "bytes" ? "largest" : "newest"} ${count(data.limit)}`
    : `${count(rows.length)}`;

  return (
    <div className="view flex flex-col gap-3">
      {error && <ErrorNote error={error} />}
      <Card
        flush
        wrapActions
        title="Connections"
        meta={
          <span title={data.more ? "More connections match than are listed: narrow the search to see the rest." : undefined}>
            {shown} · last {rangeLabel(range)} · ↓ {bytes(down)} ↑ {bytes(up)} in these rows
          </span>
        }
        actions={
          <>
            <Segmented
              options={STATE_OPTIONS}
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
            />
            <FilterInput
              value={query}
              onChange={setQuery}
              placeholder="Search · device: outbound: port: …"
              title={SEARCH_HELP}
              className="w-80"
              onFocusChange={(f) => {
                window.clearTimeout(keysTimer.current);
                if (f) setKeysOpen(true);
                else keysTimer.current = window.setTimeout(() => setKeysOpen(false), 180);
              }}
            />
          </>
        }
      >
        <AnimatePresence initial={false}>
          {keysOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="overflow-hidden border-b border-line-soft"
            >
              <div className="no-scrollbar flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3.5 py-2 max-md:flex-nowrap max-md:overflow-x-auto">
                <span className="eyebrow mr-1.5 shrink-0" title={SEARCH_HELP}>
                  Match one field
                </span>
                {SEARCH_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    title={`Add ${k} to the search`}
                    // keep the field focused, so the strip stays and typing continues
                    onPointerDown={(e) => e.preventDefault()}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setQuery((v) => (v && !v.endsWith(" ") ? `${v} ${k}` : `${v}${k}`))}
                    className="h-5.5 shrink-0 rounded-[5px] bg-field px-1.5 font-mono text-[10.5px] tracking-[-0.02em] text-ink-2 shadow-hairline transition-colors duration-100 hover:bg-hover-2 hover:text-ink active:scale-[0.97] max-md:h-7 max-md:px-2"
                  >
                    {k}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <DataTable
          columns={columns}
          rows={listed}
          rowKey={(f) => f.id}
          className={loading ? "opacity-60" : undefined}
          empty={applied || state !== "all" ? "No connection matches." : "No connections recorded in this range."}
          onRowClick={detail.select}
          selectedKey={detail.selectedKey}
          compact={compact}
          compactSort={false}
        />
      </Card>
      {detail.panel}
    </div>
  );
}
