import { useMemo } from "react";
import { ReferenceLine } from "recharts";
import { Empty } from "@/components/data/Card";
import type { Point } from "@/lib/api";
import { Fig } from "@/components/data/Bits";
import { axisLabel, bucketLabel, bytes, clockLabel, niceScale } from "@/lib/format";
import { useNarrow } from "@/lib/media";
import { rangeSeconds, rangeStore } from "@/lib/store";
import { EvilBarChart } from "@/registry/charts/recharts-bar-chart";
import type { ChartConfig } from "@/registry/ui/recharts-chart";

// Download + upload are two parts of one total per bucket, so they stack on a
// single axis. Colors are the validated blue/orange pair from index.css.
export const trafficConfig = {
  down: { label: "Download", colors: { light: ["#2a78d6"], dark: ["#3987e5"] } },
  up: { label: "Upload", colors: { light: ["#eb6834"], dark: ["#d95926"] } },
} satisfies ChartConfig;

type Row = { t: number; down: number; up: number };

/**
 * Lays the series over the whole selected range, with empty buckets where
 * nothing was recorded, so every chart of a range has the same time scale and
 * a quiet stretch reads as a gap. Without `rangeSecs` only the span between
 * the first and last observed bucket is filled.
 */
export function fillSeries(series: Point[] | null, bucket: number, rangeSecs?: number): Row[] {
  if (!series || series.length === 0) return [];
  let first = series[0].t;
  let last = series[series.length - 1].t;
  // Day and week buckets shift with DST, so only the observed ones are used.
  if (bucket % 86400 === 0) return series;
  if (rangeSecs) {
    // Buckets are aligned to local time by the server; step out from the
    // observed ones instead of guessing that alignment.
    const now = Date.now() / 1000;
    first -= Math.max(0, Math.floor((first - (now - rangeSecs)) / bucket)) * bucket;
    last += Math.max(0, Math.floor((now - last) / bucket)) * bucket;
  }
  if ((last - first) / bucket > 2000) return series;
  const byT = new Map(series.map((p) => [p.t, p]));
  const rows: Row[] = [];
  for (let t = first; t <= last; t += bucket) rows.push(byT.get(t) ?? { t, down: 0, up: 0 });
  return rows;
}

const dayLabel = (t: number) => new Date(t * 1000).toLocaleDateString([], { month: "short", day: "numeric" });

export function TrafficChart({ series, bucket }: { series: Point[] | null; bucket: number }) {
  const range = rangeStore.use();
  const narrow = useNarrow();
  const rows = useMemo(() => fillSeries(series, bucket, rangeSeconds(range)), [series, bucket, range]);
  // Where a new day starts (sub-day buckets only), so a time always has a date.
  const days = useMemo(
    () => (bucket < 86400 ? rows.filter((r, i) => i > 0 && new Date(r.t * 1000).getHours() === 0).map((r) => r.t) : []),
    [rows, bucket],
  );
  const scale = useMemo(() => niceScale(Math.max(0, ...rows.map((r) => r.down + r.up))), [rows]);
  if (rows.length === 0) return <Empty>No traffic in this range.</Empty>;
  const sparse = days.length <= (narrow ? 4 : 10);
  return (
    <EvilBarChart
      data={rows}
      config={trafficConfig}
      stackType="stacked"
      barRadius={3}
      className="aspect-auto h-full w-full"
      chartProps={{ margin: { top: 14, right: 4, bottom: 0, left: 0 }, maxBarSize: 44 }}
    >
      <EvilBarChart.Grid />
      <EvilBarChart.XAxis
        dataKey="t"
        tickFormatter={(t: number) => (bucket < 86400 ? clockLabel(t * 1000) : axisLabel(t, bucket))}
        minTickGap={narrow ? 20 : 32}
        interval="equidistantPreserveStart"
      />
      <EvilBarChart.YAxis ticks={scale.ticks} domain={[0, scale.ticks[scale.ticks.length - 1]]} tickFormatter={scale.format} />
      <EvilBarChart.Legend isClickable variant="rounded-square" />
      <EvilBarChart.Tooltip
        valueFormatter={bytes}
        labelFormatter={(row) => bucketLabel((row as Row).t, bucket)}
      />
      {sparse &&
        days.map((t) => (
          <ReferenceLine
            key={t}
            x={t}
            stroke="var(--line-strong)"
            strokeDasharray="2 3"
            label={{ value: dayLabel(t), position: "insideTopLeft", fontSize: 10, fill: "var(--ink-3)", dy: -14, dx: -2 }}
          />
        ))}
      <EvilBarChart.Bar dataKey="down" isClickable enableHoverHighlight />
      <EvilBarChart.Bar dataKey="up" isClickable enableHoverHighlight />
    </EvilBarChart>
  );
}

/** The same series as rows, for exact reading (and for screen readers). */
export function TrafficTable({ series, bucket }: { series: Point[] | null; bucket: number }) {
  const rows = (series ?? []).filter((p) => p.up || p.down);
  if (rows.length === 0) return <Empty>No traffic in this range.</Empty>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr className="text-[11px] tracking-[0.01em] text-ink-3">
            <th className="sticky top-0 h-8 border-b border-line bg-inset px-3.5 text-left font-medium">Time</th>
            <th className="sticky top-0 h-8 border-b border-line bg-inset px-3.5 text-right font-medium">Down</th>
            <th className="sticky top-0 h-8 border-b border-line bg-inset px-3.5 text-right font-medium">Up</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice()
            .reverse()
            .map((p) => (
              <tr key={p.t} className="transition-colors duration-75 hover:bg-hover">
                <td className="h-[30px] border-b border-line-soft px-3.5 tabular-nums">{bucketLabel(p.t, bucket)}</td>
                <td className="h-[30px] border-b border-line-soft px-3.5 text-right text-[12px]">
                  <Fig>{bytes(p.down)}</Fig>
                </td>
                <td className="h-[30px] border-b border-line-soft px-3.5 text-right text-[12px]">
                  <Fig>{bytes(p.up)}</Fig>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
