import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * A figure that rolls to its new value instead of jumping. The tween runs on
 * the text node directly, so a 3-second poll does not re-render the tree.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  duration = 650,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const fmt = useRef(format);
  fmt.current = format;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    if (from === value || reduced.matches || document.hidden) {
      shown.current = value;
      el.textContent = fmt.current(value);
      return;
    }
    el.textContent = fmt.current(from);
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      shown.current = p === 1 ? value : from + (value - from) * eased;
      el.textContent = fmt.current(shown.current);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}

/** Status dot; `live` adds a slow radar ping behind it. */
export function Dot({
  tone = "green",
  live = false,
  className,
}: {
  tone?: "green" | "red" | "orange" | "idle" | "accent";
  live?: boolean;
  className?: string;
}) {
  const color = {
    green: "bg-green",
    red: "bg-red",
    orange: "bg-orange",
    accent: "bg-accent",
    idle: "bg-line-strong",
  }[tone];
  return (
    <span aria-hidden className={cn("relative inline-flex size-1.5 shrink-0", className)}>
      {live && <span className={cn("absolute inset-0 animate-ping-soft rounded-full", color)} />}
      <span className={cn("relative size-full rounded-full", color)} />
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

function SkeletonCard({ className, rows = 0 }: { className?: string; rows?: number }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-card bg-surface p-3.5 shadow-card", className)}>
      <Skeleton className="h-3.5 w-32" />
      {rows > 0 ? (
        <div className="flex flex-col gap-2.5 pt-1">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3 w-[22%]" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      ) : (
        <Skeleton className="min-h-0 flex-1 rounded-[8px]" />
      )}
    </div>
  );
}

/**
 * Placeholder with the shape of the view that is loading, so the first
 * response settles into place instead of popping onto a blank page.
 */
export function ViewSkeleton({ kind }: { kind: "dashboard" | "list" | "table" | "detail" }) {
  const charts = kind === "dashboard" || kind === "detail";
  const stats = (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-card bg-line shadow-card",
        kind === "list" ? "lg:grid-cols-4" : "sm:grid-cols-3 xl:grid-cols-6",
      )}
    >
      {Array.from({ length: kind === "list" ? 4 : 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5 bg-surface px-3.5 py-3.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {kind === "detail" && (
        <div className="flex h-12 items-center gap-3">
          <Skeleton className="size-9 rounded-[10px]" />
          <Skeleton className="h-5 w-56" />
        </div>
      )}
      {kind !== "table" && stats}
      {charts && (
        <div className="grid grid-cols-12 gap-3">
          <SkeletonCard className="col-span-12 h-72 xl:col-span-8" />
          <SkeletonCard className="col-span-12 h-72 xl:col-span-4" rows={6} />
        </div>
      )}
      <SkeletonCard rows={charts ? 7 : 16} />
    </div>
  );
}
