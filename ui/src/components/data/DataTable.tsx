import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollFade } from "@/components/data/ScrollFade";
import { useNarrow } from "@/lib/media";
import { go } from "@/lib/router";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  title: ReactNode;
  /** right-aligned figures in the mono face */
  num?: boolean;
  /** right-aligned text (dates, relative times) in the text face */
  right?: boolean;
  /** value used for sorting; omit to make the column unsortable */
  sort?: (row: T) => number | string;
  render: (row: T) => ReactNode;
  className?: string;
  headClassName?: string;
  /** drop the column below this breakpoint */
  hide?: "sm" | "md" | "lg" | "2xl";
  /** drop the column while a details panel is docked beside the table */
  dockHide?: boolean;
};

const HIDE = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden", "2xl": "max-2xl:hidden" };

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
  onRowClick,
  rowHref,
  selectedKey,
  compact,
  compactSort = true,
  compactExtra,
  compactCap,
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
  /** makes rows activatable (click, Enter); clicks on links inside a row keep working */
  onRowClick?: (row: T) => void;
  /** makes the whole row a way into another page */
  rowHref?: (row: T) => string;
  selectedKey?: string | null;
  /** phone-width rendering of a row; the table becomes a list of these */
  compact?: (row: T) => ReactNode;
  /** show the phone list's sort control (off where the view has its own order switch) */
  compactSort?: boolean;
  /** a control for the right end of the phone list's sort row */
  compactExtra?: ReactNode;
  /** cap the phone list at its first rows even without a maxHeight */
  compactCap?: boolean;
}) {
  const narrow = useNarrow();
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null);
  const [shown, setShown] = useState(pageSize);
  // A phone list is never a scroll area inside the page: a capped table shows
  // its first rows and grows on request instead.
  const [phoneShown, setPhoneShown] = useState(8);

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
  const activate = onRowClick ?? (rowHref && ((row: T) => go(rowHref(row))));

  const more = sorted.length > shown && (
    <button
      type="button"
      onClick={() => setShown((n) => n + pageSize * 4)}
      className="sticky left-0 block h-10 w-full border-t border-line text-center text-[12px] text-ink-2 transition-colors hover:bg-hover hover:text-ink md:h-9"
    >
      Show more · {(sorted.length - shown).toLocaleString()} hidden
    </button>
  );

  if (compact && narrow) {
    const sortable = columns.filter((c) => c.sort && typeof c.title === "string");
    const capped = !!maxHeight || !!compactCap;
    const list = capped ? sorted.slice(0, phoneShown) : visible;
    return (
      <div className="transition-opacity duration-200">
        {((compactSort && sortable.length > 1 && visible.length > 1) || compactExtra) && (
          <div className="flex h-14 items-center gap-1.5 border-b border-line bg-inset px-3.5 text-[12px] text-ink-3">
            {compactSort && sortable.length > 1 && (
              <>
                <label className="relative flex h-10 items-center rounded-full bg-field pl-3 shadow-hairline">
                  <span>Sort</span>
                  <select
                    value={sort?.key ?? ""}
                    onChange={(e) => setSort(e.target.value ? { key: e.target.value, dir: -1 } : null)}
                    className="h-10 appearance-none rounded-full bg-transparent pr-7 pl-1.5 text-[12.5px] font-medium text-ink outline-none"
                  >
                    {!sort && <option value="">Default order</option>}
                    {sortable.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} aria-hidden className="pointer-events-none absolute right-2.5 text-ink-3" />
                </label>
                {sort && (
                  <button
                    type="button"
                    onClick={() => setSort({ key: sort.key, dir: sort.dir > 0 ? -1 : 1 })}
                    aria-label={sort.dir > 0 ? "Low to high. Switch to high to low." : "High to low. Switch to low to high."}
                    title={sort.dir > 0 ? "Low to high" : "High to low"}
                    className="flex size-10 items-center justify-center rounded-full bg-field text-ink-2 shadow-hairline active:bg-hover-2"
                  >
                    {sort.dir > 0 ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />}
                  </button>
                )}
              </>
            )}
            {compactExtra && <div className="ml-auto flex items-center">{compactExtra}</div>}
          </div>
        )}
        {visible.length === 0 ? (
          <div className="px-3.5 py-8 text-center text-[12px] text-ink-3">{empty}</div>
        ) : (
          <ul>
            {list.map((row) => (
              <li
                key={rowKey(row)}
                tabIndex={activate ? 0 : undefined}
                aria-selected={onRowClick ? rowKey(row) === selectedKey : undefined}
                onClick={
                  activate &&
                  ((e) => {
                    if (!(e.target as HTMLElement).closest("a,button,input")) activate(row);
                  })
                }
                onKeyDown={
                  activate &&
                  ((e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) activate(row);
                  })
                }
                className={cn(
                  "border-b border-line-soft px-3.5 py-2.5 outline-offset-[-2px] last:border-b-0 active:bg-hover aria-selected:bg-accent-tint",
                  activate && "cursor-pointer",
                )}
              >
                {compact(row)}
              </li>
            ))}
          </ul>
        )}
        {capped
          ? sorted.length > phoneShown && (
              <button
                type="button"
                onClick={() => setPhoneShown((n) => n + 20)}
                className="block h-11 w-full border-t border-line text-center text-[12.5px] text-ink-2 active:bg-hover"
              >
                Show more · {(sorted.length - phoneShown).toLocaleString()} hidden
              </button>
            )
          : more}
      </div>
    );
  }

  return (
    <ScrollFade axis="both" className={cn("transition-opacity duration-200", className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-separate border-spacing-0 text-[12.5px]">
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
                    "sticky top-0 z-10 h-8 border-b border-line bg-inset px-2.5 text-[11px] font-medium tracking-[0.01em] whitespace-nowrap text-ink-3 first:pl-3.5 last:pr-3.5",
                    c.num || c.right ? "text-right" : "text-left",
                    c.hide && HIDE[c.hide],
                    c.dockHide && "dock-hide",
                    c.headClassName,
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => setSort({ key: c.key, dir: active ? (sort.dir > 0 ? -1 : 1) : -1 })}
                      className={cn(
                        "group/sort inline-flex items-center gap-0.5 rounded-[4px] transition-colors duration-100 hover:text-ink",
                        active && "text-ink",
                      )}
                    >
                      {c.title}
                      {active ? (
                        sort.dir > 0 ? (
                          <ChevronUp size={12} aria-hidden />
                        ) : (
                          <ChevronDown size={12} aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown size={11} aria-hidden className="opacity-0 transition-opacity group-hover/sort:opacity-60" />
                      )}
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
              <td colSpan={columns.length} className="px-3.5 py-8 text-center text-[12px] text-ink-3">
                {empty}
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn("group/row", activate && "cursor-pointer outline-offset-[-2px]")}
                tabIndex={activate ? 0 : undefined}
                aria-selected={onRowClick ? rowKey(row) === selectedKey : undefined}
                onClick={
                  activate &&
                  ((e) => {
                    if (!(e.target as HTMLElement).closest("a,button,input")) activate(row);
                  })
                }
                onKeyDown={
                  activate &&
                  ((e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) activate(row);
                  })
                }
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "h-[33px] border-b border-line-soft px-2.5 whitespace-nowrap text-ink transition-colors duration-75 group-last/row:border-b-0 group-hover/row:bg-hover group-aria-selected/row:bg-accent-tint first:pl-3.5 last:pr-3.5",
                      c.num && "num text-right text-[12px]",
                      c.right && "text-right",
                      c.hide && HIDE[c.hide],
                      c.dockHide && "dock-hide",
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
      {more}
    </ScrollFade>
  );
}
