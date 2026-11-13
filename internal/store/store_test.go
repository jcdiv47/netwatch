package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"netwatch/internal/flow"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func sums(t *testing.T, s *Store) (up, down, conns, flows int64) {
	t.Helper()
	if err := s.DB.QueryRow(`SELECT COALESCE(SUM(up),0), COALESCE(SUM(down),0), COALESCE(SUM(conns),0) FROM rollup_hourly`).Scan(&up, &down, &conns); err != nil {
		t.Fatal(err)
	}
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM flows`).Scan(&flows); err != nil {
		t.Fatal(err)
	}
	return
}

func TestUpsertIdempotentAndRollups(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	clock := time.Date(2026, 11, 13, 10, 30, 0, 0, time.UTC)
	s.Now = func() time.Time { return clock }
	f := flow.Flow{ID: "a", Source: flow.SourceSingbox, DeviceKey: "aa:bb:cc:dd:ee:ff", SrcIP: "192.168.2.10",
		DstIP: "1.2.3.4", Domain: "example.com", CreatedAt: clock.UnixMilli(), Up: 100, Down: 1000}
	if err := s.UpsertFlows(ctx, []flow.Flow{f}); err != nil {
		t.Fatal(err)
	}
	// Same totals again (e.g. a restart re-reading the snapshot): no change.
	if err := s.UpsertFlows(ctx, []flow.Flow{f}); err != nil {
		t.Fatal(err)
	}
	if up, down, conns, n := sums(t, s); up != 100 || down != 1000 || conns != 1 || n != 1 {
		t.Fatalf("after dup: up=%d down=%d conns=%d flows=%d", up, down, conns, n)
	}
	// Next hour, the flow grew; only the increment lands in the new hour.
	clock = clock.Add(time.Hour)
	f.Up, f.Down = 150, 1500
	if err := s.UpsertFlows(ctx, []flow.Flow{f}); err != nil {
		t.Fatal(err)
	}
	var h2up, h2down int64
	if err := s.DB.QueryRow(`SELECT up, down FROM rollup_hourly WHERE hour = ?`, clock.Unix()/3600*3600).Scan(&h2up, &h2down); err != nil {
		t.Fatal(err)
	}
	if h2up != 50 || h2down != 500 {
		t.Fatalf("hour2 %d/%d", h2up, h2down)
	}
	// A stale/lower total never lowers or subtracts.
	f.Up, f.Down = 10, 10
	f.ClosedAt = clock.UnixMilli()
	if err := s.UpsertFlows(ctx, []flow.Flow{f}); err != nil {
		t.Fatal(err)
	}
	if up, down, _, _ := sums(t, s); up != 150 || down != 1500 {
		t.Fatalf("lowered: %d/%d", up, down)
	}
	var fu, fd int64
	var closed *int64
	s.DB.QueryRow(`SELECT up, down, closed_at FROM flows WHERE conn_id='a'`).Scan(&fu, &fd, &closed)
	if fu != 150 || fd != 1500 || closed == nil {
		t.Fatalf("flow row %d %d %v", fu, fd, closed)
	}
}

func TestLateResolutionReplacesUnresolvedOnly(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	f := flow.Flow{ID: "x", Source: flow.SourceSingbox, DeviceKey: "ip:2408::5", SrcIP: "2408::5", DstIP: "9.9.9.9", Up: 1, Down: 1}
	s.UpsertFlows(ctx, []flow.Flow{f})
	f.DeviceKey = "11:22:33:44:55:66"
	f.Up = 2
	s.UpsertFlows(ctx, []flow.Flow{f})
	var key string
	s.DB.QueryRow(`SELECT device_key FROM flows WHERE conn_id='x'`).Scan(&key)
	if key != "11:22:33:44:55:66" {
		t.Fatalf("key %s", key)
	}
	// A resolved attribution is never replaced.
	f.DeviceKey = "router"
	f.Up = 3
	s.UpsertFlows(ctx, []flow.Flow{f})
	s.DB.QueryRow(`SELECT device_key FROM flows WHERE conn_id='x'`).Scan(&key)
	if key != "11:22:33:44:55:66" {
		t.Fatalf("key changed to %s", key)
	}
}

func TestCloseStale(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	t0 := time.UnixMilli(1_000_000)
	s.Now = func() time.Time { return t0 }
	s.UpsertFlows(ctx, []flow.Flow{
		{ID: "keep", Source: flow.SourceSingbox, SrcIP: "1.1.1.1", DstIP: "2.2.2.2"},
		{ID: "stale", Source: flow.SourceSingbox, SrcIP: "1.1.1.1", DstIP: "2.2.2.2"},
		{ID: "ct", Source: flow.SourceConntrack, SrcIP: "1.1.1.1", DstIP: "2.2.2.2"},
	})
	s.Now = func() time.Time { return t0.Add(time.Minute) }
	s.UpsertFlows(ctx, []flow.Flow{{ID: "fresh", Source: flow.SourceSingbox, SrcIP: "1.1.1.1", DstIP: "2.2.2.2"}})
	n, err := s.CloseStale(ctx, flow.SourceSingbox, []string{"keep"}, t0.Add(30*time.Second).UnixMilli())
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	var c int
	s.DB.QueryRow(`SELECT COUNT(*) FROM flows WHERE closed_at IS NULL`).Scan(&c)
	if c != 3 {
		t.Fatalf("open=%d", c)
	}
	var closedAt int64
	s.DB.QueryRow(`SELECT closed_at FROM flows WHERE conn_id='stale'`).Scan(&closedAt)
	if closedAt != t0.UnixMilli() {
		t.Fatalf("closed_at %d", closedAt)
	}
}

func TestPrune(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	now := time.Now()
	old := now.Add(-40 * 24 * time.Hour)
	s.Now = func() time.Time { return old }
	s.UpsertFlows(ctx, []flow.Flow{{ID: "old", Source: flow.SourceSingbox, SrcIP: "1.1.1.1", DstIP: "2.2.2.2", ClosedAt: old.UnixMilli(), Up: 5}})
	s.Now = time.Now
	s.UpsertFlows(ctx, []flow.Flow{{ID: "new", Source: flow.SourceSingbox, SrcIP: "1.1.1.1", DstIP: "2.2.2.2", ClosedAt: now.UnixMilli(), Up: 5}})
	nf, nr, err := s.Prune(ctx, 30*24*time.Hour, 365*24*time.Hour)
	if err != nil || nf != 1 || nr != 0 {
		t.Fatalf("nf=%d nr=%d err=%v", nf, nr, err)
	}
	if up, _, _, n := sums(t, s); n != 1 || up != 10 {
		t.Fatalf("flows=%d rollup up=%d (rollups must outlive flows)", n, up)
	}
}

func TestOverviewQueries(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	clock := time.Date(2026, 11, 13, 10, 30, 0, 0, time.UTC)
	s.Now = func() time.Time { return clock }
	mk := func(id, dev, domain, out string, up, down int64) flow.Flow {
		return flow.Flow{ID: id, Source: flow.SourceSingbox, DeviceKey: dev, SrcIP: "192.168.2.10", DstIP: "1.2.3.4",
			Domain: domain, Outbound: out, CreatedAt: clock.UnixMilli(), Up: up, Down: down}
	}
	ct := flow.Flow{ID: "ct-1", Source: flow.SourceConntrack, DeviceKey: "aa", Inbound: "ct:forward", SrcIP: "192.168.2.10",
		DstIP: "9.9.9.9", CreatedAt: clock.UnixMilli(), Up: 5, Down: 5}
	if err := s.UpsertFlows(ctx, []flow.Flow{
		mk("1", "aa", "big.example", "Direct", 10, 1000),
		mk("2", "aa", "small.example", "Proxy", 1, 10),
		mk("3", "bb", "big.example", "Direct", 20, 200),
		mk("4", "cc", "small.example", "Proxy", 2, 2),
		ct,
	}); err != nil {
		t.Fatal(err)
	}
	from := clock.Unix()/3600*3600 - 3600

	tot, err := s.Totals(ctx, from)
	if err != nil {
		t.Fatal(err)
	}
	if tot.Up != 38 || tot.Down != 1217 || tot.Conns != 5 || tot.Devices != 3 || tot.Targets != 3 {
		t.Fatalf("totals: %+v", tot)
	}

	all, err := s.SeriesAll(ctx, from, 3600, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].Up != 38 || all[0].Down != 1217 {
		t.Fatalf("series: %+v", all)
	}
	by, err := s.SeriesByDevice(ctx, from, 3600, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := by["aa"][all[0].T]; got != 1031 {
		t.Fatalf("device series aa: %d (%v)", got, by)
	}

	// Top sets {aa} x {big.example}; everything else folds into "".
	links, err := s.Links(ctx, from, []string{"aa"}, []string{"big.example"})
	if err != nil {
		t.Fatal(err)
	}
	got := map[[2]string]int64{}
	var sum int64
	for _, l := range links {
		got[[2]string{l.DeviceKey, l.Target}] = l.Up + l.Down
		sum += l.Up + l.Down
	}
	want := map[[2]string]int64{{"aa", "big.example"}: 1010, {"aa", ""}: 21, {"", "big.example"}: 220, {"", ""}: 4}
	if len(got) != len(want) {
		t.Fatalf("links: %v", got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("link %v = %d, want %d (%v)", k, got[k], v, got)
		}
	}
	if sum != tot.Up+tot.Down {
		t.Fatalf("links sum %d != total %d", sum, tot.Up+tot.Down)
	}
	// No top sets at all: one catch-all row, and no SQL syntax error.
	if links, err = s.Links(ctx, from, nil, nil); err != nil || len(links) != 1 {
		t.Fatalf("empty sets: %v %v", links, err)
	}

	routes, err := s.Routes(ctx, clock.UnixMilli()-1)
	if err != nil {
		t.Fatal(err)
	}
	rt := map[string]int64{}
	for _, r := range routes {
		rt[r.Route] = r.Up + r.Down
	}
	if rt["Direct"] != 1230 || rt["Proxy"] != 15 || rt["ct:forward"] != 10 || len(rt) != 3 {
		t.Fatalf("routes: %v", rt)
	}

	nt, err := s.RecentNewTargets(ctx, clock.UnixMilli()-1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(nt) != 5 {
		t.Fatalf("new targets: %+v", nt)
	}
}

func TestFlowsFilter(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 13, 10, 30, 0, 0, time.UTC)
	s.Now = func() time.Time { return now }
	ms := now.UnixMilli()
	if err := s.UpsertFlows(ctx, []flow.Flow{
		{ID: "1", Source: flow.SourceSingbox, DeviceKey: "aa", Inbound: "tun-in", InboundType: "tun", Network: "tcp", Protocol: "tls",
			SrcIP: "192.168.2.10", SrcPort: 5000, DstIP: "1.2.3.4", DstPort: 443, Domain: "big.example", Outbound: "Proxy",
			Rule: "rule_set=geosite => route(Proxy)", Chain: "Proxy / hk-01", IPVersion: 4, CreatedAt: ms - 3000, ClosedAt: ms - 1000, Up: 10, Down: 1000},
		{ID: "2", Source: flow.SourceSingbox, DeviceKey: "bb", Inbound: "ss-in", InboundType: "shadowsocks", Network: "udp", User: "phone",
			SrcIP: "192.168.2.11", SrcPort: 6000, DstIP: "5.6.7.8", DstPort: 53, Domain: "100%_dns.example", Outbound: "Direct",
			IPVersion: 4, CreatedAt: ms - 2000, Up: 5, Down: 5},
		{ID: "3", Source: flow.SourceSingbox, DeviceKey: "aa", Inbound: "tun-in", InboundType: "tun", Network: "tcp",
			SrcIP: "192.168.2.10", SrcPort: 5001, DstIP: "9.9.9.9", DstPort: 443, Outbound: "Direct", IPVersion: 4, CreatedAt: ms - 100000, Up: 1, Down: 1},
	}); err != nil {
		t.Fatal(err)
	}
	ids := func(f FlowFilter) string {
		t.Helper()
		f.Limit = max(f.Limit, 10)
		if f.Since == 0 {
			f.Since = ms - 10000
		}
		rows, _, err := s.Flows(ctx, f)
		if err != nil {
			t.Fatal(err)
		}
		var out string
		for _, r := range rows {
			out += r.ID
		}
		return out
	}
	for _, c := range []struct {
		f    FlowFilter
		want string
	}{
		{FlowFilter{}, "21"},                    // newest first, range excludes 3
		{FlowFilter{Since: 1}, "213"},           //
		{FlowFilter{ByBytes: true}, "12"},       //
		{FlowFilter{State: "closed"}, "1"},      //
		{FlowFilter{State: "open"}, "2"},        //
		{FlowFilter{Query: "network:UDP"}, "2"}, //
		{FlowFilter{Query: "inbound.type:shadow"}, "2"},
		{FlowFilter{Query: "outbound:hk"}, "1"}, // matches the chain
		{FlowFilter{Query: "source:192.168.2.10:5000"}, "1"},
		{FlowFilter{Query: "destination:1.2.3.4:443"}, "1"},
		{FlowFilter{Query: "destination:big"}, "1"},
		{FlowFilter{Query: "rule:geosite"}, "1"},
		{FlowFilter{Query: "target:big.example"}, "1"},
		{FlowFilter{Query: "target:big"}, ""},
		{FlowFilter{Query: "user:phone port:53"}, "2"},
		{FlowFilter{Query: "device:aa", Since: 1}, "13"},
		{FlowFilter{Query: "example network:tcp"}, "1"},
		{FlowFilter{Query: "100%_"}, "2"}, // LIKE wildcards are literal
		{FlowFilter{Query: "%"}, "2"},
		{FlowFilter{Query: "nosuch:big"}, ""}, // unknown key: plain match of the whole word
	} {
		if got := ids(c.f); got != c.want {
			t.Errorf("%+v: got %q want %q", c.f, got, c.want)
		}
	}
	rows, more, err := s.Flows(ctx, FlowFilter{Since: 1, Limit: 2})
	if err != nil || len(rows) != 2 || !more {
		t.Fatalf("limit: %d rows, more=%v, err=%v", len(rows), more, err)
	}
	if r := rows[1]; r.Rule == "" || r.InboundType != "tun" || r.IPVersion != 4 || r.ClosedAt == nil {
		t.Fatalf("detail fields: %+v", r)
	}
}
