import { useId } from "react";
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
      className={cn("h-1.5 w-full min-w-14 rounded-full bg-hover-2/80", className)}
      title={`↓ ${bytes(down)} · ↑ ${bytes(up)}`}
    >
      <div
        className="grow-x flex h-full gap-px overflow-hidden rounded-full transition-[width] duration-500 ease-out-strong"
        style={{ width: `${width}%` }}
      >
        {down > 0 && <span className="h-full bg-down transition-[width] duration-500 ease-out-strong" style={{ width: `${downShare}%` }} />}
        {up > 0 && <span className="h-full flex-1 bg-up" />}
      </div>
    </div>
  );
}

/** Tiny trend line. One series, so no axis and no legend. */
export function Sparkline({
  values,
  width = 84,
  height = 20,
  className,
  stroke = "var(--ink-2)",
  fill = false,
  animate = false,
  area = true,
}: {
  values: number[] | undefined;
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
  /** soft gradient under the line instead of a flat tint */
  fill?: boolean;
  /** draw the line in on mount */
  animate?: boolean;
  /** tint under the line */
  area?: boolean;
}) {
  const id = useId();
  if (!values || values.length < 2) return <span className={cn("inline-block", className)} style={{ width, height }} />;
  const max = Math.max(...values);
  if (max <= 0) return <span className={cn("inline-block", className)} style={{ width, height }} />;
  const pad = 1.5;
  const n = values.length;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));
  const flat = Math.max(...values) - Math.min(...values) < max * 0.02;
  const y = (v: number) => (flat ? height / 2 : height - pad - (v / max) * (height - 2 * pad));
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const areaPath = `${line}L${x(n - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block", className)}
      aria-hidden
    >
      {fill && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={stroke} stopOpacity={0.28} />
            <stop offset="1" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}
      {n > 1 && area && <path d={areaPath} fill={fill ? `url(#${id})` : stroke} opacity={fill ? 1 : 0.1} className={animate ? "animate-rise" : undefined} />}
      {n > 1 ? (
        <path
          d={line}
          pathLength={1}
          fill="none"
          stroke={stroke}
          strokeWidth={area ? 1.25 : 1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className={animate ? "draw-in" : undefined}
        />
      ) : (
        <circle cx={x(0)} cy={y(values[0])} r={1.75} fill={stroke} />
      )}
    </svg>
  );
}
