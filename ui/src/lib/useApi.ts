import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean; // true until the first response for the current path
  reload: () => void;
};

// ── busy: how many first-loads are in flight, for the shell's progress line ──

let busy = 0;
const busyListeners = new Set<() => void>();
const bump = (d: number) => {
  busy = Math.max(0, busy + d);
  busyListeners.forEach((l) => l());
};
const subscribeBusy = (l: () => void) => {
  busyListeners.add(l);
  return () => busyListeners.delete(l);
};
/** True while any view is waiting for the first response of a new request. */
export const useBusy = () => useSyncExternalStore(subscribeBusy, () => busy > 0);

/**
 * Fetches JSON and, optionally, refetches on an interval while the tab is
 * visible. Data from the previous path stays on screen until the new response
 * lands (no flash on range changes), and a refetch whose body is byte-identical
 * keeps the same object so charts and tables do not re-render or re-animate.
 */
export function useApi<T>(path: string | null, refreshMs = 0): ApiState<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; path: string | null }>({
    data: null,
    error: null,
    path: null,
  });
  const [nonce, setNonce] = useState(0);
  const lastText = useRef<string | null>(null);

  useEffect(() => {
    if (!path) return;
    const ctl = new AbortController();
    let timer: number | undefined;
    let first = true;
    const settle = () => {
      if (first) {
        first = false;
        bump(-1);
      }
    };
    bump(1);
    const load = async () => {
      try {
        const r = await fetch(path, { signal: ctl.signal });
        const text = await r.text();
        if (!r.ok) throw new Error(text.trim() || r.statusText);
        settle();
        if (text === lastText.current) {
          setState((s) => (s.path === path && s.error === null ? s : { ...s, error: null, path }));
          return;
        }
        lastText.current = text;
        setState({ data: JSON.parse(text) as T, error: null, path });
      } catch (e) {
        settle();
        if (ctl.signal.aborted) return;
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), path }));
      }
    };
    void load();
    if (refreshMs > 0) {
      timer = window.setInterval(() => {
        if (!document.hidden) void load();
      }, refreshMs);
    }
    return () => {
      ctl.abort();
      settle();
      window.clearInterval(timer);
      lastText.current = null;
    };
  }, [path, refreshMs, nonce]);

  return {
    data: state.data,
    error: state.path === path ? state.error : null,
    loading: state.path !== path,
    reload: () => setNonce((n) => n + 1),
  };
}
