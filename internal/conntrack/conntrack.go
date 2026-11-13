// Package conntrack polls the router's /proc/net/nf_conntrack (read-only,
// over ssh) and records flows that sing-box does not see: traffic from hosts
// excluded from the tun, traffic to route-excluded private ranges, and
// inbound port-forwards / routed inbound IPv6 to LAN hosts.
//
// Requires nf_conntrack_acct=1 on the router for byte counters (it is on
// ImmortalWrt by default); without it bytes are 0.
package conntrack

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"netwatch/internal/flow"
	"netwatch/internal/resolver"
	"netwatch/internal/store"
)

// Entry is one parsed conntrack line.
type Entry struct {
	Family     string // ipv4 | ipv6
	Proto      string // tcp | udp | icmp | icmpv6 | ...
	State      string
	OSrc, ODst netip.Addr
	OSport     int
	ODport     int
	OBytes     int64
	RSrc, RDst netip.Addr
	RSport     int
	RDport     int
	RBytes     int64
	Mark       uint32
	Zone       string
}

// Parse parses one /proc/net/nf_conntrack line.
func Parse(line string) (Entry, bool) {
	f := strings.Fields(line)
	if len(f) < 6 {
		return Entry{}, false
	}
	e := Entry{Family: f[0], Proto: f[2]}
	var srcs, dsts []netip.Addr
	var sports, dports []int
	var bytes []int64
	for _, tok := range f[3:] {
		eq := strings.IndexByte(tok, '=')
		if eq < 0 {
			if e.State == "" && !strings.HasPrefix(tok, "[") {
				if _, err := strconv.Atoi(tok); err != nil {
					e.State = tok
				}
			}
			continue
		}
		k, v := tok[:eq], tok[eq+1:]
		switch k {
		case "src":
			a, err := netip.ParseAddr(v)
			if err != nil {
				return Entry{}, false
			}
			srcs = append(srcs, a.Unmap())
		case "dst":
			a, err := netip.ParseAddr(v)
			if err != nil {
				return Entry{}, false
			}
			dsts = append(dsts, a.Unmap())
		case "sport", "id":
			n, _ := strconv.Atoi(v)
			sports = append(sports, n)
			if k == "id" {
				dports = append(dports, 0)
			}
		case "dport":
			n, _ := strconv.Atoi(v)
			dports = append(dports, n)
		case "bytes":
			n, _ := strconv.ParseInt(v, 10, 64)
			bytes = append(bytes, n)
		case "mark":
			n, _ := strconv.ParseUint(v, 10, 32)
			e.Mark = uint32(n)
		case "zone":
			e.Zone = v
		}
	}
	if len(srcs) < 2 || len(dsts) < 2 {
		return Entry{}, false
	}
	e.OSrc, e.ODst, e.RSrc, e.RDst = srcs[0], dsts[0], srcs[1], dsts[1]
	if len(sports) >= 2 {
		e.OSport, e.RSport = sports[0], sports[1]
	}
	if len(dports) >= 2 {
		e.ODport, e.RDport = dports[0], dports[1]
	}
	if len(bytes) >= 2 {
		e.OBytes, e.RBytes = bytes[0], bytes[1]
	}
	return e, true
}

// Key identifies a conntrack entry by its original tuple.
func (e *Entry) Key() string {
	return fmt.Sprintf("%s|%s|%d|%s|%d|%s", e.Proto, e.OSrc, e.OSport, e.ODst, e.ODport, e.Zone)
}

// Class is the result of classifying an entry. LAN/Remote are from the
// LAN device's point of view; Up/Down are bytes sent/received by it.
type Class struct {
	Kind         string // ct:forward | ct:private | ct:portfwd | ct:inbound | ct:hairpin
	LAN          netip.Addr
	LANPort      int
	Remote       netip.Addr
	RemotePort   int
	Up, Down     int64
	DeviceIsOrig bool
}

func skipAddr(a netip.Addr) bool {
	return !a.IsValid() || a.IsUnspecified() || a.IsMulticast() || a.IsLinkLocalUnicast() ||
		a.IsLinkLocalMulticast() || a == netip.AddrFrom4([4]byte{255, 255, 255, 255})
}

// Classify decides whether an entry is traffic sing-box cannot see, and how
// to attribute it. ok=false means skip (covered by sing-box, or router-local).
func Classify(e Entry, env *resolver.Env) (Class, bool) {
	if skipAddr(e.OSrc) || skipAddr(e.ODst) || skipAddr(e.RSrc) || skipAddr(e.RDst) {
		return Class{}, false
	}
	if env.IsBroadcast(e.ODst) {
		return Class{}, false
	}
	// Router-originated (sing-box outbounds, DNS upstreams, ...): sing-box
	// already accounts the proxied side; counting it again would double up.
	if env.IsRouter(e.OSrc) {
		return Class{}, false
	}
	// Terminated on the router: auto_redirect to sing-box, hijacked DNS to
	// the tun stack, router services, port-forwards to the router itself
	// (e.g. the shadowsocks inbounds, which sing-box reports).
	if env.IsRouter(e.RSrc) {
		return Class{}, false
	}
	// Routed into the sing-box tun by policy routing.
	if env.TunMask != 0 && e.Mark&env.TunMask == env.TunMark {
		return Class{}, false
	}
	switch {
	case env.IsLAN(e.OSrc):
		c := Class{LAN: e.OSrc, LANPort: e.OSport, Remote: e.ODst, RemotePort: e.ODport,
			Up: e.OBytes, Down: e.RBytes, DeviceIsOrig: true}
		switch {
		case env.IsRouter(e.ODst):
			// Reflection (hairpin) to the WAN address, DNAT'ed to a LAN host.
			c.Kind, c.Remote, c.RemotePort = "ct:hairpin", e.RSrc, e.RSport
		case env.IsLAN(e.ODst) || !isPublic(e.ODst):
			c.Kind = "ct:private"
		default:
			c.Kind = "ct:forward"
		}
		return c, true
	case env.IsLAN(e.RSrc):
		c := Class{LAN: e.RSrc, LANPort: e.RSport, Remote: e.OSrc, RemotePort: e.OSport,
			Up: e.RBytes, Down: e.OBytes}
		if env.IsRouter(e.ODst) {
			c.Kind = "ct:portfwd"
		} else {
			c.Kind = "ct:inbound"
		}
		return c, true
	}
	return Class{}, false
}

var nonPublic = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("64:ff9b::/96"),
}

func isPublic(a netip.Addr) bool {
	for _, p := range nonPublic {
		if p.Contains(a) {
			return false
		}
	}
	return true
}

type ctFlow struct {
	f          flow.Flow
	rawO, rawR int64
	origIsDev  bool
	lastSeen   int64
	missing    int // consecutive polls the entry was absent from the table
}

// missingPolls is how many consecutive polls an entry must be absent before
// its flow is closed. Reading /proc/net/nf_conntrack while the table changes
// can skip live entries, so a single absence is not proof of closure.
const missingPolls = 3

// Poller periodically reads the conntrack table.
type Poller struct {
	run      resolver.Runner
	res      *resolver.Resolver
	st       *store.Store
	interval time.Duration
	log      *slog.Logger
	now      func() time.Time

	mu       sync.Mutex
	flows    map[string]*ctFlow
	lastPoll time.Time
	lastErr  error
	lastN    int // entries in table
	lastKept int // entries recorded (not covered by sing-box)
}

func NewPoller(run resolver.Runner, res *resolver.Resolver, st *store.Store, interval time.Duration, log *slog.Logger) *Poller {
	if interval <= 0 {
		interval = 20 * time.Second
	}
	if log == nil {
		log = slog.Default()
	}
	return &Poller{run: run, res: res, st: st, interval: interval, log: log, now: time.Now, flows: map[string]*ctFlow{}}
}

// Restore loads conntrack flows left open by a previous run so the same
// kernel entry keeps the same flow id.
func (p *Poller) Restore(ctx context.Context) error {
	fs, err := p.st.OpenConntrackFlows(ctx)
	if err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, f := range fs {
		origIsDev := f.Inbound != "ct:portfwd" && f.Inbound != "ct:inbound"
		cf := &ctFlow{f: f, origIsDev: origIsDev, lastSeen: f.UpdatedAt}
		if origIsDev {
			cf.rawO, cf.rawR = f.Up, f.Down
		} else {
			cf.rawO, cf.rawR = f.Down, f.Up
		}
		p.flows[f.CTKey] = cf
	}
	return nil
}

func (p *Poller) Run(ctx context.Context) {
	t := time.NewTicker(p.interval)
	defer t.Stop()
	for {
		if err := p.Poll(ctx); err != nil && ctx.Err() == nil {
			p.log.Warn("conntrack poll failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func newID(key string, ms int64) string {
	h := sha1.Sum([]byte(key))
	return "ct-" + hex.EncodeToString(h[:8]) + "-" + strconv.FormatInt(ms, 36)
}

// Poll reads the table once and persists changes.
func (p *Poller) Poll(ctx context.Context) error {
	env := p.res.Env()
	if len(env.LANPrefixes) == 0 {
		return fmt.Errorf("router environment not loaded yet")
	}
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := p.run(cctx, "cat /proc/net/nf_conntrack && echo '##END'")
	if err == nil && !strings.Contains(out, "##END") {
		err = fmt.Errorf("incomplete conntrack output")
	}
	if err != nil {
		p.mu.Lock()
		p.lastErr = err
		p.mu.Unlock()
		return err
	}
	changed := p.Ingest(out, &env)
	if len(changed) == 0 {
		return nil
	}
	if err := p.st.UpsertFlows(ctx, changed); err != nil {
		return err
	}
	return nil
}

// Ingest applies one table dump and returns flows to persist.
func (p *Poller) Ingest(table string, env *resolver.Env) []flow.Flow {
	now := p.now()
	nowMs := now.UnixMilli()
	p.mu.Lock()
	defer p.mu.Unlock()
	var dt float64
	if !p.lastPoll.IsZero() {
		dt = now.Sub(p.lastPoll).Seconds()
	}
	seen := map[string]bool{}
	var changed []flow.Flow
	total, kept := 0, 0
	for _, line := range strings.Split(table, "\n") {
		e, ok := Parse(line)
		if !ok {
			continue
		}
		total++
		c, ok := Classify(e, env)
		if !ok {
			continue
		}
		kept++
		key := e.Key()
		seen[key] = true
		cf, exists := p.flows[key]
		if exists && (e.OBytes < cf.rawO || e.RBytes < cf.rawR) {
			// Counters went backwards: the tuple was reused by a new
			// connection. Close the old flow.
			old := cf.f
			old.ClosedAt = cf.lastSeen
			old.RateUp, old.RateDown = 0, 0
			changed = append(changed, old)
			delete(p.flows, key)
			exists = false
		}
		if !exists {
			ip4v := 4
			if e.Family == "ipv6" {
				ip4v = 6
			}
			cf = &ctFlow{origIsDev: c.DeviceIsOrig, lastSeen: nowMs}
			cf.f = flow.Flow{
				ID: newID(key, nowMs), Source: flow.SourceConntrack, Inbound: c.Kind, InboundType: "conntrack",
				Network: e.Proto, IPVersion: ip4v, SrcIP: c.LAN.String(), SrcPort: c.LANPort,
				DstIP: c.Remote.String(), DstPort: c.RemotePort, CreatedAt: nowMs, CTKey: key,
			}
			cf.f.DeviceKey = p.res.KeyFor(&cf.f)
			p.flows[key] = cf
		}
		up, down := c.Up, c.Down
		moved := up != cf.f.Up || down != cf.f.Down
		if dt > 0 && exists {
			cf.f.RateUp = float64(max(0, up-cf.f.Up)) / dt
			cf.f.RateDown = float64(max(0, down-cf.f.Down)) / dt
		}
		cf.rawO, cf.rawR = e.OBytes, e.RBytes
		cf.f.Up, cf.f.Down = up, down
		cf.lastSeen = nowMs
		cf.missing = 0
		if moved || !exists {
			cf.f.UpdatedAt = nowMs
			if strings.HasPrefix(cf.f.DeviceKey, "ip:") {
				cf.f.DeviceKey = p.res.KeyFor(&cf.f)
			}
			changed = append(changed, cf.f)
		}
	}
	for key, cf := range p.flows {
		if seen[key] {
			continue
		}
		cf.missing++
		cf.f.RateUp, cf.f.RateDown = 0, 0
		if cf.missing < missingPolls {
			continue
		}
		f := cf.f
		f.ClosedAt = max(cf.lastSeen, f.CreatedAt)
		f.RateUp, f.RateDown = 0, 0
		changed = append(changed, f)
		delete(p.flows, key)
	}
	p.lastPoll = now
	p.lastErr = nil
	p.lastN, p.lastKept = total, kept
	return changed
}

// Open returns the currently open conntrack flows.
func (p *Poller) Open() []flow.Flow {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]flow.Flow, 0, len(p.flows))
	for _, cf := range p.flows {
		out = append(out, cf.f)
	}
	return out
}

type Status struct {
	LastPoll time.Time
	LastErr  string
	Entries  int
	Recorded int
	Open     int
}

func (p *Poller) Status() Status {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := Status{LastPoll: p.lastPoll, Entries: p.lastN, Recorded: p.lastKept, Open: len(p.flows)}
	if p.lastErr != nil {
		s.LastErr = p.lastErr.Error()
	}
	return s
}
