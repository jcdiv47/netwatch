import { useSyncExternalStore } from "react";

const queries = new Map<string, MediaQueryList>();

/** Tracks a media query. */
export function useMedia(query: string): boolean {
  let mq = queries.get(query);
  if (!mq) queries.set(query, (mq = matchMedia(query)));
  const m = mq;
  return useSyncExternalStore(
    (l) => {
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => m.matches,
  );
}

/** Phone-width layout: tables become two-line lists, panels become sheets. */
export const useNarrow = () => useMedia("(max-width: 639px)");
