// Package tracker turns the sing-box SubscribeConnections event stream into
// per-connection absolute byte totals.
//
// Server semantics (sing-box daemon/started_service.go, confirmed against
// the router's 1.15.0-alpha.11 stream):
//
//   - The first message of every subscription has reset=true and contains a
//     NEW event for every open connection plus every connection in the
//     server's recently-closed ring (those carry closedAt != 0). Connection
//     uplinkTotal/downlinkTotal are absolute counters.
//   - The server keeps a per-subscription baseline equal to those totals;
//     subsequent UPDATE events carry deltas relative to the previous tick.
//     A delta of 0/0 after traffic is just a "went idle" marker.
//   - CLOSED events usually carry the final Connection (with totals); if the
//     server no longer has metadata, only id + closedAt are sent.
//
// Because every Flow keeps absolute totals and closed totals are merged with
// max(), re-subscribing (new snapshot) or replaying a closed connection can
// never double count.
package tracker

import (
	"strings"
	"sync"
	"time"

	"netwatch/internal/flow"
	"netwatch/internal/pb"
)

// KeyFunc resolves the device key for a newly seen flow.
type KeyFunc func(f *flow.Flow) string

type entry struct {
	f         flow.Flow
	persisted bool // has been written to the store at least once
	dirty     bool // has changes not yet written
	lastTick  time.Time
}

// Tracker holds the open sing-box connections in memory.
type Tracker struct {
	mu      sync.Mutex
	open    map[string]*entry
	closed  []flow.Flow // closed flows waiting to be persisted
	keyFunc KeyFunc
	now     func() time.Time

	Stats Stats
}

type Stats struct {
	Messages      int64
	Events        int64
	Resets        int64
	OrphanUpdates int64 // UPDATE for an id we don't know
	OrphanCloses  int64 // CLOSED without connection for an unknown id
	LastMessage   time.Time
}

// ResetResult describes the outcome of a reset (snapshot) message.
type ResetResult struct {
	OpenIDs    []string // ids that are open according to the snapshot
	DroppedIDs []string // ids we had open that the snapshot no longer knows
}

func New(keyFunc KeyFunc) *Tracker {
	if keyFunc == nil {
		keyFunc = func(*flow.Flow) string { return "" }
	}
	return &Tracker{open: map[string]*entry{}, keyFunc: keyFunc, now: time.Now}
}

// SetClock overrides the clock (tests).
func (t *Tracker) SetClock(now func() time.Time) { t.now = now }

func fromProto(c *pb.Connection) flow.Flow {
	srcIP, srcPort := flow.SplitHostPort(c.GetSource())
	dstIP, dstPort := flow.SplitHostPort(c.GetDestination())
	return flow.Flow{
		ID:          c.GetId(),
		Source:      flow.SourceSingbox,
		Inbound:     c.GetInbound(),
		InboundType: c.GetInboundType(),
		Network:     c.GetNetwork(),
		Protocol:    c.GetProtocol(),
		User:        c.GetUser(),
		Outbound:    c.GetOutbound(),
		Rule:        c.GetRule(),
		Chain:       strings.Join(c.GetChainList(), " > "),
		IPVersion:   int(c.GetIpVersion()),
		SrcIP:       srcIP,
		SrcPort:     srcPort,
		DstIP:       dstIP,
		DstPort:     dstPort,
		Domain:      c.GetDomain(),
		CreatedAt:   c.GetCreatedAt(),
		ClosedAt:    c.GetClosedAt(),
		Up:          c.GetUplinkTotal(),
		Down:        c.GetDownlinkTotal(),
	}
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// Apply processes one ConnectionEvents message. If it is a reset message the
// returned ResetResult is non-nil.
func (t *Tracker) Apply(msg *pb.ConnectionEvents) *ResetResult {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	nowMs := now.UnixMilli()
	t.Stats.Messages++
	t.Stats.LastMessage = now
	var seen map[string]bool
	if msg.GetReset_() {
		t.Stats.Resets++
		seen = map[string]bool{}
	}
	for _, ev := range msg.GetEvents() {
		t.Stats.Events++
		id := ev.GetId()
		switch ev.GetType() {
		case pb.ConnectionEventType_CONNECTION_EVENT_NEW:
			c := ev.GetConnection()
			if c == nil {
				continue
			}
			if id == "" {
				id = c.GetId()
			}
			nf := fromProto(c)
			nf.ID = id
			if nf.ClosedAt != 0 {
				// Recently-closed connection replayed in a snapshot.
				if e, ok := t.open[id]; ok {
					nf.Up = max64(nf.Up, e.f.Up)
					nf.Down = max64(nf.Down, e.f.Down)
					nf.DeviceKey = e.f.DeviceKey
					delete(t.open, id)
				}
				if nf.DeviceKey == "" {
					nf.DeviceKey = t.keyFunc(&nf)
				}
				nf.UpdatedAt = nowMs
				t.closed = append(t.closed, nf)
				continue
			}
			if seen != nil {
				seen[id] = true
			}
			if e, ok := t.open[id]; ok {
				// Re-subscribe snapshot of a connection we already track:
				// totals are absolute, keep the larger.
				if nf.Up > e.f.Up || nf.Down > e.f.Down {
					e.f.Up = max64(nf.Up, e.f.Up)
					e.f.Down = max64(nf.Down, e.f.Down)
					e.f.UpdatedAt = nowMs
					e.dirty = true
				}
				if e.f.Domain == "" && nf.Domain != "" {
					e.f.Domain = nf.Domain
					e.dirty = true
				}
				e.lastTick = now
				continue
			}
			nf.UpdatedAt = nowMs
			nf.DeviceKey = t.keyFunc(&nf)
			t.open[id] = &entry{f: nf, dirty: true, lastTick: now}

		case pb.ConnectionEventType_CONNECTION_EVENT_UPDATE:
			e, ok := t.open[id]
			if !ok {
				t.Stats.OrphanUpdates++
				continue
			}
			du, dd := ev.GetUplinkDelta(), ev.GetDownlinkDelta()
			if du < 0 {
				du = 0
			}
			if dd < 0 {
				dd = 0
			}
			dt := now.Sub(e.lastTick).Seconds()
			if dt > 0.2 {
				e.f.RateUp = float64(du) / dt
				e.f.RateDown = float64(dd) / dt
			}
			e.lastTick = now
			if du > 0 || dd > 0 {
				e.f.Up += du
				e.f.Down += dd
				e.f.UpdatedAt = nowMs
				e.dirty = true
			}

		case pb.ConnectionEventType_CONNECTION_EVENT_CLOSED:
			closedAt := ev.GetClosedAt()
			e, ok := t.open[id]
			var cf flow.Flow
			switch {
			case ok:
				cf = e.f
				delete(t.open, id)
				if c := ev.GetConnection(); c != nil {
					cf.Up = max64(cf.Up, c.GetUplinkTotal())
					cf.Down = max64(cf.Down, c.GetDownlinkTotal())
					if cf.Domain == "" {
						cf.Domain = c.GetDomain()
					}
				}
			case ev.GetConnection() != nil:
				cf = fromProto(ev.GetConnection())
				cf.ID = id
				cf.DeviceKey = t.keyFunc(&cf)
			default:
				t.Stats.OrphanCloses++
				continue
			}
			if closedAt == 0 {
				closedAt = ev.GetConnection().GetClosedAt()
			}
			if closedAt == 0 {
				closedAt = nowMs
			}
			cf.ClosedAt = closedAt
			cf.RateUp, cf.RateDown = 0, 0
			cf.UpdatedAt = nowMs
			t.closed = append(t.closed, cf)
		}
	}
	if seen == nil {
		return nil
	}
	res := &ResetResult{}
	for id, e := range t.open {
		if seen[id] {
			res.OpenIDs = append(res.OpenIDs, id)
			continue
		}
		// We had it open but the server no longer knows it: it closed while
		// we were disconnected and fell out of the closed ring. Keep the last
		// totals we saw; the true close time is unknown.
		cf := e.f
		cf.ClosedAt = max64(cf.UpdatedAt, cf.CreatedAt)
		cf.RateUp, cf.RateDown = 0, 0
		t.closed = append(t.closed, cf)
		delete(t.open, id)
		res.DroppedIDs = append(res.DroppedIDs, id)
	}
	return res
}

// Drain returns flows that need persisting: all closed flows, plus open
// flows that were never written. With checkpoint=true every open flow with
// unwritten changes is included as well. Returned flows are considered
// written; call Requeue if persisting fails.
func (t *Tracker) Drain(checkpoint bool) []flow.Flow {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := t.closed
	t.closed = nil
	for _, e := range t.open {
		if !e.persisted || (checkpoint && e.dirty) {
			out = append(out, e.f)
			e.persisted = true
			e.dirty = false
		}
	}
	return out
}

// Requeue puts flows back after a failed write.
func (t *Tracker) Requeue(fs []flow.Flow) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, f := range fs {
		if f.ClosedAt != 0 {
			t.closed = append(t.closed, f)
			continue
		}
		if e, ok := t.open[f.ID]; ok {
			e.dirty = true
		}
	}
}

// UpdateDeviceKey lets the flusher record a late resolution in memory.
func (t *Tracker) UpdateDeviceKey(id, key string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if e, ok := t.open[id]; ok {
		e.f.DeviceKey = key
	}
}

// Open returns a copy of all open flows.
func (t *Tracker) Open() []flow.Flow {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]flow.Flow, 0, len(t.open))
	for _, e := range t.open {
		out = append(out, e.f)
	}
	return out
}

// Snapshot of stats.
func (t *Tracker) GetStats() (Stats, int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.Stats, len(t.open)
}

// Get returns an open flow by id (tests).
func (t *Tracker) Get(id string) (flow.Flow, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	e, ok := t.open[id]
	if !ok {
		return flow.Flow{}, false
	}
	return e.f, true
}
