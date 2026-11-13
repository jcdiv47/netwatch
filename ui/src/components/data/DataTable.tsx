import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  title: ReactNode;
  /** right-aligned, tabular figures */
  num?: boolean;
  /** value used for sorting; omit to make the column unsortable */
  sort?: (row: T) => number | string;
  render: (row: T) => ReactNode;
  className?: string;
  headClassName?: string;
};

type Sort = { key: string; dir: 1 | -1 };

/**
 * Dense, sortable table. The header sticks inside the scroll area; long lists
 * render in pages so a 1,000-row response stays cheap.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  defaultSort,
  empty = "Nothing in this range.",
  maxHeight,
  pageSize = 100,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  defaultSort?: Sort;
  empty?: ReactNode;
  /** CSS max-height of the scroll area; omit to grow with the content */
  maxHeight?: string;
  pageSize?: number;
  className?: string;
}) {
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null);
  const [shown, setShown] = useState(pageSize);

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !col?.sort) return rows;
    const value = col.sort;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);

  const visible = sorted.length > shown ? sorted.slice(0, shown) : sorted;

  return (
    <div className={cn("overflow-auto", className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="tnum w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir > 0 ? "ascending" : "descending") : undefined}
                  className={cn(
                    "sticky top-0 z-10 h-7 border-b border-line bg-inset px-2.5 text-[11.5px] font-medium whitespace-nowrap text-ink-2 first:pl-3 last:pr-3",
                    c.num ? "text-right" : "text-left",
                    c.headClassName,
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => setSort({ key: c.key, dir: active ? (sort.dir > 0 ? -1 : 1) : -1 })}
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-[4px] hover:text-ink",
                        active && "text-ink",
                      )}
                    >
                      {c.title}
                      {active &&
                        (sort.dir > 0 ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />)}
                    </button>
                  ) : (
                    c.title
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-[12px] text-ink-3">
                {empty}
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr key={rowKey(row)} className="group/row">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "h-[30px] border-b border-line-soft px-2.5 whitespace-nowrap text-ink group-last/row:border-b-0 group-hover/row:bg-hover first:pl-3 last:pr-3",
                      c.num && "text-right",
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {sorted.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + pageSize * 4)}
          className="sticky left-0 block h-8 w-full border-t border-line text-center text-[12px] text-ink-2 hover:bg-hover hover:text-ink"
        >
          Show more · {(sorted.length - shown).toLocaleString()} hidden
        </button>
      )}
    </div>
  );
}
