import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A scroll area that fades out at its lower edge while there is more below,
 * so a list that is cut by its card reads as "continues" instead of ending
 * mid-row. The fade goes once the end is reached.
 */
export function ScrollFade({
  children,
  className,
  style,
  axis = "y",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** "both" also scrolls sideways (wide tables) */
  axis?: "y" | "both";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const el = ref.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [check]);
  return (
    <div
      ref={ref}
      onScroll={check}
      className={cn(axis === "both" ? "overflow-auto" : "overflow-y-auto", more && "scroll-more", className)}
      style={style}
    >
      {children}
    </div>
  );
}
