import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatItem = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** a colored swatch tying the figure to a chart series */
  swatch?: "down" | "up";
};

/** KPI strip: one surface, hairline dividers, values in proportional figures. */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-card bg-line shadow-card gap-px sm:grid-cols-3",
        items.length >= 6 ? "xl:grid-cols-6" : items.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4",
        className,
      )}
    >
      {items.map((s) => (
        <div key={s.label} className="min-w-0 bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
            {s.swatch && (
              <span
                aria-hidden
                className={cn("size-2 rounded-[2px]", s.swatch === "down" ? "bg-down" : "bg-up")}
              />
            )}
            <span className="truncate">{s.label}</span>
          </div>
          <div className="mt-0.5 truncate text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink">
            {s.value}
          </div>
          {s.hint !== undefined && <div className="truncate text-[11.5px] text-ink-3">{s.hint}</div>}
        </div>
      ))}
    </div>
  );
}
