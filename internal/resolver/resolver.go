// Package resolver maps flow source IPs to devices (keyed by MAC) using
// read-only data pulled from the router: DHCP leases, static hosts, and the
// IPv4/IPv6 neighbour tables. IP->MAC observations are kept historically so
// rotated IPv6 privacy addresses still resolve after they leave the
// neighbour table.
package resolver

import (
	"context"
	"log/slog"
	"net/netip"
	"strings"
	"sync"
	"time"

	"netwatch/internal/flow"
	"netwatch/internal/store"
)

// Runner runs a shell command on the router and returns stdout.
type Runner func(ctx context.Context, cmd string) (string, error)

type macSeen struct {
	mac      string
	lastSeen int64
}

// Env is the router address environment used for classification.
type Env struct {
	RouterAddrs map[netip.Addr]bool
	LANPrefixes []netip.Prefix
	TunPrefixes []netip.Prefix
	TunMark     uint32
	TunMask     uint32
}

func (e *Env) IsRouter(a netip.Addr) bool {
	a = a.Unmap()
	if a.IsLoopback() || e.RouterAddrs[a] {
		return true
	}
	for _, p := range e.TunPrefixes {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// IsBroadcast reports whether a is the directed broadcast address of an
// IPv4 LAN prefix.
func (e *Env) IsBroadcast(a netip.Addr) bool {
	a = a.Unmap()
	if !a.Is4() {
		return false
	}
	for _, p := range e.LANPrefixes {
		if !p.Addr().Is4() || !p.Contains(a) {
			continue
		}
		b := p.Masked().Addr().As4()
		bits := p.Bits()
		for i := 0; i < 4; i++ {
			hostBits := 32 - bits - (3-i)*8
			if hostBits >= 8 {
				b[i] = 0xff
			} else if hostBits > 0 {
				b[i] |= byte(1<<hostBits - 1)
			}
		}
		if netip.AddrFrom4(b) == a {
			return true
		}
	}
	return false
}

func (e *Env) IsLAN(a netip.Addr) bool {
	a = a.Unmap()
	for _, p := range e.LANPrefixes {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

type Resolver struct {
	run      Runner
	st       *store.Store
	lanDevs  map[string]bool
	tunDev   string
	interval time.Duration
	log      *slog.Logger
	now      func() time.Time

	mu          sync.RWMutex
	ipMAC       map[netip.Addr]macSeen
	env         Env
	lastRefresh time.Time
	lastErr     error
	refreshes   int64

	kick chan struct{}
}

type Options struct {
	LANInterfaces []string // default ["br-lan"]
	TunInterface  string   // default "singbox_tun"
	Interval      time.Duration
}

func New(run Runner, st *store.Store, opt Options, log *slog.Logger) *Resolver {
	if len(opt.LANInterfaces) == 0 {
		opt.LANInterfaces = []string{"br-lan"}
	}
	if opt.TunInterface == "" {
		opt.TunInterface = "singbox_tun"
	}
	if opt.Interval <= 0 {
		opt.Interval = 45 * time.Second
	}
	lan := map[string]bool{}
	for _, d := range opt.LANInterfaces {
		lan[d] = true
	}
	if log == nil {
		log = slog.Default()
	}
	return &Resolver{
		run: run, st: st, lanDevs: lan, tunDev: opt.TunInterface, interval: opt.Interval, log: log,
		now: time.Now, ipMAC: map[netip.Addr]macSeen{}, kick: make(chan struct{}, 1),
		env: Env{RouterAddrs: map[netip.Addr]bool{}, TunMark: 0x2023, TunMask: 0x2027},
	}
}

// LoadHistory loads persisted IP->MAC observations.
func (r *Resolver) LoadHistory(ctx context.Context) error {
	if r.st == nil {
		return nil
	}
	hist, err := r.st.LoadIPHistory(ctx)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, h := range hist {
		a, err := netip.ParseAddr(h.IP)
		if err != nil {
			continue
		}
		if cur, ok := r.ipMAC[a]; !ok || h.LastSeen >= cur.lastSeen {
			r.ipMAC[a] = macSeen{mac: h.MAC, lastSeen: h.LastSeen}
		}
	}
	return nil
}

// Env returns a copy of the current router environment.
func (r *Resolver) Env() Env {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.env
}

// Status for the API.
func (r *Resolver) Status() (time.Time, error, int, int64) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.lastRefresh, r.lastErr, len(r.ipMAC), r.refreshes
}

// Lookup resolves an IP to a device key ("router" or a MAC).
func (r *Resolver) Lookup(ip string) (string, bool) {
	a, err := netip.ParseAddr(ip)
	if err != nil {
		return "", false
	}
	a = a.Unmap()
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.env.IsRouter(a) {
		return "router", true
	}
	if m, ok := r.ipMAC[a]; ok {
		return m.mac, true
	}
	return "", false
}

// KeyFor returns the device key for a flow at the time it is seen.
//
//   - tun inbound (normal LAN traffic): source IP -> MAC, the router itself
//     -> "router", otherwise "ip:<addr>" (unresolved; triggers a refresh).
//   - other sing-box inbounds (shadowsocks for remote users, mixed proxy):
//     a LAN source that resolves keeps its device; anything else becomes
//     "inbound:<tag>" (plus ":<user>" when sing-box reports a user).
func (r *Resolver) KeyFor(f *flow.Flow) string {
	key, ok := r.Lookup(f.SrcIP)
	if f.Source == flow.SourceSingbox && f.InboundType != "" && f.InboundType != "tun" {
		a, err := netip.ParseAddr(f.SrcIP)
		env := r.Env()
		if ok && err == nil && (env.IsLAN(a) || key == "router") {
			return key
		}
		k := "inbound:" + f.Inbound
		if f.User != "" {
			k += ":" + f.User
		}
		return k
	}
	if ok {
		return key
	}
	r.Kick()
	return "ip:" + f.SrcIP
}

// Kick requests an early refresh (rate limited by the loop).
func (r *Resolver) Kick() {
	select {
	case r.kick <- struct{}{}:
	default:
	}
}

// Run refreshes periodically until ctx is done.
func (r *Resolver) Run(ctx context.Context) {
	t := time.NewTicker(r.interval)
	defer t.Stop()
	last := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-r.kick:
			if time.Since(last) < 10*time.Second {
				// Coalesce bursts; the kick is dropped and the next
				// tick or kick picks it up.
				wait := 10*time.Second - time.Since(last)
				select {
				case <-ctx.Done():
					return
				case <-time.After(wait):
				}
			}
		}
		last = time.Now()
		if err := r.Refresh(ctx); err != nil && ctx.Err() == nil {
			r.log.Warn("router refresh failed", "err", err)
		}
	}
}

// Refresh pulls router state once and applies it.
func (r *Resolver) Refresh(ctx context.Context) error {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := r.run(cctx, RouterCommand)
	if err == nil && !strings.Contains(out, "##END") {
		err = errIncomplete
	}
	if err != nil {
		r.mu.Lock()
		r.lastErr = err
		r.mu.Unlock()
		return err
	}
	return r.Apply(ctx, ParseRouterOutput(out))
}

type strErr string

func (e strErr) Error() string { return string(e) }

const errIncomplete = strErr("incomplete router output")

// Apply merges a router snapshot into the in-memory maps and the store.
func (r *Resolver) Apply(ctx context.Context, snap RouterSnapshot) error {
	nowMs := r.now().UnixMilli()
	env := Env{RouterAddrs: map[netip.Addr]bool{}, TunMark: 0x2023, TunMask: 0x2027}
	if snap.TunMarkMask != 0 {
		env.TunMark, env.TunMask = snap.TunMark, snap.TunMarkMask
	}
	var routerIP4 string
	for _, a := range snap.Addrs {
		env.RouterAddrs[a.Prefix.Addr().Unmap()] = true
		if a.Dev == r.tunDev {
			env.TunPrefixes = append(env.TunPrefixes, a.Prefix.Masked())
		}
		if r.lanDevs[a.Dev] && !a.Prefix.Addr().IsLinkLocalUnicast() {
			env.LANPrefixes = append(env.LANPrefixes, a.Prefix.Masked())
			if a.Prefix.Addr().Is4() && routerIP4 == "" {
				routerIP4 = a.Prefix.Addr().String()
			}
		}
	}

	var obs []store.IPMAC
	hosts := map[string]store.DeviceInfo{}
	setHost := func(mac, name, ip string, override bool) {
		h, ok := hosts[mac]
		if !ok {
			h = store.DeviceInfo{Key: mac, Kind: "lan"}
		}
		if name != "" && (override || h.Hostname == "") {
			h.Hostname = name
		}
		if ip != "" {
			if a, err := netip.ParseAddr(ip); err == nil && a.Is4() {
				h.IP = ip
			} else if h.IP == "" {
				h.IP = ip
			}
		}
		hosts[mac] = h
	}
	for _, l := range snap.Leases {
		obs = append(obs, store.IPMAC{IP: l.IP, MAC: l.MAC, Src: "lease"})
		setHost(l.MAC, l.Hostname, l.IP, false)
	}
	for _, s := range snap.Static {
		name := s.Name
		if name == "" && s.IP != "" {
			name = snap.HostsNames[s.IP]
		}
		for _, mac := range s.MACs {
			if s.IP != "" && len(s.MACs) == 1 {
				obs = append(obs, store.IPMAC{IP: s.IP, MAC: mac, Src: "static"})
			}
			setHost(mac, name, s.IP, name != "")
		}
	}
	for _, n := range snap.Neigh {
		if !r.lanDevs[n.Dev] {
			continue
		}
		a, err := netip.ParseAddr(n.IP)
		if err != nil || a.IsLinkLocalUnicast() || a.IsMulticast() {
			continue
		}
		obs = append(obs, store.IPMAC{IP: a.String(), MAC: n.MAC, Src: "neigh"})
		setHost(n.MAC, "", a.String(), false)
	}
	// Leases for static hosts without a uci name may still be named via the
	// generated hosts files.
	for mac, h := range hosts {
		if h.Hostname == "" && h.IP != "" {
			if nm := snap.HostsNames[h.IP]; nm != "" {
				h.Hostname = nm
				hosts[mac] = h
			}
		}
	}
	routerName := snap.HostsNames[routerIP4]
	if routerName == "" {
		routerName = "router"
	}
	hosts["router"] = store.DeviceInfo{Key: "router", Kind: "router", Hostname: routerName, IP: routerIP4}

	r.mu.Lock()
	for _, o := range obs {
		a, err := netip.ParseAddr(o.IP)
		if err != nil {
			continue
		}
		r.ipMAC[a.Unmap()] = macSeen{mac: o.MAC, lastSeen: nowMs}
	}
	r.env = env
	r.lastRefresh = r.now()
	r.lastErr = nil
	r.refreshes++
	r.mu.Unlock()

	if r.st != nil {
		return r.st.RecordNeighbours(ctx, obs, hosts)
	}
	return nil
}
