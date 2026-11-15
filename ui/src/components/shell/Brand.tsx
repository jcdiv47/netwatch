import { cn } from "@/lib/utils";

/** The netwatch mark: a radar face whose sweep turns while the stream is up. */
export function BrandMark({ live = true, className }: { live?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-[oklch(0.24_0.03_262)] text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.14),0_0_0_1px_oklch(0_0_0/0.25)] dark:bg-[oklch(0.3_0.035_262)]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-full" fill="none">
        <defs>
          <linearGradient id="nw-sweep" x1="12" y1="3" x2="21" y2="12" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6aa8ff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#6aa8ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeOpacity="0.28" />
        <circle cx="12" cy="12" r="4.25" stroke="currentColor" strokeOpacity="0.4" />
        <g className={cn("origin-[12px_12px]", live && "animate-[sweep_5s_linear_infinite]")}>
          <path d="M12 12V4a8 8 0 0 1 8 8z" fill="url(#nw-sweep)" />
          <path d="M12 12V4" stroke="#8fbcff" strokeWidth="1.1" strokeLinecap="round" />
        </g>
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
    </span>
  );
}
