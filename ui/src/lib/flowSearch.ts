import type { Flow } from "@/lib/api";

/** Keys understood by the connection search, here and in /api/flows. */
export const SEARCH_KEYS = [
  "device:",
  "domain:",
  "target:",
  "source:",
  "destination:",
  "port:",
  "network:",
  "protocol:",
  "inbound:",
  "inbound.type:",
  "outbound:",
  "rule:",
  "user:",
] as const;

export const SEARCH_HELP = `Words are ANDed. Plain words match the device, domain, addresses or outbound. Keys: ${SEARCH_KEYS.join(" ")}`;

const has = (v: string | undefined, needle: string) => !!v && v.toLowerCase().includes(needle);

/**
 * Client-side twin of flowQuery in internal/store/query.go, for the live list
 * (which is not in the database yet). Same keys, same meaning.
 */
export function flowMatcher(query: string): (f: Flow) => boolean {
  const tests = query
    .split(/\s+/)
    .filter(Boolean)
    .map((tok): ((f: Flow) => boolean) => {
      const plain = (f: Flow) => {
        const w = tok.toLowerCase();
        return [f.target, f.dst_ip, f.src_ip, f.outbound, f.chain, f.device_key, f.device_name].some((s) => has(s, w));
      };
      const i = tok.indexOf(":");
      if (i <= 0 || i === tok.length - 1) return plain;
      const v = tok.slice(i + 1).toLowerCase();
      switch (tok.slice(0, i).toLowerCase()) {
        case "network":
          return (f) => f.network.toLowerCase() === v;
        case "port":
          return (f) => String(f.dst_port) === v;
        case "inbound":
          return (f) => has(f.inbound, v);
        case "inbound.type":
          return (f) => has(f.inbound_type, v);
        case "source":
          return (f) => has(`${f.src_ip}:${f.src_port}`, v);
        case "destination":
          return (f) => has(`${f.dst_ip}:${f.dst_port}`, v) || has(f.domain, v);
        case "outbound":
          return (f) => has(f.outbound, v) || has(f.chain, v);
        case "device":
          return (f) => has(f.device_key, v) || has(f.device_name, v);
        case "domain":
          return (f) => has(f.domain, v);
        case "target":
          return (f) => f.target === tok.slice(i + 1);
        case "protocol":
          return (f) => has(f.protocol, v);
        case "rule":
          return (f) => has(f.rule, v);
        case "user":
          return (f) => has(f.user, v);
        default:
          return plain;
      }
    });
  return (f) => tests.every((t) => t(f));
}
