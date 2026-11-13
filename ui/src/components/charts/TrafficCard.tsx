import { ChartColumn, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { TrafficChart, TrafficTable } from "@/components/charts/TrafficChart";
import { Segmented } from "@/components/data/Bits";
import { Card } from "@/components/data/Card";
import type { Point } from "@/lib/api";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "chart", label: <ChartColumn size={13} aria-label="Chart" />, title: "Chart" },
  { id: "table", label: <Table2 size={13} aria-label="Table" />, title: "Table" },
] as const;

export function TrafficCard({
  series,
  bucket,
  meta,
  title = "Traffic over time",
  className,
  height = "h-56",
}: {
  series: Point[] | null;
  bucket: number;
  meta?: ReactNode;
  title?: string;
  className?: string;
  height?: string;
}) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  return (
    <Card
      title={title}
      meta={meta}
      className={className}
      flush={mode === "table"}
      actions={<Segmented options={MODES} value={mode} onChange={setMode} label="View as" />}
    >
      <div className={cn(height, "min-h-0")}>
        {mode === "chart" ? (
          <TrafficChart series={series} bucket={bucket} />
        ) : (
          <TrafficTable series={series} bucket={bucket} />
        )}
      </div>
    </Card>
  );
}
