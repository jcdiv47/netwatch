import { useMemo, useState } from "react";
import { Fig } from "@/components/data/Bits";
import { Empty } from "@/components/data/Card";
import type { RouteStat } from "@/lib/api";
import { bytes, count, pct } from "@/lib/format";
import { go, href } from "@/lib/router";
import { cn } from "@/lib/utils";

// Shades of the ink, darkest first. Routes are told apart by shade and by the
// solid/hatched texture, never by hue: hue is taken by download/upload and by
// the devices in the Sankey beside this card.
const SHADES = [82, 56, 36, 22];
const MAX_ROUTES = 5;

type Part = { key: string; label: string; value: number; conns: number; shade: number; to: string | null; bypass: boolean };

/** The connection search that lists a route's flows, where there is one. */
const routeQuery = (r: string): string | null =>
  r === "?" || /\s/.test(r) ? null : href.connections(r.startsWith("ct:") ? `inbound:${r}` : `outbound:${r}`);

const ink = (shade: number) => `color-mix(in oklch, var(--ink) ${shade}%, var(--surface))`;

function Swatch({ part, className }: { part: Part; className?: string }) {
  return <span aria-hidden className={cn(part.bypass ? "hatch" : "solid", className)} style={{ color: ink(part.shade) }} />;
}

/**
 * How traffic left the router, by bytes: one bar in two runs over a list split
 * the same way, each with its subtotal. Solid shades went through a sing-box
 * outbound; hatched shades bypassed sing-box and were seen by conntrack only.
 * A route keeps its shade while the set of routes is unchanged (shades follow
 * the name, not the rank).
 */
export function RouteSplit({ routes }: { routes: RouteStat[] | null; dark?: boolean }) {
  const parts = useMemo(() => {
    const all = (routes ?? []).filter((r) => r.up + r.down > 0);
    const head = all.slice(0, all.length > MAX_ROUTES ? MAX_ROUTES - 1 : MAX_ROUTES);
    const tail = all.slice(head.length);
    const shadeOf = (bypass: boolean, route: string) => {
      const names = head.filter((r) => r.route.startsWith("ct:") === bypass).map((r) => r.route).sort();
      return SHADES[Math.min(SHADES.length - 1, names.indexOf(route))];
    };
    const out = head.map<Part>((r) => {
      const bypass = r.route.startsWith("ct:");
      return {
        key: r.route,
        label: r.route === "?" ? "Unrouted" : r.route.replace(/^ct:/, ""),
        value: r.up + r.down,
        conns: r.conns,
        shade: shadeOf(bypass, r.route),
        to: routeQuery(r.route),
        bypass,
      };
    });
    if (tail.length) {
      out.push({
        key: "…other",
        label: `${tail.length} smaller route${tail.length === 1 ? "" : "s"}`,
        value: tail.reduce((a, r) => a + r.up + r.down, 0),
        conns: tail.reduce((a, r) => a + r.conns, 0),
        shade: 14,
        to: null,
        bypass: false,
      });
    }
    return out;
  }, [routes]);

  const [hover, setHover] = useState<string | null>(null);
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total === 0) return <Empty>No flows started in this range.</Empty>;

  const groups = [
    { title: "Via sing-box", hint: "left through a sing-box outbound", rows: parts.filter((p) => !p.bypass) },
    { title: "Bypassed sing-box", hint: "seen by router conntrack only, by class", rows: parts.filter((p) => p.bypass) },
  ]
    .filter((g) => g.rows.length)
    .map((g) => ({ ...g, sum: g.rows.reduce((a, p) => a + p.value, 0) }));

  return (
    <div className="flex flex-col gap-2.5 pt-1" onMouseLeave={() => setHover(null)}>
      <div className="grow-x flex h-2.5 gap-1" role="img" aria-label="Share of bytes by route">
        {groups.map((g) => (
          <div key={g.title} className="flex h-full min-w-2 gap-px overflow-hidden rounded-full" style={{ width: `${(100 * g.sum) / total}%` }}>
            {g.rows.map((p) => (
              <span
                key={p.key}
                title={`${p.label}: ${bytes(p.value)}`}
                onMouseEnter={() => setHover(p.key)}
                className={cn(
                  p.bypass ? "hatch" : "solid",
                  "h-full min-w-0.5 transition-[opacity,width] duration-300 ease-out-strong",
                  hover && hover !== p.key && "opacity-30",
                )}
                style={{ width: `${(100 * p.value) / g.sum}%`, color: ink(p.shade) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="flex h-6 items-center gap-2" title={g.hint}>
              <span className="eyebrow min-w-0 flex-1 truncate">{g.title}</span>
              <Fig className="w-[4.6rem] text-right text-[11.5px] text-ink-2">{bytes(g.sum)}</Fig>
              <span className="num w-10 text-right text-[11.5px] text-ink-2">{pct(g.sum, total)}</span>
            </div>
            <ul>
              {g.rows.map((p) => (
                <li
                  key={p.key}
                  onMouseEnter={() => setHover(p.key)}
                  onClick={p.to ? () => go(p.to!) : undefined}
                  title={p.to ? "Show these connections" : undefined}
                  className={cn(
                    "group/route -mx-1.5 flex h-7 items-center gap-2 rounded-[6px] px-1.5 transition-[background-color,opacity] duration-150",
                    p.to && "cursor-pointer",
                    hover === p.key && "bg-hover",
                    hover && hover !== p.key && "opacity-55",
                  )}
                >
                  <Swatch part={p} className="size-2.5 shrink-0 rounded-[3px]" />
                  {p.to ? (
                    <a href={p.to} className="min-w-0 truncate text-ink" onClick={(e) => e.stopPropagation()}>
                      {p.label}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate text-ink">{p.label}</span>
                  )}
                  <span aria-hidden className={cn("text-ink-3 opacity-0 transition-opacity", p.to && "group-hover/route:opacity-100")}>
                    →
                  </span>
                  <span className="ml-auto shrink-0 text-[11.5px] text-ink-3 max-sm:hidden">{count(p.conns)} flows</span>
                  <Fig className="w-[4.6rem] shrink-0 text-right text-[12px] text-ink max-sm:ml-auto">{bytes(p.value)}</Fig>
                  <span className="num w-10 shrink-0 text-right text-[12px] text-ink-2">{pct(p.value, total)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
