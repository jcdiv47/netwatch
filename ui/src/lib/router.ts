import { useSyncExternalStore } from "react";

export type View = "overview" | "devices" | "device" | "domains" | "domain" | "live" | "connections";
export type Route = { view: View; arg: string };

const VIEWS: View[] = ["overview", "devices", "device", "domains", "domain", "live", "connections"];

function parse(hash: string): Route {
  const [head = "", ...rest] = hash.replace(/^#\/?/, "").split("/");
  let arg = rest.join("/");
  try {
    arg = decodeURIComponent(arg);
  } catch {
    /* keep the raw text */
  }
  const view = (VIEWS as string[]).includes(head) ? (head as View) : "overview";
  return { view, arg };
}

let current = parse(location.hash);
let currentHash = location.hash;
const subscribe = (l: () => void) => {
  addEventListener("hashchange", l);
  return () => removeEventListener("hashchange", l);
};
const snapshot = () => {
  if (location.hash !== currentHash) {
    currentHash = location.hash;
    current = parse(currentHash);
  }
  return current;
};

export const useRoute = () => useSyncExternalStore(subscribe, snapshot);

export const href = {
  overview: "#/",
  devices: "#/devices",
  domains: "#/domains",
  live: "#/live",
  /** the Live view with its filter filled in */
  liveFor: (query: string) => `#/live/${encodeURIComponent(query)}`,
  /** optional search, e.g. "device:aa:bb:cc:dd:ee:ff" */
  connections: (query = "") => (query ? `#/connections/${encodeURIComponent(query)}` : "#/connections"),
  device: (key: string) => `#/device/${encodeURIComponent(key)}`,
  domain: (target: string) => `#/domain/${encodeURIComponent(target)}`,
};

export const go = (h: string) => {
  location.hash = h;
};
