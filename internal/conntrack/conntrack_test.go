package conntrack

import (
	"context"
	"net/netip"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"netwatch/internal/resolver"
	"netwatch/internal/store"
)

func testEnv() *resolver.Env {
	e := &resolver.Env{RouterAddrs: map[netip.Addr]bool{}, TunMark: 0x2023, TunMask: 0x2027}
	for _, a := range []string{"192.168.2.1", "223.167.38.7", "2408:820c:8f8e:5ae0:be24:11ff:fe2c:2d4a", "fd44:2b2:2751:0:be24:11ff:fe2c:2d4a", "172.18.0.1", "fdfe:dcba:9876::1"} {
		e.RouterAddrs[netip.MustParseAddr(a)] = true
	}
	e.LANPrefixes = []netip.Prefix{netip.MustParsePrefix("192.168.2.0/24"), netip.MustParsePrefix("2408:820c:8f8e:5ae0::/64"), netip.MustParsePrefix("fd44:2b2:2751::/64")}
	e.TunPrefixes = []netip.Prefix{netip.MustParsePrefix("172.18.0.0/30"), netip.MustParsePrefix("fdfe:dcba:9876::/126")}
	return e
}

// Real lines from the router, one per class.
var lines = map[string]string{
	"router-out":    `ipv4     2 udp      17 21 src=223.167.38.7 dst=210.22.70.225 sport=51635 dport=53 packets=1 bytes=73 src=210.22.70.225 dst=223.167.38.7 sport=53 dport=51635 packets=1 bytes=62 mark=8227 zone=0 use=2`,
	"bypass-v4":     `ipv4     2 tcp      6 69 TIME_WAIT src=192.168.2.166 dst=64.44.86.166 sport=50631 dport=1443 packets=4 bytes=821 src=64.44.86.166 dst=223.167.38.7 sport=1443 dport=50631 packets=4 bytes=216 [ASSURED] mark=0 zone=0 use=2`,
	"redirect":      `ipv4     2 tcp      6 60 TIME_WAIT src=192.168.2.230 dst=172.66.0.218 sport=40855 dport=443 packets=7 bytes=2150 src=192.168.2.1 dst=192.168.2.230 sport=46479 dport=40855 packets=7 bytes=6168 [ASSURED] mark=0 zone=0 use=2`,
	"dns-to-router": `ipv4     2 udp      17 21 src=192.168.2.144 dst=192.168.2.1 sport=41198 dport=53 packets=1 bytes=65 src=192.168.2.1 dst=192.168.2.144 sport=53 dport=41198 packets=1 bytes=498 mark=8228 zone=0 use=2`,
	"tun-routed":    `ipv4     2 icmp     1 26 src=192.168.2.240 dst=142.251.40.110 type=8 code=0 id=55981 packets=5 bytes=145 [UNREPLIED] src=142.251.40.110 dst=192.168.2.240 type=0 code=0 id=55981 packets=0 bytes=0 mark=8227 zone=0 use=2`,
	"hijacked-dns":  `ipv4     2 udp      17 51 src=192.168.2.240 dst=1.1.1.1 sport=55411 dport=53 packets=1 bytes=52 src=172.18.0.2 dst=192.168.2.240 sport=53 dport=55411 packets=1 bytes=140 mark=8228 zone=0 use=2`,
	"portfwd":       `ipv4     2 udp      17 143 src=111.198.56.30 dst=223.167.38.7 sport=23365 dport=53737 packets=11971 bytes=1807401 src=192.168.2.166 dst=111.198.56.30 sport=53737 dport=23365 packets=15113 bytes=2191786 [ASSURED] mark=8228 zone=0 use=2`,
	"to-ss-inbound": `ipv4     2 tcp      6 7414 ESTABLISHED src=124.77.133.69 dst=223.167.38.7 sport=49448 dport=47450 packets=2051 bytes=331271 src=192.168.2.1 dst=124.77.133.69 sport=47450 dport=49448 packets=1665 bytes=16648734 [ASSURED] mark=0 zone=0 use=2`,
	"bypass-v6":     `ipv6     10 tcp      6 55 TIME_WAIT src=2408:820c:8f8e:5ae0:be24:11ff:fe51:8874 dst=2001:41d0:0800:1d10:0000:0000:0000:0001 sport=49649 dport=36666 packets=4 bytes=328 src=2001:41d0:0800:1d10:0000:0000:0000:0001 dst=2408:820c:8f8e:5ae0:be24:11ff:fe51:8874 sport=36666 dport=49649 packets=3 bytes=232 [ASSURED] mark=0 zone=0 use=2`,
	"redirect-v6":   `ipv6     10 tcp      6 7438 ESTABLISHED src=2408:820c:8f8e:5ae0:861a:f3b7:48d3:de20 dst=2606:b740:0049:0000:0000:0000:0000:0115 sport=36096 dport=80 packets=11722 bytes=1208300 src=2408:820c:8f8e:5ae0:be24:11ff:fe2c:2d4a dst=2408:820c:8f8e:5ae0:861a:f3b7:48d3:de20 sport=46479 dport=36096 packets=11731 bytes=1493543 [ASSURED] mark=0 zone=0 use=2`,
	"tun-v6-src":    `ipv6     10 udp      17 28 src=fdfe:dcba:9876:0000:0000:0000:0000:0001 dst=2408:8026:0480:0112:0000:0000:0000:6666 sport=60953 dport=53 packets=1 bytes=97 src=2408:8026:0480:0112:0000:0000:0000:6666 dst=fdfe:dcba:9876:0000:0000:0000:0000:0001 sport=53 dport=60953 packets=1 bytes=200 mark=8228 zone=0 use=2`,
	"broadcast":     `ipv4     2 udp      17 25 src=192.168.2.144 dst=192.168.2.255 sport=43316 dport=21027 packets=3 bytes=1500 [UNREPLIED] src=192.168.2.255 dst=192.168.2.144 sport=21027 dport=43316 packets=0 bytes=0 mark=0 zone=0 use=2`,
	"private":       `ipv4     2 tcp      6 100 ESTABLISHED src=192.168.2.144 dst=100.101.102.103 sport=40000 dport=22 packets=10 bytes=1000 src=100.101.102.103 dst=192.168.2.144 sport=22 dport=40000 packets=10 bytes=5000 [ASSURED] mark=0 zone=0 use=2`,
}

func TestClassify(t *testing.T) {
	env := testEnv()
	want := map[string]string{
		"router-out": "", "redirect": "", "dns-to-router": "", "tun-routed": "", "hijacked-dns": "",
		"to-ss-inbound": "", "broadcast": "", "redirect-v6": "", "tun-v6-src": "",
		"bypass-v4": "ct:forward", "bypass-v6": "ct:forward", "portfwd": "ct:portfwd", "private": "ct:private",
	}
	for name, line := range lines {
		e, ok := Parse(line)
		if !ok {
			t.Fatalf("%s: parse failed", name)
		}
		c, ok := Classify(e, env)
		got := ""
		if ok {
			got = c.Kind
		}
		if got != want[name] {
			t.Errorf("%s: got %q want %q", name, got, want[name])
		}
	}
	// Byte direction from the LAN device's point of view.
	e, _ := Parse(lines["portfwd"])
	c, _ := Classify(e, env)
	if c.LAN.String() != "192.168.2.166" || c.Up != 2191786 || c.Down != 1807401 || c.LANPort != 53737 || c.Remote.String() != "111.198.56.30" {
		t.Errorf("portfwd attribution %+v", c)
	}
	e, _ = Parse(lines["bypass-v4"])
	c, _ = Classify(e, env)
	if c.LAN.String() != "192.168.2.166" || c.Up != 821 || c.Down != 216 || c.RemotePort != 1443 {
		t.Errorf("forward attribution %+v", c)
	}
}

func TestParseICMP(t *testing.T) {
	e, ok := Parse(lines["tun-routed"])
	if !ok || e.Proto != "icmp" || e.OBytes != 145 || e.RBytes != 0 || e.Mark != 8227 || e.OSport != 55981 {
		t.Fatalf("%+v", e)
	}
}

func TestPollerLifecycleAndRestart(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "c.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ctx := context.Background()
	res := resolver.New(func(context.Context, string) (string, error) { return "", nil }, st, resolver.Options{}, nil)
	env := testEnv()
	clock := time.UnixMilli(1_000_000)
	p := NewPoller(nil, res, st, time.Second, nil)
	p.now = func() time.Time { return clock }

	persist := func(table string) {
		t.Helper()
		if err := st.UpsertFlows(ctx, p.Ingest(table, env)); err != nil {
			t.Fatal(err)
		}
	}
	table := strings.Join([]string{lines["bypass-v4"], lines["redirect"], lines["portfwd"]}, "\n")
	persist(table)
	if n := len(p.Open()); n != 2 {
		t.Fatalf("open %d", n)
	}
	// Same counters again: nothing written.
	clock = clock.Add(20 * time.Second)
	if ch := p.Ingest(table, env); len(ch) != 0 {
		t.Fatalf("unchanged poll produced %d changes", len(ch))
	}
	// Bytes grow on the portfwd entry.
	grown := strings.Replace(lines["portfwd"], "bytes=2191786", "bytes=2200000", 1)
	clock = clock.Add(20 * time.Second)
	persist(lines["bypass-v4"] + "\n" + grown)

	// Restart: a new poller restores open flows from the DB and continues
	// them under the same ids.
	p2 := NewPoller(nil, res, st, time.Second, nil)
	p2.now = func() time.Time { return clock.Add(20 * time.Second) }
	if err := p2.Restore(ctx); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertFlows(ctx, p2.Ingest(lines["bypass-v4"]+"\n"+grown, env)); err != nil {
		t.Fatal(err)
	}
	var flows, up int64
	st.DB.QueryRow(`SELECT COUNT(*), SUM(up) FROM flows`).Scan(&flows, &up)
	if flows != 2 || up != 821+2200000 {
		t.Fatalf("after restart flows=%d up=%d", flows, up)
	}
	var rup int64
	st.DB.QueryRow(`SELECT SUM(up) FROM rollup_hourly`).Scan(&rup)
	if rup != 821+2200000 {
		t.Fatalf("rollup up=%d", rup)
	}
	// Entry missing from a single read (proc iteration can skip entries)
	// and then back with the same counters: same flow, nothing written.
	if ch := p2.Ingest(grown, env); len(ch) != 0 {
		t.Fatalf("single absence produced %d changes", len(ch))
	}
	if ch := p2.Ingest(lines["bypass-v4"]+"\n"+grown, env); len(ch) != 0 {
		t.Fatalf("reappearance produced %d changes", len(ch))
	}
	// Entry gone for missingPolls consecutive polls: closed at last seen.
	for i := 0; i < missingPolls; i++ {
		if err := st.UpsertFlows(ctx, p2.Ingest(grown, env)); err != nil {
			t.Fatal(err)
		}
	}
	var open int
	st.DB.QueryRow(`SELECT COUNT(*) FROM flows WHERE closed_at IS NULL`).Scan(&open)
	if open != 1 {
		t.Fatalf("open=%d", open)
	}
	// Counter reset on the same tuple = new connection.
	reset := strings.Replace(grown, "bytes=2200000", "bytes=10", 1)
	reset = strings.Replace(reset, "bytes=1807401", "bytes=10", 1)
	if err := st.UpsertFlows(ctx, p2.Ingest(reset, env)); err != nil {
		t.Fatal(err)
	}
	st.DB.QueryRow(`SELECT COUNT(*) FROM flows`).Scan(&flows)
	if flows != 3 {
		t.Fatalf("tuple reuse: flows=%d", flows)
	}
}
