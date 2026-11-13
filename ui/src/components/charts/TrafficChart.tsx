import { useMemo } from "react";
import { Empty } from "@/components/data/Card";
import type { Point } from "@/lib/api";
import { axisLabel, bucketLabel, bytes } from "@/lib/format";
import { EvilBarChart } from "@/registry/charts/recharts-bar-chart";
import type { ChartConfig } from "@/registry/ui/recharts-chart";

// Download + upload are two parts of one total per bucket, so they stack on a
// single axis. Colors are the validated blue/orange pair from index.css.
export const trafficConfig = {
  down: { label: "Download", colors: { light: ["#2a78d6"], dark: ["#3987e5"] } },
  up: { label: "Upload", colors: { light: ["#eb6834"], dark: ["#d95926"] } },
} satisfies ChartConfig;

type Row = { t: number; down: number; up: number };

/** Fills empty sub-day buckets so quiet hours read as gaps, not as a jump. */
export function fillSeries(series: Point[] | null, bucket: number): Row[] {
  if (!series || series.length === 0) return [];
  const first = series[0].t;
  const last = series[series.length - 1].t;
  // Day and week buckets shift with DST, so only the observed ones are used.
  if (bucket % 86400 === 0 || (last - first) / bucket > 2000) return series;
  const byT = new Map(series.map((p) => [p.t, p]));
  const rows: Row[] = [];
  for (let t = first; t <= last; t += bucket) rows.push(byT.get(t) ?? { t, down: 0, up: 0 });
  return rows;
}

export function TrafficChart({ series, bucket }: { series: Point[] | null; bucket: number }) {
  const rows = useMemo(() => fillSeries(series, bucket), [series, bucket]);
  if (rows.length === 0) return <Empty>No traffic in this range.</Empty>;
  return (
    <EvilBarChart
      data={rows}
      config={trafficConfig}
      stackType="stacked"
      barRadius={3}
      className="aspect-auto h-full w-full"
      chartProps={{ margin: { top: 4, right: 4, bottom: 0, left: 0 }, maxBarSize: 44 }}
    >
      <EvilBarChart.Grid />
      <EvilBarChart.XAxis dataKey="t" tickFormatter={(t: number) => axisLabel(t, bucket)} minTickGap={24} />
      <EvilBarChart.YAxis tickFormatter={(v: number) => bytes(v)} tickCount={4} />
      <EvilBarChart.Legend isClickable variant="rounded-square" />
      <EvilBarChart.Tooltip
        valueFormatter={bytes}
        labelFormatter={(row) => bucketLabel((row as Row).t, bucket)}
      />
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
      <table className="tnum w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr className="text-[11.5px] text-ink-2">
            <th className="sticky top-0 h-7 border-b border-line bg-inset px-3 text-left font-medium">Time</th>
            <th className="sticky top-0 h-7 border-b border-line bg-inset px-3 text-right font-medium">Down</th>
            <th className="sticky top-0 h-7 border-b border-line bg-inset px-3 text-right font-medium">Up</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .slice()
            .reverse()
            .map((p) => (
              <tr key={p.t} className="hover:bg-hover">
                <td className="h-7 border-b border-line-soft px-3">{bucketLabel(p.t, bucket)}</td>
                <td className="h-7 border-b border-line-soft px-3 text-right">{bytes(p.down)}</td>
                <td className="h-7 border-b border-line-soft px-3 text-right">{bytes(p.up)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
