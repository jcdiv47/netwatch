import type { ReactNode } from "react";
import { Sparkline } from "@/components/data/Bars";
import { AnimatedNumber, Dot } from "@/components/data/Motion";
import { cn } from "@/lib/utils";

export type StatItem = {
  label: string;
  /** a figure that animates between values; give `format` with it */
  num?: number;
  format?: (n: number) => string;
  /** or a ready-made value */
  value?: ReactNode;
  hint?: ReactNode;
  /** a colored swatch tying the figure to a chart series */
  swatch?: "down" | "up";
  /** the figure's trend over the range, drawn behind the tile's lower edge */
  spark?: number[];
  /** marks a figure that is sampled live */
  live?: boolean;
};

// Column counts that never leave a hole in the strip at any width.
const COLS: Record<number, string> = {
  4: "lg:grid-cols-4",
  5: "max-md:*:last:col-span-2 md:grid-cols-5",
  6: "sm:grid-cols-3 xl:grid-cols-6",
};

/** KPI strip: one surface, hairline dividers, figures that roll to new values. */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-card bg-line shadow-card",
        COLS[Math.min(6, Math.max(4, items.length))],
        className,
      )}
    >
      {items.map((s) => {
        const color = s.swatch === "down" ? "var(--series-down)" : s.swatch === "up" ? "var(--series-up)" : undefined;
        return (
          <div key={s.label} className="relative min-w-0 overflow-hidden bg-surface px-3.5 pt-3 pb-2.5">
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
              {s.swatch && <span aria-hidden className={cn("size-2 rounded-[3px]", s.swatch === "down" ? "bg-down" : "bg-up")} />}
              {s.live && (
                <span className="flex size-2 items-center justify-center">
                  <Dot live />
                </span>
              )}
              <span className="truncate">{s.label}</span>
            </div>
            <div className="mt-1 flex items-end gap-3">
              <div className="truncate text-[24px] leading-8 font-semibold tracking-[-0.035em] text-ink tabular-nums">
                {s.num !== undefined && s.format ? <AnimatedNumber value={s.num} format={s.format} /> : s.value}
              </div>
              {s.spark && s.spark.length > 3 && (
                <Sparkline
                  values={s.spark}
                  stroke={color ?? "var(--ink-3)"}
                  width={120}
                  height={28}
                  area={false}
                  animate
                  className="mb-1 ml-auto h-7 min-w-0 flex-1 max-sm:hidden sm:max-w-28"
                />
              )}
            </div>
            {s.hint !== undefined && <div className="truncate text-[11.5px] text-ink-3">{s.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}
