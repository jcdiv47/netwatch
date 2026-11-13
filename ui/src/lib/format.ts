export function bytes(n: number | null | undefined): string {
  let v = Number(n) || 0;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)) + " " + u[i];
}

export const rate = (n: number | null | undefined) => bytes(n) + "/s";

export const count = (n: number | null | undefined) => (Number(n) || 0).toLocaleString();

export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return Math.round(s) + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

export function dur(ms: number): string {
  const s = Math.max(0, ms / 1000);
  if (s < 60) return Math.round(s) + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return (s / 3600).toFixed(1) + "h";
  return (s / 86400).toFixed(1) + "d";
}

export function ts(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const fullTime = (ms: number) => new Date(ms).toLocaleString();

/** Axis tick for a bucket starting at t (unix s). */
export function axisLabel(t: number, bucket: number): string {
  const d = new Date(t * 1000);
  if (bucket < 86400) {
    return d.getHours() === 0
      ? d.toLocaleDateString([], { month: "short", day: "numeric" })
      : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Full label for a bucket starting at t (unix s). */
export function bucketLabel(t: number, bucket: number): string {
  const a = new Date(t * 1000);
  const b = new Date((t + bucket) * 1000);
  if (bucket < 86400) {
    return (
      a.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) +
      "–" +
      b.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }
  if (bucket === 86400) {
    return a.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  }
  return "Week of " + a.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const pct = (v: number, total: number) =>
  total > 0 ? (v / total >= 0.1 ? Math.round((100 * v) / total) : ((100 * v) / total).toFixed(1)) + "%" : "–";
