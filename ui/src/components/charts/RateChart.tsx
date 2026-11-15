import { trafficConfig } from "@/components/charts/TrafficChart";
import { Empty } from "@/components/data/Card";
import { clockLabel, niceScale, rate } from "@/lib/format";
import { useNarrow } from "@/lib/media";
import type { Sample } from "@/lib/store";
import { EvilAreaChart } from "@/registry/charts/recharts-area-chart";

const WINDOW_MS = 6 * 60 * 1000;
const MINUTE = 60 * 1000;

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Live throughput over a fixed six-minute window that fills from the right, so
 * the time scale never stretches. Samples are joined by straight lines: with
 * one reading every three seconds a smoothed curve would invent peaks.
 */
export function RateChart({ history }: { history: Sample[] }) {
  const narrow = useNarrow();
  if (history.length < 2) return <Empty>Collecting samples…</Empty>;
  const scale = niceScale(Math.max(1, ...history.map((s) => Math.max(s.down, s.up))), "/s");
  const end = history[history.length - 1].t;
  const start = end - WINDOW_MS;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / MINUTE) * MINUTE; t <= end; t += (narrow ? 2 : 1) * MINUTE) ticks.push(t);
  return (
    <EvilAreaChart
      data={history}
      config={trafficConfig}
      curveType="linear"
      animationType="none"
      className="aspect-auto h-full w-full"
      chartProps={{ margin: { top: 4, right: 4, bottom: 0, left: 0 } }}
    >
      <EvilAreaChart.Grid />
      <EvilAreaChart.XAxis
        dataKey="t"
        type="number"
        scale="time"
        domain={[start, end]}
        ticks={ticks}
        tickFormatter={clockLabel}
        allowDataOverflow
      />
      <EvilAreaChart.YAxis ticks={scale.ticks} domain={[0, scale.ticks[scale.ticks.length - 1]]} tickFormatter={scale.format} />
      <EvilAreaChart.Legend variant="rounded-square" />
      <EvilAreaChart.Tooltip valueFormatter={rate} labelFormatter={(row) => clock((row as Sample).t)} />
      <EvilAreaChart.Area dataKey="down" variant="gradient" strokeVariant="solid" strokeWidth={1.5} />
      <EvilAreaChart.Area dataKey="up" variant="gradient" strokeVariant="solid" strokeWidth={1.5} />
    </EvilAreaChart>
  );
}
