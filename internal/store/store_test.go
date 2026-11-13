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
