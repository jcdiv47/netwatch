// Types mirror the JSON written by internal/web/web.go.

export type Kind = "lan" | "router" | "remote" | "unknown";

export type Device = {
  key: string;
  kind: Kind;
  name: string;
  hostname: string;
  friendly_name: string;
  last_ip4: string;
  last_ip6: string;
  first_seen: number;
  last_seen: number;
  up: number;
  down: number;
  conns: number;
  targets?: number;
  open?: number;
  spark?: number[];
};

export type TargetStat = {
  target: string;
  up: number;
  down: number;
  conns: number;
  devices?: number;
  first_seen?: number;
  last_seen?: number;
};

export type Point = { t: number; up: number; down: number };

export type Flow = {
  id: string;
  source: "singbox" | "conntrack";
  device_key: string;
  device_name: string;
  src_ip: string;
  src_port: number;
  dst_ip: string;
  dst_port: number;
  domain: string;
  target: string;
  network: string;
  protocol: string;
  inbound: string;
  inbound_type: string;
  outbound: string;
  rule: string;
  chain: string;
  user: string;
  ip_version: number;
  created_at: number;
  closed_at: number | null;
  up: number;
  down: number;
  rate_up?: number;
  rate_down?: number;
};

export type Totals = { up: number; down: number; conns: number; devices: number; targets: number };
export type Link = { device_key: string; target: string; up: number; down: number };
export type NewTarget = { device_key: string; device_name: string; target: string; first_seen: number };
export type RouteStat = { route: string; up: number; down: number; conns: number };

export type Overview = {
  range: string;
  bucket: number;
  totals: Totals;
  open: number;
  series: Point[] | null;
  top_devices: Device[] | null;
  top_targets: TargetStat[] | null;
  links: Link[] | null;
  new_targets: NewTarget[] | null;
  routes: RouteStat[] | null;
};

export type DevicesResp = { range: string; bucket: number; buckets: number[] | null; devices: Device[] | null };

export type DeviceResp = {
  range: string;
  bucket: number;
  device: Device;
  totals: { up: number; down: number; conns: number; targets: number };
  top_targets: TargetStat[] | null;
  series: Point[] | null;
  recent_flows: Flow[] | null;
  new_targets: TargetStat[] | null;
  ips: { ip: string; src: string; first_seen: number; last_seen: number }[] | null;
  open: number;
};

export type DomainsResp = { range: string; domains: TargetStat[] | null };

export type TargetDevice = Device & { target_first_seen: number; target_last_seen: number };

export type DomainResp = {
  range: string;
  bucket: number;
  target: string;
  devices: TargetDevice[] | null;
  series: Point[] | null;
  recent_flows: Flow[] | null;
};

export type FlowsResp = { range: string; now: number; flows: Flow[]; more: boolean; limit: number };

export type LiveResp = { now: number; flows: Flow[] | null };

export type Status = {
  now: number;
  rate_up: number;
  rate_down: number;
  open: number;
  open_all: number;
  started: string;
  stream: { connected: boolean; last_error?: string; reconnects?: number; connected_at?: string };
  conntrack?: { Open: number; Entries: number; LastErr: string };
  resolver: { error: string; known_ips: number; last_refresh: string };
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
  return r.json() as Promise<T>;
}

export const setDeviceName = (key: string, name: string) =>
  api<{ ok: string }>("api/device/name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, name }),
  });

export const q = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
