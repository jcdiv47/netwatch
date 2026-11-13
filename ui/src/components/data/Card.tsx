import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A panel: title bar with optional meta + actions, then content. */
export function Card({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** content runs edge to edge (tables) */
  flush?: boolean;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-card bg-surface shadow-card", className)}>
      {(title || actions) && (
        <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1">
          <h2 className="truncate text-[12.5px] font-semibold text-ink">{title}</h2>
          {meta && <span className="truncate text-[12px] text-ink-3">{meta}</span>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", !flush && "p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-16 items-center justify-center px-3 py-6 text-[12px] text-ink-3">{children}</div>;
}

export function ErrorNote({ error }: { error: string }) {
  return (
    <div role="alert" className="rounded-control bg-red-tint px-3 py-2 text-[12px] text-red">
      {error}
    </div>
  );
}
