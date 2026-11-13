import { bytes } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Thin segmented bar for a table row: download + upload, scaled to the largest
 * row so rows compare on one baseline. The figures live in the columns beside
 * it, so the bar itself carries no text.
 */
export function SplitBar({
  down,
  up,
  max,
  className,
}: {
  down: number;
  up: number;
  max: number;
  className?: string;
}) {
  const total = down + up;
  const width = max > 0 ? Math.max(total > 0 ? 1.5 : 0, (100 * total) / max) : 0;
  const downShare = total > 0 ? (100 * down) / total : 0;
  return (
    <div
      className={cn("h-1.5 w-full min-w-16 rounded-full bg-hover-2", className)}
      title={`↓ ${bytes(down)} · ↑ ${bytes(up)}`}
    >
      <div className="flex h-full gap-px overflow-hidden rounded-full" style={{ width: `${width}%` }}>
        {down > 0 && <span className="h-full bg-down" style={{ width: `${downShare}%` }} />}
        {up > 0 && <span className="h-full flex-1 bg-up" />}
      </div>
    </div>
  );
}

/** Tiny trend line for a table row. One series, so no axis and no legend. */
export function Sparkline({
  values,
  width = 84,
  height = 20,
  className,
  stroke = "var(--ink-2)",
}: {
  values: number[] | undefined;
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
}) {
  if (!values || values.length === 0) return <span className={cn("inline-block", className)} style={{ width, height }} />;
  const max = Math.max(...values);
  if (max <= 0) return <span className={cn("inline-block", className)} style={{ width, height }} />;
  const pad = 1.5;
  const n = values.length;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
  const y = (v: number) => height - pad - (v / max) * (height - 2 * pad);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("block", className)} aria-hidden>
      {n > 1 && <path d={area} fill={stroke} opacity={0.1} />}
      {n > 1 ? (
        <path d={line} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        <circle cx={x(0)} cy={y(values[0])} r={1.75} fill={stroke} />
      )}
    </svg>
  );
}
