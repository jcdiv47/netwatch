import { useMemo } from "react";
import { Empty } from "@/components/data/Card";
import type { RouteStat } from "@/lib/api";
import { bytes, count, pct } from "@/lib/format";

// Same categorical order as the Sankey. A route keeps its color for as long as
// the set of routes is unchanged (slots follow the route name, not its rank).
const SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const SLOTS_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
const MAX_PARTS = 6;

const routeLabel = (r: string) =>
  r === "?" ? "Unrouted" : r.startsWith("ct:") ? `Bypass · ${r.slice(3)}` : r;

/**
 * How traffic left the router: one thin segmented bar over a list that names
 * each route and gives its amount, share and flow count.
 */
export function RouteSplit({ routes, dark }: { routes: RouteStat[] | null; dark: boolean }) {
  const parts = useMemo(() => {
    const all = (routes ?? []).filter((r) => r.up + r.down > 0);
    const head = all.slice(0, MAX_PARTS - (all.length > MAX_PARTS ? 1 : 0));
    const tail = all.slice(head.length);
    const names = head.map((r) => r.route).sort();
    const palette = dark ? SLOTS_DARK : SLOTS;
    const out = head.map((r) => ({
      key: r.route,
      label: routeLabel(r.route),
      value: r.up + r.down,
      conns: r.conns,
      color: palette[names.indexOf(r.route)],
    }));
    if (tail.length) {
      out.push({
        key: "…other",
        label: `Other (${tail.length})`,
        value: tail.reduce((a, r) => a + r.up + r.down, 0),
        conns: tail.reduce((a, r) => a + r.conns, 0),
        color: "var(--ink-3)",
      });
    }
    return out;
  }, [routes, dark]);

  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total === 0) return <Empty>No flows started in this range.</Empty>;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Traffic share by route">
        {parts.map((p) => (
          <span
            key={p.key}
            title={`${p.label}: ${bytes(p.value)}`}
            className="h-full min-w-1 first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(100 * p.value) / total}%`, background: p.color }}
          />
        ))}
      </div>
      <ul className="tnum flex flex-col text-[12.5px]">
        {parts.map((p) => (
          <li key={p.key} className="flex h-7 items-center gap-2 border-b border-line-soft last:border-b-0">
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate text-ink" title={p.key}>
              {p.label}
            </span>
            <span className="text-ink-3">{count(p.conns)} flows</span>
            <span className="w-16 text-right text-ink">{bytes(p.value)}</span>
            <span className="w-10 text-right text-ink-2">{pct(p.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
