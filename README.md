# netwatch

**Self-hosted homelab network traffic monitor** that records which LAN devices talk to which domains, stores history in SQLite, and serves a fast, embedded web dashboard and JSON API.

Built as a single, zero-dependency Go binary with an embedded React UI and pure-Go SQLite (`modernc.org/sqlite`, no cgo) — no external database, message broker, or CDN required.

---

## Highlights

- **Per-device & per-domain visibility** — Tracks traffic by MAC address across IPv4 and rotated IPv6 privacy addresses, with custom friendly names and first-contact feeds.
- **Read-only router collection** — Connects to your router's `sing-box` gRPC API for sniffed domains (TLS SNI / HTTP Host / QUIC), rules, and outbounds, and supplements it via SSH with `nf_conntrack` for traffic that bypasses the tunnel.
- **Single-binary deployment** — Production web assets are embedded in the binary and served under a strict Content Security Policy (`default-src 'self'`).
- **Accurate, restart-safe accounting** — Uses absolute per-flow byte totals and hourly rollup watermarks so restarts, reconnects, and replayed events never double-count.
- **Responsive dashboard + PWA** — Includes Overview (Sankey flow diagram, traffic timeline, routing split, first-contact feed), Devices (with sparklines), Domains, Live connections, and a searchable Connections log, with dark/light themes, keyboard navigation, and a mobile layout with home-screen manifest.

---

## How It Works

```text
Router (OpenWrt / ImmortalWrt + sing-box)
  ├── sing-box gRPC API (SubscribeConnections) ──► Collector ─► Tracker ─┐
  ├── SSH (DHCP leases, UCI, ip neigh/addr/rule) ─► Resolver ────────────┼─► SQLite (WAL) ──► Web UI & JSON API
  └── SSH (/proc/net/nf_conntrack) ───────────────► Conntrack Poller ────┘    (flows + hourly rollups)
```

All collection is **strictly read-only**:

1. **sing-box connection stream** — Subscribes to `daemon.StartedService/SubscribeConnections` over gRPC (`h2c`, `authorization: Bearer <secret>`). Captures every proxied/routed flow with sniffed domain, protocol, match rule, outbound chain, and byte totals.
2. **Router state over SSH** (default every `45s`, multiplexed with `ControlMaster`) — Reads `/tmp/dhcp.leases`, `uci -q show dhcp`, `ip -4/-6 neigh show`, `ip -o addr show`, `/tmp/hosts/*`, and `ip rule show` to resolve LAN IPs to MAC addresses and hostnames, and to learn the router's LAN prefixes and tun `fwmark`.
3. **Conntrack polling over SSH** (default every `20s`, optional) — Reads `/proc/net/nf_conntrack` to capture traffic that `sing-box` does not handle (tun-excluded hosts/prefixes, private ranges, port-forwards, inbound routed IPv6, and hairpin NAT).

---

## Prerequisites

- **Router**: OpenWrt / ImmortalWrt (or similar Linux router) running `sing-box` with the gRPC `StartedService` API exposed to your LAN (e.g., ImmortalWrt + `momo`).
- **SSH access**: Passwordless key authentication (`BatchMode=yes`) to the router, with the router's host key already present in `~/.ssh/known_hosts`.
- **Conntrack byte counters** *(optional, for non-sing-box traffic)*: `net.netfilter.nf_conntrack_acct=1` on the router (enabled by default on ImmortalWrt; without it, conntrack flows are recorded with 0 bytes).
- **Build host**: Go toolchain matching `go.mod` (`1.27+`). Node.js is **not** required to build or run `netwatch` unless you edit the frontend.

---

## Quick Start

### 1. Build

```sh
git clone https://github.com/jcdiv47/netwatch.git
cd netwatch
go build -o netwatch ./cmd/netwatch
```

### 2. Configure

If you run ImmortalWrt with `momo`, `init-config` can fetch the API secret from the router over SSH and write `~/.config/netwatch/config.toml` with mode `0600` (without printing the secret):

```sh
# Override default router (root@192.168.2.1) if needed:
NETWATCH_ROUTER=root@192.168.1.1 ./netwatch init-config
```

For other `sing-box` setups, create `~/.config/netwatch/config.toml` manually and restrict permissions to `0600` (required whenever the file contains `secret`):

```sh
mkdir -p ~/.config/netwatch
chmod 700 ~/.config/netwatch
cat <<'EOF' > ~/.config/netwatch/config.toml
router = "root@192.168.1.1"
api    = "192.168.1.1:9090"
secret = "your-sing-box-api-secret"
listen = "127.0.0.1:8377"
EOF
chmod 600 ~/.config/netwatch/config.toml
```

### 3. Run

```sh
./netwatch
```

Open <http://127.0.0.1:8377> in your browser.

---

## Configuration

`netwatch` loads configuration from `~/.config/netwatch/config.toml` (override with `-config <path>` or `NETWATCH_CONFIG`). Environment variables take precedence over the TOML file.

> **Security note:** `netwatch` refuses to start if a config file containing `secret` is readable by group or others (`chmod 600`). By default, the web server binds to `127.0.0.1:8377` with no built-in authentication — if you want remote access across your homelab, place it behind a reverse proxy with authentication or access it over Tailscale / WireGuard.

### Full `config.toml` Reference

```toml
# SSH target used for read-only router queries (leases, neighbours, conntrack).
router = "root@192.168.2.1"
ssh_options = []

# sing-box gRPC API address and bearer secret.
api = "192.168.2.1:9090"
secret = "..."

# Web UI / JSON API bind address and SQLite database path.
listen = "127.0.0.1:8377"
db = "~/.local/share/netwatch/netwatch.db"

# Retention windows (pruned hourly).
retention_days = 30           # raw flows
rollup_retention_days = 730   # hourly rollups, IP->MAC history, first-seen records

# Polling & persistence intervals.
stream_interval = "2s"        # sing-box SubscribeConnections tick
checkpoint_interval = "60s"   # how often open flows' bytes are persisted
resolve_interval = "45s"      # router device & interface refresh

# Record flows sing-box cannot see from /proc/net/nf_conntrack.
conntrack = true
conntrack_interval = "20s"

# Router interface names used for LAN/tun classification.
lan_interfaces = ["br-lan"]
tun_interface = "singbox_tun"
```

| Key | Default | Description |
| --- | --- | --- |
| `router` | `root@192.168.2.1` | SSH target (`BatchMode=yes`, key auth) |
| `ssh_options` | `[]` | Extra arguments passed to `ssh` (e.g. `["-i", "/path/to/key", "-p", "2222"]`) |
| `api` | `192.168.2.1:9090` | sing-box gRPC API host:port |
| `secret` | *(required)* | sing-box API bearer token |
| `listen` | `127.0.0.1:8377` | HTTP listen address for Web UI & API |
| `db` | `~/.local/share/netwatch/netwatch.db` | SQLite database path (respects `XDG_DATA_HOME`) |
| `retention_days` | `30` | Days to keep closed raw flow rows |
| `rollup_retention_days` | `730` | Days to keep hourly rollups, IP history, and first-seen targets |
| `stream_interval` | `2s` | `sing-box` stream update interval |
| `checkpoint_interval` | `60s` | How often long-lived open flows are checkpointed to SQLite |
| `resolve_interval` | `45s` | How often router leases/neighbours/addresses are refreshed |
| `conntrack` | `true` | Enable `/proc/net/nf_conntrack` polling |
| `conntrack_interval` | `20s` | Conntrack polling interval |
| `lan_interfaces` | `["br-lan"]` | Router LAN bridge/interface names |
| `tun_interface` | `singbox_tun` | Router `sing-box` tun interface name |

### Environment Overrides

`NETWATCH_CONFIG`, `NETWATCH_ROUTER`, `NETWATCH_API`, `NETWATCH_SECRET`, `NETWATCH_LISTEN`, `NETWATCH_DB`, `NETWATCH_RETENTION_DAYS`, `NETWATCH_CONNTRACK` (`1`/`true` or `0`/`false`).

---

## Deploying with systemd

A user service unit is included in [`netwatch.service`](./netwatch.service):

```sh
install -Dm755 netwatch ~/.local/bin/netwatch
mkdir -p ~/.local/share/netwatch
install -Dm644 netwatch.service ~/.config/systemd/user/netwatch.service
systemctl --user daemon-reload
systemctl --user enable --now netwatch
journalctl --user -u netwatch -f
```

On a headless homelab server, enable lingering so the user service starts at boot and keeps running after you log out:

```sh
loginctl enable-linger "$USER"
```

**SSH & sandboxing notes:**
- The SSH key used for the router must be usable non-interactively (an unencrypted dedicated key or an `ssh-agent` socket exported to the systemd user manager), and the router must already be in `~/.ssh/known_hosts`.
- Filesystem sandboxing directives (`ProtectSystem`, `PrivateTmp`, etc.) are intentionally omitted from the user unit: in a user unit they run inside a user namespace where root-owned `/etc/ssh/ssh_config.d/*` files appear owned by `nobody`, causing OpenSSH to reject them.

---

## Web UI & Search

### Views

| View | Shortcut | What it shows |
| --- | --- | --- |
| **Overview** | `1` | Network totals, traffic timeline, routing split (sing-box outbounds vs. conntrack bypasses), top devices → top destinations Sankey, first-contact feed, top devices & destinations |
| **Devices** | `2` | Per-device totals, open connection counts, and trend sparklines; click any device for top domains, traffic chart, recent flows, first-seen targets, IP history, and inline friendly naming |
| **Domains** | `3` | Top destinations (domains and raw IPs) with substring search; click any destination to see which devices contacted it, its traffic series, and recent flows |
| **Live** | `4` | In-memory active connections with per-flow upload/download rates, real-time sampled throughput chart, and current talkers |
| **Connections** | `5` | Historical and active flow log stored in SQLite (up to `retention_days`), sortable by time or bytes, with docked detail inspector (connection ID, rule, user, inbound type, IP version, outbound chain) |

### Keyboard Shortcuts & Layout

- `1`–`5`: Switch views
- `⌘K` / `Ctrl+K` or `/`: Open command palette (jump to view, device, or destination; change range or theme)
- `[`: Collapse or expand sidebar
- **Time ranges**: `6h`, `24h`, `7d`, `30d`, `90d`, `365d`. Totals and charts read from hourly rollups, so `6h`/`24h` align to the top of the starting hour. The routing split and Connections view query raw flows and therefore reach back up to `retention_days`.
- **Mobile & PWA**: Below `768px`, the sidebar switches to a bottom tab bar; below `640px`, tables collapse into two-line lists and connection details open as a bottom sheet. Includes a web-app manifest and touch icon for home-screen installation.
- **Color semantics**: Blue and orange consistently represent download and upload throughout the UI. Sankey device colors exclude those hues; the routing split uses solid ink for `sing-box` outbounds and hatched fills for `conntrack` bypasses.

### Connection Search Syntax

Both **Connections** (`/api/flows`) and **Live** use the same query syntax. Space-separated terms are ANDed. Plain words match device key/name, domain/target, source/destination IP, outbound, or chain. Keyed filters target specific fields:

| Filter | Match type | Example |
| --- | --- | --- |
| `device:` | substring (key, hostname, friendly name) | `device:nas` |
| `domain:` | substring | `domain:github.com` |
| `target:` | exact (domain or destination IP) | `target:1.1.1.1` |
| `source:` | substring (`ip:port`) | `source:192.168.2.42` |
| `destination:` | substring (`ip:port` or domain) | `destination:443` |
| `port:` | exact destination port | `port:53` |
| `network:` | exact (`tcp`, `udp`, …) | `network:udp` |
| `protocol:` | substring (sniffed protocol, e.g. `tls`, `quic`, `http`) | `protocol:quic` |
| `inbound:` | substring | `inbound:ct:forward` |
| `inbound.type:` | substring (`tun`, `conntrack`, `shadowsocks`, …) | `inbound.type:conntrack` |
| `outbound:` | substring (outbound or chain) | `outbound:direct` |
| `rule:` | substring | `rule:geosite` |
| `user:` | substring | `user:alice` |

Example: `device:appletv network:udp outbound:proxy port:443`

---

## JSON API

All endpoints return JSON and default to `range=24h` where applicable (`6h | 24h | 7d | 30d | 90d | 365d`).

| Method & Path | Query / Body | Description |
| --- | --- | --- |
| `GET /api/status` | — | Stream, resolver, and conntrack health, uptime, live total rates (`rate_down`, `rate_up`), and open flow count (`open_all`) |
| `GET /api/overview` | `range` | Network totals, bucketed series, top devices/targets, Sankey links, recent first-contact targets, and routing split |
| `GET /api/devices` | `range`, `all=1` | Device totals, open counts, and per-bucket sparklines (`all=1` includes devices with no traffic in the range) |
| `GET /api/device` | `key`, `range` | Single device details, top targets, traffic series, recent flows, new targets in range, and IP history |
| `POST /api/device/name` | `{"key":"…","name":"…"}` | Set or clear a device's friendly name (`Content-Type: application/json` required) |
| `GET /api/domains` | `range`, `q`, `limit` | Top destinations across all devices (default `limit=200`, max `1000`) |
| `GET /api/domain` | `target`, `range` | Devices that contacted `target`, traffic series, and recent flows |
| `GET /api/live` | — | Currently open flows (sing-box + conntrack) sorted by current transfer rate |
| `GET /api/flows` | `range`, `state`, `sort`, `q`, `limit` | Recorded flows (`state=open\|closed\|all`, `sort=date\|bytes`, default `limit=500`, max `2000`) |

---

## Internals & Scope

### Accounting

- Every connection is stored once (`flows.conn_id` = sing-box UUID, or a deterministic hash ID for conntrack entries) with **absolute** byte totals.
- Subscription snapshots supply initial totals, `UPDATE` deltas are accumulated, and `CLOSED` events merge final totals via `max()`. Upserts never decrease byte totals.
- Each flow tracks how many bytes have already been rolled into `rollup_hourly` (`up_rolled`, `down_rolled`); only the unrolled difference is added to the current observation hour. Restarts, reconnects, and replayed close events do not double-count.
- New and closed flows flush within ~5 seconds; open flows checkpoint every `checkpoint_interval` and on graceful shutdown. On stream reconnect/snapshot, flows still open in SQLite that the router no longer reports are closed at their last-seen timestamp.
- Traffic from connections already open when `netwatch` starts (or after a long outage) is attributed to the hour it is first observed.

### Device Attribution

Devices are keyed by lowercase MAC address. Every IP→MAC observation from DHCP leases, UCI static hosts, and IPv4/IPv6 neighbour tables is stored with `first_seen`/`last_seen` timestamps so rotated IPv6 privacy addresses continue resolving after leaving the neighbour table.

If a flow arrives from an unknown IP, `netwatch` triggers an immediate rate-limited router refresh and re-resolves the flow on its next write. Special device keys:

- `router` — Router-owned addresses (LAN, WAN, tun, loopback).
- `inbound:<tag>[:<user>]` — Non-LAN clients arriving on non-tun `sing-box` inbounds (e.g. Shadowsocks), displayed as `Remote via …`.
- `ip:<addr>` — Unresolved source IP, displayed as `Unknown <addr>`.

Hostnames are pulled from DHCP leases, UCI static host `name`, and `/tmp/hosts/*`. Devices without a hostname display their MAC address until given a friendly name in the UI.

### What Is and Is Not Captured

**Captured:**
- All traffic passing through `sing-box` `tun-in` (`auto_route`/`auto_redirect`), including sniffed domains, protocols, rules, and outbound chains.
- Remote client traffic on non-tun `sing-box` inbounds.
- Non-sing-box flows via `nf_conntrack`, classified as:
  - `ct:forward` — LAN host → public internet bypassing the tun (e.g. `exclude_mac_address`, `route_exclude_address`, direct IPv6)
  - `ct:private` — LAN host → route-excluded private/non-public ranges (`10/8`, `100.64/10`, `172.16/12`, `fc00::/7`, …)
  - `ct:portfwd` — Inbound DNAT port-forwards to a LAN host
  - `ct:inbound` — Inbound routed IPv6 to a LAN host
  - `ct:hairpin` — LAN → WAN hairpin NAT reflected to a LAN host

**Not captured / limitations:**
- **Same-bridge LAN↔LAN traffic** — Switched directly on the bridge without hitting the router's netfilter.
- **Router-local services** — LuCI, router DNS, SSH to the router (intentionally excluded).
- **Unsniffable domains** — Raw IP/UDP flows that `sing-box` cannot sniff (~15% of flows) and all `conntrack` flows have no domain and are grouped by destination IP.
- **DNS query logs** — `netwatch` does not ingest DNS query logs.
- **Very short conntrack flows** — Because `/proc/net/nf_conntrack` is polled every `20s`, flows that open and expire between polls are missed, and bytes transferred after the final poll before closure are not recorded.

---

## Development

### Backend (Go)

```sh
go test ./...
go build -o netwatch ./cmd/netwatch
```

### Frontend (React + Vite + Tailwind v4)

The built frontend is committed under `internal/web/static/` and embedded into the Go binary via `//go:embed`. Node.js is only needed when changing the UI:

```sh
cd ui
npm install
npm run dev      # http://localhost:5173, proxies /api -> http://127.0.0.1:8377
                 # override target: NETWATCH_DEV_API=http://host:8377 npm run dev
npm run build    # tsc --noEmit + vite build into ../internal/web/static
```

Rebuild the Go binary after `npm run build` to embed the updated static bundle.

The UI uses Vite, React 19, Tailwind CSS v4, [Beautiful UI](https://www.beautifului.dev/) foundations/atoms, and [EvilCharts](https://evilcharts.com/) (Recharts). Local patches to copied-in UI primitives are marked with `netwatch patch` (notably disabling runtime `<style>` injection so the UI works cleanly under `style-src 'self'`).

### Regenerating gRPC Bindings

The gRPC client in `internal/pb/` is generated from a minimal subset of `sing-box`'s `daemon/started_service.proto` in `proto/started_service.proto`:

```sh
GOBIN=/tmp/nwbin go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
GOBIN=/tmp/nwbin go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
PATH=/tmp/nwbin:$PATH protoc -I proto \
  --go_out=internal/pb --go_opt=paths=source_relative \
  --go-grpc_out=internal/pb --go-grpc_opt=paths=source_relative \
  proto/started_service.proto
```

### Project Layout

```text
cmd/netwatch/       CLI entrypoint (run, init-config)
internal/
  collector/        sing-box gRPC stream subscription & periodic flusher
  config/           TOML + environment configuration loader
  conntrack/        /proc/net/nf_conntrack parser, classifier, and poller
  flow/             Shared flow data model
  pb/               Generated protobuf/gRPC bindings for sing-box StartedService
  resolver/         Router SSH state parser & historical IP->MAC resolver
  sshrun/           Multiplexed OpenSSH command runner
  store/            SQLite WAL schema, idempotent upserts, rollups, and queries
  tracker/          In-memory live connection tracker & rate calculation
  web/              HTTP server, JSON API, security headers, embedded static UI
proto/              Trimmed sing-box started_service.proto
ui/                 React + Vite + Tailwind v4 frontend source
netwatch.service    systemd user service unit
```
