import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { ValuePill } from "@/components/atoms/ValuePill";
import type { Flow, Kind } from "@/lib/api";
import { href } from "@/lib/router";
import { cn } from "@/lib/utils";

const linkCls = "rounded-[3px] text-ink decoration-ink-3 underline-offset-2 hover:text-accent-ink hover:underline";

export function DeviceLink({ k, name, className }: { k: string; name?: string; className?: string }) {
  return (
    <a href={href.device(k)} className={cn(linkCls, "font-medium", className)}>
      {name || k}
    </a>
  );
}

export function TargetLink({ target, className }: { target: string; className?: string }) {
  return (
    <a href={href.domain(target)} title={target} className={cn(linkCls, className)}>
      {target}
    </a>
  );
}

const KIND_TONE: Record<Kind, "accent" | "orange" | "neutral"> = {
  lan: "neutral",
  router: "accent",
  remote: "orange",
  unknown: "neutral",
};

export function KindPill({ kind }: { kind: Kind }) {
  if (kind === "lan") return null;
  return (
    <ValuePill tone={KIND_TONE[kind]} className="ml-1 text-[11px]!">
      {kind}
    </ValuePill>
  );
}

/** Flows recorded from router conntrack never passed through sing-box. */
export function SourcePill({ flow }: { flow: Flow }) {
  if (flow.source !== "conntrack") return null;
  return (
    <span title="from router conntrack (not seen by sing-box)">
      <ValuePill className="ml-1 font-mono text-[10.5px]!">{flow.inbound}</ValuePill>
    </span>
  );
}

/** "Open connections" indicator: a status dot that always ships with its count. */
export function OpenDot({ n }: { n: number | undefined }) {
  if (!n) return <span className="text-ink-3">–</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span aria-hidden className="size-1.5 rounded-full bg-green" />
      {n.toLocaleString()}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[11.5px] text-ink-2", className)}>{children}</span>;
}

/** Filter field in the Beautiful UI search style. */
export function FilterInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex h-7 w-56 cursor-text! items-center gap-1.5 rounded-control bg-field px-2 shadow-hairline focus-within:shadow-[0_0_0_1.5px_var(--accent)]",
        className,
      )}
    >
      <Search size={13} className="shrink-0 text-ink-3" aria-hidden />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => onChange("")}
          className="flex size-4 items-center justify-center rounded-full text-ink-3 hover:bg-hover-2 hover:text-ink"
        >
          <X size={11} aria-hidden />
        </button>
      )}
    </label>
  );
}

export type Chip<K extends string> = { key: K; label: string; count?: number };

/** Filter chips in the Beautiful UI FilterTable style: one row, counts inline. */
export function Chips<K extends string>({
  chips,
  value,
  onChange,
  label,
}: {
  chips: Chip<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      {chips.map((c) => {
        const active = c.key === value;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(c.key)}
            className={cn(
              "flex h-6.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-[background-color,box-shadow,color] duration-200",
              active ? "bg-surface text-ink shadow-btn" : "text-ink-2 hover:bg-hover-2",
            )}
          >
            {c.label}
            {c.count !== undefined && (
              <span className={cn("tnum text-[10.5px]", active ? "text-ink-2" : "text-ink-3")}>{c.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control (range picker, chart/table switch). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly { id: K; label: ReactNode; title?: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex items-center rounded-control bg-hover-2 p-0.5", className)}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={cn(
              "tnum flex h-6 min-w-7 items-center justify-center rounded-[6px] px-2 text-[12px] font-medium transition-[background-color,color] duration-150",
              active ? "bg-surface text-ink shadow-btn" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
