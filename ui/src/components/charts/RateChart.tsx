import { Empty } from "@/components/data/Card";
import { trafficConfig } from "@/components/charts/TrafficChart";
import { rate } from "@/lib/format";
import type { Sample } from "@/lib/store";
import { EvilAreaChart } from "@/registry/charts/recharts-area-chart";

const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Live throughput sampled by the app while it is open (see lib/store pulse). */
export function RateChart({ history }: { history: Sample[] }) {
  if (history.length < 2) return <Empty>Collecting samples…</Empty>;
  return (
    <EvilAreaChart
      data={history}
      config={trafficConfig}
      curveType="monotone"
      animationType="none"
      className="aspect-auto h-full w-full"
      chartProps={{ margin: { top: 4, right: 4, bottom: 0, left: 0 } }}
    >
      <EvilAreaChart.Grid />
      <EvilAreaChart.XAxis dataKey="t" tickFormatter={clock} minTickGap={48} />
      <EvilAreaChart.YAxis tickFormatter={(v: number) => rate(v)} tickCount={4} />
      <EvilAreaChart.Legend variant="rounded-square" />
      <EvilAreaChart.Tooltip valueFormatter={rate} labelFormatter={(row) => clock((row as Sample).t)} />
      <EvilAreaChart.Area dataKey="down" variant="gradient" strokeVariant="solid" strokeWidth={1.5} />
      <EvilAreaChart.Area dataKey="up" variant="gradient" strokeVariant="solid" strokeWidth={1.5} />
    </EvilAreaChart>
  );
}
