import type { ReactNode } from "react";
import { SplitBar } from "@/components/data/Bars";
import { Fig } from "@/components/data/Bits";
import { bytes } from "@/lib/format";

/**
 * Phone-width row for the "who moved how much" tables: name and total on the
 * first line, the split bar, then a quiet line with the detail.
 */
export function CompactStat({
  lead,
  sub,
  down,
  up,
  max,
  format = bytes,
}: {
  lead: ReactNode;
  sub?: ReactNode;
  down: number;
  up: number;
  max: number;
  format?: (n: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 truncate text-[13px]">{lead}</div>
        <Fig className="shrink-0 text-[12.5px]">{format(down + up)}</Fig>
      </div>
      <SplitBar down={down} up={up} max={max} className="h-1" />
      <div className="flex items-center gap-3 text-[11.5px] text-ink-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{sub}</div>
        <span className="flex shrink-0 items-center gap-1 text-[11px]">
          <span className="text-down">↓</span>
          <Fig>{format(down)}</Fig>
          <span className="ml-1 text-up">↑</span>
          <Fig>{format(up)}</Fig>
        </span>
      </div>
    </div>
  );
}
