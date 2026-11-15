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
  wrapActions = false,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** content runs edge to edge (tables) */
  flush?: boolean;
  /** on a phone the actions (filters, a search field) take their own full-width row */
  wrapActions?: boolean;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-card bg-surface shadow-card", className)}>
      {(title || actions) && (
        <header
          className={cn(
            "flex min-h-11 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3.5 py-1.5",
            flush && "border-b border-line",
            wrapActions && "max-md:pt-3 max-md:pb-2.5",
          )}
        >
          <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {meta && <span className="truncate text-[12px] text-ink-3">{meta}</span>}
          {actions && (
            <div className={cn("ml-auto flex flex-wrap items-center gap-1.5", wrapActions && "card-actions-wrap max-md:ml-0 max-md:w-full")}>{actions}</div>
          )}
        </header>
      )}
      <div
        className={cn(
          "min-h-0 flex-1",
          flush ? "overflow-hidden rounded-b-card" : title || actions ? "px-3.5 pb-3.5" : "p-3.5",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-16 items-center justify-center px-3 py-6 text-[12px] text-ink-3">{children}</div>;
}

export function ErrorNote({ error }: { error: string }) {
  return (
    <div role="alert" className="rounded-control bg-red-tint px-3 py-2 text-[12px] text-red shadow-[0_0_0_1px_color-mix(in_oklch,var(--red)_25%,transparent)]">
      {error}
    </div>
  );
}

/** Quiet text link for a card's action slot ("All devices"). */
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="group/link inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] text-ink-2 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
    >
      {children}
      <span aria-hidden className="text-ink-3 transition-transform duration-200 ease-out-strong group-hover/link:translate-x-0.5 group-hover/link:text-ink">
        →
      </span>
    </a>
  );
}
