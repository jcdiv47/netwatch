package resolver

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"netwatch/internal/flow"
	"netwatch/internal/store"
)

// Trimmed real output from the router.
const routerOut = `##LEASES
1794600708 be:7e:3a:f9:68:ea 192.168.2.213 Watch 01:be:7e:3a:f9:68:ea
1794574904 d8:ec:5e:bc:a7:dd 192.168.2.194 MacBook-Pro 01:d8:ec:5e:bc:a7:dd
0 6c:1f:f7:29:c3:c7 192.168.2.120 UGNAS-DXP4800 30:3a
1794593757 02:b3:f1:a6:29:30 192.168.2.103 * ff:ca
duid 00:01:00:01:2c:aa
1794600000 12345678 2408:820c:8f8e:5ae0::99 v6host 00:01:00
##UCI
dhcp.@dnsmasq[0].domainneeded='1'
dhcp.@host[0]=host
dhcp.@host[0].ip='192.168.2.120'
dhcp.@host[0].mac='6C:1F:F7:29:C3:C7'
dhcp.@host[1]=host
dhcp.@host[1].mac='BC:24:11:51:88:74'
dhcp.@host[1].ip='192.168.2.166'
dhcp.@host[1].name='pve-vm'
dhcp.@host[2]=host
dhcp.@host[2].mac='AA:AA:AA:AA:AA:01' 'AA:AA:AA:AA:AA:02'
dhcp.@host[2].ip='192.168.2.50'
##NEIGH4
192.168.2.116 dev br-lan FAILED
192.168.2.194 dev br-lan lladdr d8:ec:5e:bc:a7:dd REACHABLE
192.168.2.248 dev br-lan lladdr bc:24:11:9b:71:05 STALE
##NEIGH6
fe80::67:3a4e:781b:1d63 dev br-lan lladdr d8:ec:5e:bc:a7:dd STALE
2408:820c:8f8e:5ae0:c97:5714:9cff:4519 dev br-lan lladdr d8:ec:5e:bc:a7:dd STALE
2408:820c:8f8e:5ae0:be24:11ff:fe51:8874 dev br-lan lladdr bc:24:11:51:88:74 REACHABLE
2408:820c:8f8e:5ae0:c5a1:1d9e:908d:46b9 dev br-lan FAILED
2001:db8::1 dev pppoe-wan lladdr 00:11:22:33:44:55 STALE
##ADDR
1: lo    inet 127.0.0.1/8 scope host lo\       valid_lft forever preferred_lft forever
5: br-lan    inet 192.168.2.1/24 brd 192.168.2.255 scope global br-lan\       valid_lft forever preferred_lft forever
5: br-lan    inet6 2408:820c:8f8e:5ae0:be24:11ff:fe2c:2d4a/64 scope global dynamic noprefixroute \       valid_lft 1 preferred_lft 1
5: br-lan    inet6 fd44:2b2:2751:0:be24:11ff:fe2c:2d4a/64 scope global noprefixroute \       valid_lft forever preferred_lft forever
5: br-lan    inet6 fe80::be24:11ff:fe2c:2d4a/64 scope link proto kernel_ll \       valid_lft forever preferred_lft forever
9: pppoe-wan    inet 223.167.38.7 peer 223.167.38.1/32 scope global pppoe-wan\       valid_lft forever preferred_lft forever
12: singbox_tun    inet 172.18.0.1/30 brd 172.18.0.3 scope global singbox_tun\       valid_lft forever preferred_lft forever
12: singbox_tun    inet6 fdfe:dcba:9876::1/126 scope global \       valid_lft forever preferred_lft forever
##HOSTS
# auto-generated config file from /etc/config/dhcp
192.168.2.1 ImmortalWrt
192.168.2.50 multi-nic
##RULE
0:	from all lookup local
9000:	from all fwmark 0x2024/0x2027 goto 9002
9001:	from all fwmark 0x2023/0x2027 lookup 2022
32768:	not from all fwmark 0x2024/0x2027 lookup 2022
##END
`

func newTestResolver(t *testing.T) (*Resolver, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "r.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	run := func(ctx context.Context, cmd string) (string, error) { return routerOut, nil }
	r := New(run, st, Options{}, nil)
	return r, st
}

func TestParseRouterOutput(t *testing.T) {
	s := ParseRouterOutput(routerOut)
	if len(s.Leases) != 4 {
		t.Fatalf("leases %+v", s.Leases)
	}
	if s.Leases[3].Hostname != "" {
		t.Fatalf("* hostname should be empty: %+v", s.Leases[3])
	}
	if len(s.Static) != 3 || s.Static[1].Name != "pve-vm" || s.Static[0].MACs[0] != "6c:1f:f7:29:c3:c7" || len(s.Static[2].MACs) != 2 {
		t.Fatalf("static %+v", s.Static)
	}
	if len(s.Neigh) != 6 {
		t.Fatalf("neigh %d %+v", len(s.Neigh), s.Neigh)
	}
	if s.TunMark != 0x2023 || s.TunMarkMask != 0x2027 {
		t.Fatalf("mark %#x/%#x", s.TunMark, s.TunMarkMask)
	}
	if s.HostsNames["192.168.2.1"] != "ImmortalWrt" {
		t.Fatalf("hosts %+v", s.HostsNames)
	}
}

func TestResolve(t *testing.T) {
	r, st := newTestResolver(t)
	ctx := context.Background()
	if err := r.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{
		"192.168.2.194":                          "d8:ec:5e:bc:a7:dd", // lease + neigh
		"2408:820c:8f8e:5ae0:c97:5714:9cff:4519": "d8:ec:5e:bc:a7:dd", // v6 privacy addr via neigh
		"192.168.2.166":                          "bc:24:11:51:88:74", // static host
		"192.168.2.1":                            "router",
		"172.18.0.2":                             "router", // sing-box tun stack
		"fdfe:dcba:9876::1":                      "router",
		"223.167.38.7":                           "router", // WAN address
		"127.0.0.1":                              "router",
		"::ffff:192.168.2.213":                   "be:7e:3a:f9:68:ea", // v4-mapped
	}
	for ip, want := range cases {
		if got, ok := r.Lookup(ip); !ok || got != want {
			t.Errorf("Lookup(%s) = %q,%v want %q", ip, got, ok, want)
		}
	}
	if _, ok := r.Lookup("2001:db8::1"); ok {
		t.Error("neighbour on non-LAN interface must be ignored")
	}
	if _, ok := r.Lookup("192.168.2.50"); ok {
		t.Error("multi-MAC static host must not pin an IP")
	}
	// Hostnames recorded, static name wins, hosts-file name fills gaps.
	d, _ := st.Device(ctx, "bc:24:11:51:88:74")
	if d == nil || d.Hostname != "pve-vm" || d.LastIP4 != "192.168.2.166" {
		t.Fatalf("device %+v", d)
	}
	d, _ = st.Device(ctx, "aa:aa:aa:aa:aa:01")
	if d == nil || d.Hostname != "multi-nic" {
		t.Fatalf("multi-nic %+v", d)
	}
	d, _ = st.Device(ctx, "router")
	if d == nil || d.Name != "Router (ImmortalWrt)" {
		t.Fatalf("router %+v", d)
	}
}

func TestRotatedIPv6ResolvesFromHistory(t *testing.T) {
	r, st := newTestResolver(t)
	ctx := context.Background()
	if err := r.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	// A new process (restart) only has the persisted history, and the
	// router's neighbour table no longer lists the old privacy address.
	r2 := New(func(context.Context, string) (string, error) {
		return "##LEASES\n##NEIGH6\n##ADDR\n" + "5: br-lan    inet 192.168.2.1/24 brd x scope global br-lan\n##END\n", nil
	}, st, Options{}, nil)
	if err := r2.LoadHistory(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r2.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	if got, ok := r2.Lookup("2408:820c:8f8e:5ae0:c97:5714:9cff:4519"); !ok || got != "d8:ec:5e:bc:a7:dd" {
		t.Fatalf("history lookup = %q %v", got, ok)
	}
}

func TestIPReassignedToNewDevice(t *testing.T) {
	r, _ := newTestResolver(t)
	ctx := context.Background()
	r.now = func() time.Time { return time.UnixMilli(1000) }
	r.Apply(ctx, RouterSnapshot{Leases: []Lease{{MAC: "aa:00:00:00:00:01", IP: "192.168.2.77"}}})
	r.now = func() time.Time { return time.UnixMilli(2000) }
	r.Apply(ctx, RouterSnapshot{Leases: []Lease{{MAC: "aa:00:00:00:00:02", IP: "192.168.2.77"}}})
	if got, _ := r.Lookup("192.168.2.77"); got != "aa:00:00:00:00:02" {
		t.Fatalf("got %s", got)
	}
}

func TestKeyFor(t *testing.T) {
	r, _ := newTestResolver(t)
	if err := r.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		f    flow.Flow
		want string
	}{
		{flow.Flow{Source: flow.SourceSingbox, InboundType: "tun", Inbound: "tun-in", SrcIP: "192.168.2.194"}, "d8:ec:5e:bc:a7:dd"},
		{flow.Flow{Source: flow.SourceSingbox, InboundType: "tun", Inbound: "tun-in", SrcIP: "172.18.0.1"}, "router"},
		{flow.Flow{Source: flow.SourceSingbox, InboundType: "tun", Inbound: "tun-in", SrcIP: "192.168.2.99"}, "ip:192.168.2.99"},
		// Shadowsocks inbound from a remote user.
		{flow.Flow{Source: flow.SourceSingbox, InboundType: "shadowsocks", Inbound: "ss-in-22", SrcIP: "124.77.133.69"}, "inbound:ss-in-22"},
		{flow.Flow{Source: flow.SourceSingbox, InboundType: "shadowsocks", Inbound: "ss-in-bb", User: "bob", SrcIP: "124.77.133.69"}, "inbound:ss-in-bb:bob"},
		// LAN host using the mixed proxy inbound keeps its device.
		{flow.Flow{Source: flow.SourceSingbox, InboundType: "mixed", Inbound: "mixed-in", SrcIP: "192.168.2.194"}, "d8:ec:5e:bc:a7:dd"},
		{flow.Flow{Source: flow.SourceConntrack, Inbound: "ct:forward", SrcIP: "192.168.2.166"}, "bc:24:11:51:88:74"},
	}
	for _, c := range cases {
		if got := r.KeyFor(&c.f); got != c.want {
			t.Errorf("KeyFor(%+v) = %q want %q", c.f, got, c.want)
		}
	}
}
