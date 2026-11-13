package tracker

import (
	"testing"
	"time"

	"netwatch/internal/flow"
	"netwatch/internal/pb"
)

func conn(id string, up, down int64) *pb.Connection {
	return &pb.Connection{Id: id, Inbound: "tun-in", InboundType: "tun", Network: "tcp",
		Source: "192.168.2.10:5000", Destination: "1.2.3.4:443", Domain: "example.com",
		CreatedAt: 1000, UplinkTotal: up, DownlinkTotal: down}
}

func newEv(c *pb.Connection) *pb.ConnectionEvent {
	return &pb.ConnectionEvent{Type: pb.ConnectionEventType_CONNECTION_EVENT_NEW, Id: c.Id, Connection: c}
}

func upd(id string, du, dd int64) *pb.ConnectionEvent {
	return &pb.ConnectionEvent{Type: pb.ConnectionEventType_CONNECTION_EVENT_UPDATE, Id: id, UplinkDelta: du, DownlinkDelta: dd}
}

func closed(id string, at int64, c *pb.Connection) *pb.ConnectionEvent {
	return &pb.ConnectionEvent{Type: pb.ConnectionEventType_CONNECTION_EVENT_CLOSED, Id: id, ClosedAt: at, Connection: c}
}

func newTracker() *Tracker {
	tr := New(func(f *flow.Flow) string { return "mac:" + f.SrcIP })
	tr.SetClock(func() time.Time { return time.UnixMilli(5000) })
	return tr
}

func byID(fs []flow.Flow) map[string]flow.Flow {
	m := map[string]flow.Flow{}
	for _, f := range fs {
		m[f.ID] = f
	}
	return m
}

func TestSnapshotThenDeltas(t *testing.T) {
	tr := newTracker()
	res := tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(conn("a", 100, 200))}})
	if res == nil || len(res.OpenIDs) != 1 {
		t.Fatalf("reset result %+v", res)
	}
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{upd("a", 10, 20), upd("a", 1, 2)}})
	f, ok := tr.Get("a")
	if !ok || f.Up != 111 || f.Down != 222 {
		t.Fatalf("got %+v", f)
	}
	if f.DeviceKey != "mac:192.168.2.10" || f.SrcPort != 5000 || f.DstIP != "1.2.3.4" || f.DstPort != 443 {
		t.Fatalf("fields %+v", f)
	}
	// Idle marker (0/0) and a negative delta must not change totals.
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{upd("a", 0, 0), upd("a", -5, -5)}})
	if f, _ := tr.Get("a"); f.Up != 111 || f.Down != 222 {
		t.Fatalf("after idle %+v", f)
	}
}

func TestCloseUsesFinalTotals(t *testing.T) {
	tr := newTracker()
	tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(conn("a", 100, 200))}})
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{upd("a", 10, 10)}})
	// Bytes between the last tick and close only show up in the final
	// Connection totals.
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{closed("a", 9000, conn("a", 150, 400))}})
	if _, ok := tr.Get("a"); ok {
		t.Fatal("still open")
	}
	out := byID(tr.Drain(false))
	f := out["a"]
	if f.Up != 150 || f.Down != 400 || f.ClosedAt != 9000 {
		t.Fatalf("closed %+v", f)
	}
}

func TestCloseWithoutConnectionKeepsTracked(t *testing.T) {
	tr := newTracker()
	tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(conn("a", 5, 6))}})
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{upd("a", 1, 1), closed("a", 7000, nil)}})
	f := byID(tr.Drain(false))["a"]
	if f.Up != 6 || f.Down != 7 || f.ClosedAt != 7000 {
		t.Fatalf("%+v", f)
	}
	// Unknown id with no connection is ignored, not invented.
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{closed("zz", 1, nil), upd("zz", 5, 5)}})
	if n := len(tr.Drain(true)); n != 0 {
		t.Fatalf("drained %d", n)
	}
	if tr.Stats.OrphanCloses != 1 || tr.Stats.OrphanUpdates != 1 {
		t.Fatalf("stats %+v", tr.Stats)
	}
}

func TestResubscribeSnapshotDoesNotDoubleCount(t *testing.T) {
	tr := newTracker()
	tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(conn("a", 100, 100)), newEv(conn("b", 1, 1))}})
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{upd("a", 50, 50)}})
	tr.Drain(true)
	// Stream drops and we resubscribe: the new snapshot carries absolute
	// totals (a has moved 20 more bytes each way; b closed meanwhile and is
	// in the closed ring; c is new).
	cb := conn("b", 3, 4)
	cb.ClosedAt = 6000
	res := tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{
		newEv(conn("a", 170, 170)), newEv(cb), newEv(conn("c", 9, 9)),
	}})
	if len(res.OpenIDs) != 2 || len(res.DroppedIDs) != 0 {
		t.Fatalf("reset %+v", res)
	}
	a, _ := tr.Get("a")
	if a.Up != 170 || a.Down != 170 {
		t.Fatalf("a %+v", a)
	}
	// Deltas after the new snapshot are relative to its totals.
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{upd("a", 5, 0)}})
	a, _ = tr.Get("a")
	if a.Up != 175 || a.Down != 170 {
		t.Fatalf("a after delta %+v", a)
	}
	out := byID(tr.Drain(true))
	if b := out["b"]; b.ClosedAt != 6000 || b.Up != 3 || b.Down != 4 {
		t.Fatalf("b %+v", b)
	}
	if _, ok := out["c"]; !ok {
		t.Fatal("c not drained")
	}
	// A snapshot carrying smaller totals than we already know (shouldn't
	// happen, but must not lower counts).
	tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(conn("a", 1, 1)), newEv(conn("c", 9, 9))}})
	if a, _ := tr.Get("a"); a.Up != 175 {
		t.Fatalf("a lowered %+v", a)
	}
}

func TestResetDropsVanishedConnections(t *testing.T) {
	tr := newTracker()
	tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(conn("a", 10, 10)), newEv(conn("gone", 7, 8))}})
	tr.Drain(true)
	res := tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(conn("a", 10, 10))}})
	if len(res.DroppedIDs) != 1 || res.DroppedIDs[0] != "gone" {
		t.Fatalf("%+v", res)
	}
	f := byID(tr.Drain(false))["gone"]
	if f.ClosedAt == 0 || f.Up != 7 || f.Down != 8 {
		t.Fatalf("%+v", f)
	}
}

func TestDrainCheckpointSemantics(t *testing.T) {
	tr := newTracker()
	tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(conn("a", 1, 1))}})
	if n := len(tr.Drain(false)); n != 1 {
		t.Fatalf("new flow not drained: %d", n)
	}
	tr.Apply(&pb.ConnectionEvents{Events: []*pb.ConnectionEvent{upd("a", 1, 1)}})
	if n := len(tr.Drain(false)); n != 0 {
		t.Fatalf("byte update drained outside checkpoint: %d", n)
	}
	if fs := tr.Drain(true); len(fs) != 1 || fs[0].Up != 2 {
		t.Fatalf("checkpoint %+v", fs)
	}
	if n := len(tr.Drain(true)); n != 0 {
		t.Fatalf("clean flow re-drained: %d", n)
	}
	// Requeue after a failed write marks it dirty again.
	tr.Requeue([]flow.Flow{{ID: "a"}})
	if n := len(tr.Drain(true)); n != 1 {
		t.Fatalf("requeue: %d", n)
	}
}

func TestNewCarriesClosedFromSnapshotRing(t *testing.T) {
	tr := newTracker()
	c := conn("old", 30, 40)
	c.ClosedAt = 4000
	tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(c)}})
	if _, ok := tr.Get("old"); ok {
		t.Fatal("closed ring entry tracked as open")
	}
	f := byID(tr.Drain(false))["old"]
	if f.ClosedAt != 4000 || f.Up != 30 || f.DeviceKey == "" {
		t.Fatalf("%+v", f)
	}
}

func TestIPv6SourceParsing(t *testing.T) {
	tr := newTracker()
	c := conn("v6", 1, 1)
	c.Source = "[2408:820c:8f8e:5ae0::1234]:51000"
	c.Destination = "[2606:4700::1]:443"
	tr.Apply(&pb.ConnectionEvents{Reset_: true, Events: []*pb.ConnectionEvent{newEv(c)}})
	f, _ := tr.Get("v6")
	if f.SrcIP != "2408:820c:8f8e:5ae0::1234" || f.SrcPort != 51000 || f.DstIP != "2606:4700::1" {
		t.Fatalf("%+v", f)
	}
}
