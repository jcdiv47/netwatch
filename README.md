# netwatch

Home-network traffic monitor: records which LAN device talks to which
domains, keeps history in SQLite, and serves a small web UI + JSON API.
Single Go binary, no external services.

Data sources (all read-only):

1. **sing-box connection stream** on the router (ImmortalWrt + momo):
   `daemon.StartedService/SubscribeConnections` on the sing-box API
   (`192.168.2.1:9090`, gRPC h2c, `authorization: Bearer <secret>`). This
   gives every proxied/routed connection with its sniffed domain and byte
   totals.
2. **Router state over ssh** every ~45 s: `/tmp/dhcp.leases`,
   `uci show dhcp` (static hosts), `ip neigh` / `ip -6 neigh`,
   `ip -o addr`, `/tmp/hosts/*`, `ip rule`. Used to map source IPs to
   devices by MAC.
3. **Conntrack** (`/proc/net/nf_conntrack` over ssh every 20 s) for traffic
   sing-box cannot see (see below).

## Build

```sh
go build -o netwatch ./cmd/netwatch
go test ./...
```

Go toolchain as pinned in go.mod (1.27). Pure-Go SQLite (`modernc.org/sqlite`), no cgo.

The UI is a React app in `ui/` whose production build is committed to
`internal/web/static/` and embedded in the binary, so `go build` alone still
produces a working netwatch (no node needed, nothing loaded from a CDN). Node
is only needed to change the UI:

```sh
cd ui
npm install
npm run dev      # http://localhost:5173, /api proxied to a running netwatch on :8377
npm run build    # typecheck, then rewrite ../internal/web/static; rebuild the Go binary after
```

UI stack: Vite + React + Tailwind v4, with
[Beautiful UI](https://www.beautifului.dev/)'s foundation (tokens, shadows,
radii, motion) and atoms, and [EvilCharts](https://evilcharts.com/)
(Recharts) for the charts. Both are copy-in libraries; their sources live in
`ui/src/styles/foundation.css`, `ui/src/components/{atoms,primitives}/` and
`ui/src/registry/`. Local changes to them are marked `netwatch patch`; the one
that matters is that EvilCharts no longer injects a `<style>` element, because
netwatch serves the UI with `style-src 'self'`.

The gRPC client is generated from a trimmed copy of sing-box's
`daemon/started_service.proto` in `proto/` (only `SubscribeConnections` and
its messages; package/service names unchanged so the method path matches).
To regenerate:

```sh
GOBIN=/tmp/nwbin go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
GOBIN=/tmp/nwbin go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
PATH=/tmp/nwbin:$PATH protoc -I proto --go_out=internal/pb --go_opt=paths=source_relative \
  --go-grpc_out=internal/pb --go-grpc_opt=paths=source_relative proto/started_service.proto
```

## Configure

```sh
./netwatch init-config     # writes ~/.config/netwatch/config.toml (0600)
```

`init-config` reads the API secret from the router
(`jsonfilter -i /etc/momo/run/config.json -e '@.services[0].secret'`) and
writes it into the config file without printing it. netwatch refuses to start
if a config file containing a secret is group/world readable.

Keys (all optional except `secret`):

| key | default | |
|---|---|---|
| `router` | `root@192.168.2.1` | ssh target (key auth, BatchMode) |
| `ssh_options` | `[]` | extra ssh args |
| `api` | `192.168.2.1:9090` | sing-box API |
| `secret` | — | API bearer secret |
| `listen` | `127.0.0.1:8377` | web UI / API |
| `db` | `~/.local/share/netwatch/netwatch.db` | |
| `retention_days` | 30 | raw flows |
| `rollup_retention_days` | 730 | hourly rollups, IP history, first-seen |
| `stream_interval` | `2s` | sing-box update tick |
| `checkpoint_interval` | `60s` | how often open flows' bytes are persisted |
| `resolve_interval` | `45s` | router device refresh |
| `conntrack` / `conntrack_interval` | `true` / `20s` | |
| `lan_interfaces` / `tun_interface` | `["br-lan"]` / `singbox_tun` | |

Env overrides: `NETWATCH_CONFIG`, `NETWATCH_ROUTER`, `NETWATCH_API`,
`NETWATCH_SECRET`, `NETWATCH_LISTEN`, `NETWATCH_DB`,
`NETWATCH_RETENTION_DAYS`, `NETWATCH_CONNTRACK`.

## Run / install

Foreground: `./netwatch` then open <http://127.0.0.1:8377>.

As a user service:

```sh
install -Dm755 netwatch ~/.local/bin/netwatch
mkdir -p ~/.local/share/netwatch
install -Dm644 netwatch.service ~/.config/systemd/user/netwatch.service
systemctl --user daemon-reload
systemctl --user enable --now netwatch
journalctl --user -u netwatch -f
```

The ssh client needs the router key usable non-interactively and the router
already in `known_hosts`. The unit has no filesystem sandboxing on purpose:
in a user unit it breaks ssh (root-owned config files appear owned by nobody).

## UI / API

- **Overview** (`/api/overview?range=24h`): network totals, traffic over time,
  how traffic left the router (sing-box outbound or conntrack bypass class),
  top devices → top destinations, first-contact feed, top devices and
  destinations. The routing split reads raw flows, so it reaches back only as
  far as `retention_days`.
- **Devices** (`/api/devices?range=24h[&all=1]`): totals per device, with a
  per-device trend (`spark`, aligned to `buckets`).
- **Device** (`/api/device?key=<mac>&range=7d`): top domains, traffic chart,
  recent flows, destinations first seen in the range, IP addresses seen.
  Friendly name: `POST /api/device/name {"key":..,"name":..}` (JSON only).
- **Domains** (`/api/domains?range=&q=`), **Domain**
  (`/api/domain?target=<domain-or-ip>&range=`): which devices contacted it.
- **Live** (`/api/live`): open connections from memory, with rates, a
  throughput chart (sampled by the page while it is open) and current talkers.
- `/api/status`: stream / resolver / conntrack health, plus the current total
  rates (`rate_down`, `rate_up`) and `open_all`.

Navigation: `1`–`4` switch views, `⌘K`/`Ctrl K` or `/` opens the device and
domain finder, `[` collapses the sidebar. The time range, theme and sidebar
state are remembered in the browser.

Ranges: `6h 24h 7d 30d 90d 365d`. Totals and charts come from the hourly
rollups, so the 6h/24h ranges start at the top of the hour containing the
range start.

## How accounting works

- Each connection is stored once (`flows.conn_id` = sing-box UUID) with
  **absolute** byte totals. The subscription snapshot supplies totals, UPDATE
  deltas are added, and the CLOSED event's final totals are merged with
  `max()` (they include bytes moved after the last tick).
- Upserts never lower totals. Each flow remembers how much of its total was
  already added to `rollup_hourly` (`up_rolled`/`down_rolled`); only the
  difference is added, attributed to the hour it was observed. Restarts,
  re-subscriptions and replayed closed connections therefore do not double
  count.
- Open connections are checkpointed every `checkpoint_interval`; new and
  closed ones within ~5 s. On a snapshot, flows the DB still has open but the
  router no longer knows are closed at their last-seen time.
- Bytes of connections that were already open when netwatch started (or
  reconnected after a long gap) are attributed to the hour they were first
  observed.

## Devices

Devices are keyed by MAC. IP→MAC observations from leases, static hosts and
the v4/v6 neighbour tables are stored with first/last-seen times, so rotated
IPv6 privacy addresses keep resolving after they leave the neighbour table.
A flow is attributed at the time it is first seen. If its source is unknown,
an immediate router refresh is requested and the flow is re-resolved when it
is next written. Special keys:

- `router` — sources that are router addresses (LAN/WAN/tun/loopback).
- `inbound:<tag>[:<user>]` — flows arriving on non-tun sing-box inbounds
  (e.g. the shadowsocks inbounds used by remote clients) whose source is not a
  LAN device. Shown as "Remote via …".
- `ip:<addr>` — unresolved source (shown as "Unknown <addr>").

Hostnames come from DHCP leases, uci static host `name`, and
`/tmp/hosts/*`. Static hosts without a name and devices with static IPs that
never send a DHCP hostname show their MAC until you set a friendly name.

## What is and is not captured

Captured:
- Everything going through sing-box `tun-in` (auto_route/auto_redirect),
  with sniffed domain (TLS SNI / HTTP Host / QUIC), protocol, outbound chain.
- Remote clients via the shadowsocks inbounds.
- From conntrack, flows sing-box does not handle:
  - `ct:forward` — LAN host → internet bypassing the tun (e.g. hosts listed in
    the tun's `exclude_mac_address`, `route_exclude_address` targets, IPv6
    routed directly);
  - `ct:private` — LAN host → route-excluded private ranges (10/8, 100.64/10,
    172.16/12, ...);
  - `ct:portfwd` — inbound port-forwards (DNAT to a LAN host);
  - `ct:inbound` — inbound routed IPv6 to LAN hosts;
  - `ct:hairpin` — LAN → WAN address reflected to a LAN host.
  Conntrack flows have no domain (shown by destination IP) and come from
  `nf_conntrack_acct` byte counters, sampled every 20 s. Very short flows can
  be missed entirely if their entry expires between polls, and bytes moved
  after the last sample are lost.

Not captured:
- LAN↔LAN traffic on the same bridge (never touches the router's netfilter).
- Router-local services (LuCI, DNS to the router, ssh) — deliberately
  skipped.
- Domains for flows sing-box could not sniff (~15% of flows, e.g. raw
  IP/UDP); those are listed by destination IP.
- DNS query names (no DNS log source is used).
